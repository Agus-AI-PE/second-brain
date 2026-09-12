import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../../api/src/generated/prisma/index.js'
import { Redis } from 'ioredis'
import { MistralClient } from '@anvia/mistral'
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { createMemoryAgent, runAgent, createCompletionModel, ConversationMemoryStore, reminderQueue } from '@second-brain/agent'
import type { Agent } from '@anvia/core'
import { PrismaMemoryStore } from './memory-store.js'
import { embedText } from './embed.js'
import { TelegramClient, imageDocumentMime } from './telegram.js'
import { PrismaAccessStore } from './access-store.js'
import { handleTelegramCallback, handleTelegramText } from './handler.js'

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL is required')
const token = process.env.TELEGRAM_BOT_TOKEN
if (!token) throw new Error('TELEGRAM_BOT_TOKEN is required')
const adminTelegramId = process.env.ADMIN_TELEGRAM_ID
if (!adminTelegramId) throw new Error('ADMIN_TELEGRAM_ID is required')
const openaiBaseUrl = process.env.OPENAI_BASE_URL
if (!openaiBaseUrl) throw new Error('OPENAI_BASE_URL is required')
const openaiApiKey = process.env.OPENAI_API_KEY
if (!openaiApiKey) throw new Error('OPENAI_API_KEY is required')
const mistralApiKey = process.env.MISTRAL_API_KEY
if (!mistralApiKey) throw new Error('MISTRAL_API_KEY is required')

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) })
const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: null })
const store = new PrismaMemoryStore(prisma, redis)
const accessStore = new PrismaAccessStore(prisma)

const model = createCompletionModel({
  baseUrl: openaiBaseUrl,
  apiKey: openaiApiKey,
  modelId: process.env.AGENT_MODEL ?? 'gpt-5.6-luna'
})

// Cheap fast model as LLM injection judge (runs after regex guardrails).
const judgeModel = process.env.JUDGE_MODEL
  ? createCompletionModel({ baseUrl: openaiBaseUrl, apiKey: openaiApiKey, modelId: process.env.JUDGE_MODEL })
  : undefined
if (judgeModel) console.log(`[guardrail] LLM injection judge active: ${process.env.JUDGE_MODEL}`)

/**
 * Build a per-request agent: set_reminder is bound to the chat the message
 * actually came from (trusted), never to an LLM-chosen chatId. When an
 * archived attachment exists for this message, save_memory auto-links it.
 */
function agentFor(chatId: string, attachment?: { sourceUrl: string; sourceType: string }): Agent {
  return createMemoryAgent({
    store,
    embed: embedText,
    model,
    judgeModel,
    memory: new ConversationMemoryStore({ redis, ttlSeconds: 24 * 60 * 60 }),
    trustedChatId: chatId,
    attachment,
    scheduleReminder: async (job) => {
      const delay = Math.max(0, job.deliverAt.getTime() - Date.now())
      await reminderQueue(redis).add('deliver', job, { delay })
      console.log(`[reminder] scheduled id=${job.reminderId} at=${job.deliverAt.toISOString()} (delay ${Math.round(delay / 1000)}s)`)
    }
  }) as Agent
}

/** r2://bucket/key → short-lived presigned HTTPS URL for Telegram sendPhoto. */
async function presignR2(uri: string, expiresSeconds = 3600): Promise<string | null> {
  if (!uri.startsWith('r2://')) return null
  const withoutScheme = uri.slice('r2://'.length)
  const slash = withoutScheme.indexOf('/')
  if (slash === -1) return null
  const bucket = withoutScheme.slice(0, slash)
  const key = withoutScheme.slice(slash + 1)
  const cmd = new GetObjectCommand({ Bucket: bucket, Key: key })
  try {
    return await getSignedUrl(r2, cmd, { expiresIn: expiresSeconds })
  } catch (err) {
    console.error(`[r2] presign failed for ${key}: ${err instanceof Error ? err.message : err}`)
    return null
  }
}

/** Find the archived file link for a saved memory (r2:// URI) from Postgres. */
async function fileUrlForMemory(memoryId: string): Promise<string | null> {
  const m = await prisma.memory.findUnique({ where: { id: memoryId }, select: { sourceUrl: true } })
  return m?.sourceUrl ?? null
}

const telegram = new TelegramClient(token)
const ocr = new MistralClient({ apiKey: mistralApiKey }).ocrModel({
  modelId: process.env.MISTRAL_OCR_MODEL ?? 'mistral-ocr-latest'
})
const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? ''
  }
})

const MAX_FILE_BYTES = 20 * 1024 * 1024

// --- Access gate (admin bypass; others need APPROVED) ---
type TgUser = { id: number; username?: string; first_name?: string }
type TgPhoto = { file_id: string; file_size?: number }
type TgDocument = { file_id: string; file_name?: string; mime_type?: string; file_size?: number }
type TgMessage = {
  message_id: number
  chat: { id: number }
  from?: TgUser
  text?: string
  caption?: string
  photo?: TgPhoto[]
  document?: TgDocument
}
type TgUpdate = { update_id: number; message?: TgMessage }

async function checkAccess(from: TgUser, chatId: number): Promise<boolean> {
  if (String(from.id) === adminTelegramId) return true
  const user = await prisma.user.findUnique({ where: { telegramUserId: BigInt(from.id) } })
  if (user?.accessStatus === 'APPROVED') return true
  if (user?.accessStatus === 'DENIED') {
    await telegram.sendMessage(chatId, '❌ Akses kamu ditolak admin. Hubungi admin jika ini keliru.')
    return false
  }
  if (!user) {
    const created = await prisma.user.create({
      data: {
        telegramUserId: BigInt(from.id),
        username: from.username,
        displayName: from.first_name,
        accessStatus: 'PENDING'
      }
    })
    await prisma.accessRequest.create({ data: { userId: created.id, status: 'PENDING' } })
    console.log(`[bot] ACCESS REQUEST created user=${from.id} (${from.username ?? from.first_name ?? 'anon'})`)
  }
  await telegram.sendMessage(chatId, '🔒 Akses belum aktif. Menunggu persetujuan admin.')
  console.log(`[bot] ACCESS DENIED (pending) user=${from.id}`)
  return false
}

// --- Photo pipeline: Telegram → R2 → Mistral OCR → agent ---
async function downloadFile(fileId: string): Promise<Uint8Array> {
  const res = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`, {
    signal: AbortSignal.timeout(30_000)
  })
  const meta = await res.json() as { ok: boolean; result?: { file_path?: string } }
  const filePath = meta.result?.file_path
  if (!meta.ok || !filePath) throw new Error('Telegram getFile failed')
  const fileRes = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`, {
    signal: AbortSignal.timeout(60_000)
  })
  const buf = new Uint8Array(await fileRes.arrayBuffer())
  if (buf.length > MAX_FILE_BYTES) throw new Error('File exceeds 20MB limit')
  return buf
}

async function handleAttachment(
  msg: TgMessage,
  fileId: string,
  opts: { mime: string; ext: string; label: string; filename: string }
): Promise<void> {
  const chatId = String(msg.chat.id)
  const userId = String(msg.from!.id)
  const caption = msg.caption?.trim()
  console.log(`[bot] FILE (${opts.label}) user=${userId} file=${fileId.slice(0, 20)}... caption="${caption?.slice(0, 50) ?? ''}"`)
  await telegram.sendMessage(msg.chat.id, `📎 ${opts.label} diterima. Sedang dibaca...`)
  try {
    const bytes = await downloadFile(fileId)
    console.log(`[bot] FILE downloaded ${bytes.length} bytes`)
    const key = `telegram/${new Date().toISOString().slice(0, 10)}/${fileId}${opts.ext}`
    await r2.send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: key,
      Body: bytes,
      ContentType: opts.mime
    }))
    console.log(`[bot] FILE archived r2://${process.env.R2_BUCKET}/${key}`)

    const ocrResult = await ocr.ocr({
      source: { type: 'bytes', data: bytes, filename: `tg-${fileId}${opts.ext}` }
    })
    const text = ocrResult.markdown
    console.log(`[bot] FILE OCR done (${text.length} chars)`)

    // Caption = user intent for this file. The agent decides: save as-is,
    // save with context, or search using the caption as the query.
    const prompt = [
      `Pengguna mengirim ${opts.label} dengan caption.`,
      'Caption adalah maksud pengguna: bisa perintah simpan, perintah cari, atau konteks tambahan.',
      `Caption: "${caption}"`,
      `Isi OCR file:\n${text.slice(0, 4000)}`
    ].join('\n\n')

    const archiveUri = `r2://${process.env.R2_BUCKET}/${key}`
    const result = await runAgent(agentFor(chatId, { sourceUrl: archiveUri, sourceType: 'photo' }), { telegramUserId: userId, chatId, message: prompt, timezone: 'Asia/Jakarta' })
    if (!result.ok) throw new Error(result.error)
    console.log(`[bot] FILE reply user=${userId}: "${result.reply.slice(0, 60)}"`)
    await telegram.sendMessage(msg.chat.id, result.reply)
  } catch (err) {
    console.error(`[bot] FILE FAILED user=${userId}: ${err instanceof Error ? err.message : err}`)
    await telegram.sendMessage(msg.chat.id, '❌ Gagal memproses file. Pastikan file valid dan berisi teks yang terbaca.')
  }
}

async function handleMessage(msg: TgMessage): Promise<void> {
  if (!msg.from) return
  const chatId = msg.chat.id
  const userId = String(msg.from.id)
  const text = msg.text?.trim()
  const adminIdNum = Number(adminTelegramId)

  // --- Admin commands (only for ADMIN_TELEGRAM_ID) ---
  const isAdminUser = userId === adminTelegramId
  const isAdminCommand = isAdminUser && (
    text === '/start' || ['/pending', '/approve', '/deny'].includes(text ?? '')
  )

  // Non-admin /start & /request_access → access request flow (bukan ke agent)
  if (!isAdminUser && (text === '/start' || text === '/request_access')) {
    const user = await prisma.user.findUnique({ where: { telegramUserId: BigInt(userId) } })
    if (user?.accessStatus === 'APPROVED') {
      await telegram.sendMessage(chatId, '✅ Akses sudah aktif. Langsung chat saja.')
    } else if (user?.accessStatus === 'DENIED') {
      await telegram.sendMessage(chatId, '❌ Akses kamu ditolak admin.')
    } else {
      if (!user) {
        const created = await prisma.user.create({
          data: {
            telegramUserId: BigInt(userId),
            username: msg.from.username,
            displayName: msg.from.first_name,
            accessStatus: 'PENDING'
          }
        })
        await prisma.accessRequest.create({ data: { userId: created.id, status: 'PENDING' } })
        console.log(`[bot] ACCESS REQUEST created user=${userId} (${msg.from.username ?? msg.from.first_name ?? 'anon'})`)
      }
      await telegram.sendMessage(chatId, '🔒 Permintaan akses dikirim ke admin. Mohon tunggu persetujuan.')
    }
    return
  }

  // Admin command → access management handler
  if (isAdminCommand && text) {
    const reply = await handleTelegramText(accessStore, msg.from, text, adminIdNum)
    await telegram.sendMessage(chatId, reply.text, reply.keyboard, reply.inline_keyboard)
    console.log(`[bot] ADMIN CMD user=${userId}: "${text}"`)
    return
  }

  if (!(await checkAccess(msg.from, chatId))) return

  // Compressed photo (Telegram always re-encodes to jpg)
  const photo = msg.photo?.reduce((a, b) => ((b.file_size ?? 0) > (a.file_size ?? 0) ? b : a))
  if (photo) {
    await handleAttachment(msg, photo.file_id, { mime: 'image/jpeg', ext: '.jpg', label: 'Screenshot', filename: 'photo.jpg' })
    return
  }

  // Document/file: images (png, jpg, webp, bmp, gif) and PDF
  if (msg.document) {
    const mime = imageDocumentMime(msg.document) ?? (msg.document.mime_type === 'application/pdf' ? 'application/pdf' : null)
    if (mime) {
      const name = msg.document.file_name
      const ext = name?.includes('.') ? `.${name.split('.').pop()!.toLowerCase()}` : (mime === 'application/pdf' ? '.pdf' : '.png')
      const label = mime === 'application/pdf' ? 'PDF' : 'Gambar'
      const filename = name ?? `file${ext}`
      await handleAttachment(msg, msg.document.file_id, { mime, ext, label, filename })
      return
    }
    await telegram.sendMessage(chatId, '📄 Format file belum didukung. Yang bisa dibaca: PNG, JPG, WEBP, BMP, GIF, PDF.')
    return
  }

  if (!text) return
  console.log(`[bot] TEXT user=${userId}: "${text.slice(0, 60)}"`)

  const result = await runAgent(agentFor(String(chatId)), { telegramUserId: userId, chatId: String(chatId), message: text, timezone: 'Asia/Jakarta' })
  if (!result.ok) {
    console.error(`[bot] TEXT FAILED user=${userId}: ${result.error}`)
    await telegram.sendMessage(chatId, '❌ Terjadi kesalahan. Coba lagi.')
    return
  }
  console.log(`[bot] TEXT reply user=${userId}: "${result.reply.slice(0, 60)}"`)
  await telegram.sendMessage(chatId, result.reply)

  // If the reply references archived images (r2://), send them back as photos.
  const r2Uris = [...result.reply.matchAll(/r2:\/\/[^\s)\]]+/g)].map((m) => m[0])
  if (r2Uris.length > 0) {
    for (const uri of r2Uris.slice(0, 3)) {
      const url = await presignR2(uri)
      if (url) {
        try {
          await telegram.sendPhotoByUrl(chatId, url, '📎 File terarsip')
          console.log(`[bot] IMAGE returned to chat=${chatId} (${uri.slice(0, 50)}...)`)
        } catch (err) {
          console.error(`[bot] sendPhoto failed: ${err instanceof Error ? err.message : err}`)
        }
      }
    }
  }
}

let offset: number | undefined
let running = true
process.on('SIGINT', () => { running = false })
process.on('SIGTERM', () => { running = false })

async function saveOffset(id: number): Promise<void> {
  await redis.set('bot:tg_offset', String(id))
}

async function poll(): Promise<void> {
  const raw = await redis.get('bot:tg_offset')
  offset = raw ? Number(raw) + 1 : undefined
  const updates = await telegram.getUpdates(offset)
  for (const u of updates) {
    await saveOffset(u.update_id)

    // Admin approval inline buttons (callback_query)
    const cb = (u as unknown as { callback_query?: {
      id: string
      from: TgUser
      data?: string
      message?: { chat: { id: number } }
    } }).callback_query
    if (cb?.data) {
      try {
        const reply = await handleTelegramCallback(accessStore, cb.from, cb.data, Number(adminTelegramId))
        await telegram.answerCallbackQuery(cb.id)
        if (cb.message) {
          await telegram.sendMessage(cb.message.chat.id, reply.text, undefined, reply.inline_keyboard)
          // Notify the affected user
          if (reply.accessUpdate) {
            const note = reply.accessUpdate.status === 'APPROVED'
              ? '✅ Akses kamu sudah disetujui admin. Selamat menggunakan bot!'
              : '❌ Permintaan akses kamu ditolak admin.'
            await telegram.sendMessage(reply.accessUpdate.userId, note)
            console.log(`[bot] ACCESS ${reply.accessUpdate.status} notified user=${reply.accessUpdate.userId}`)
          }
        }
      } catch (e) {
        console.error('[bot] callback error:', e instanceof Error ? e.message : e)
      }
      if (!running) break
      continue
    }

    const m = u.message as Record<string, unknown> | undefined
    if (m) {
      await handleMessage(m as unknown as TgMessage).catch((e) => console.error('[bot] handler error:', e.message))
    }
    if (!running) break
  }
}

console.log('Telegram agent bot (long polling) started')
while (running) {
  try {
    await poll()
  } catch (err) {
    console.error('[bot] poll error:', err instanceof Error ? err.message : err)
    await new Promise((r) => setTimeout(r, 3000))
  }
}
console.log('Telegram bot stopped')
await prisma.$disconnect()
await redis.quit()
