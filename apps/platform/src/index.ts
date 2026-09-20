import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../../api/src/generated/prisma/index.js'
import { Redis } from 'ioredis'
import { MistralClient } from '@anvia/mistral'
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { createMemoryAgent, runAgent, createCompletionModel, ConversationMemoryStore, reminderQueue } from '@second-brain/agent'
import type { Agent } from '@anvia/core'
import type { McpServer } from '@anvia/core/mcp'
import { McpClientGroup } from '@anvia/mcp'
import { LensClient } from '@anvia/lens'
import type { ChannelAddress, ChannelEvent, ChannelMessage } from '@anvia/channel'
import type { TelegramUpdate } from '@anvia/telegram'
import { PrismaMemoryStore } from './memory-store.js'
import { embedText } from './embed.js'
import { createBot, imageDocumentMime } from './bot.js'
import { PrismaAccessStore } from './access-store.js'
import { handleTelegramCallback, handleTelegramText } from './handler.js'
import { createMcpClient, mcpServerCommand } from './mcp.js'
import { createLoginCode } from './dashboard-login.js'

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

// --- Observability (Anvia Lens): trace LLM/tool/cost, safe capture ---
const lens = new LensClient({
  baseUrl: process.env.ANVIA_LENS_BASE_URL,
  publicKey: process.env.ANVIA_LENS_PUBLIC_KEY,
  secretKey: process.env.ANVIA_LENS_SECRET_KEY,
  serviceName: 'second-brain-telegram-bot',
  environment: process.env.ANVIA_LENS_ENVIRONMENT ?? 'local',
  optional: true
})
console.log(`[lens] observability ${lens.enabled ? 'ENABLED' : 'disabled (no ANVIA_LENS_* env)'}`)

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

const { command, args } = mcpServerCommand()
console.log(`[mcp] client ready (spawn on demand: ${command} ${args.join(' ')})`)

/** MCP groups opened during in-flight requests; closed after each reply. */
const mcpGroups: McpClientGroup[] = []

/**
 * Build a per-request agent: set_reminder is bound to the chat the message
 * actually came from (trusted), never to an LLM-chosen chatId. When an
 * archived attachment exists for this message, save_memory auto-links it.
 *
 * MCP mode: tools come from the second-brain-memory MCP server over stdio
 * (PRD: standardized storage layer). Context (userId/chatId/attachment)
 * travels via the stdio child env — the LLM never sees or chooses these.
 */
async function agentFor(chatId: string, telegramUserId: string, attachment?: { sourceUrl: string; sourceType: string }): Promise<Agent> {
  const mcpClient = createMcpClient({ telegramUserId, chatId, attachment })
  let mcpServers: readonly McpServer[] | undefined
  try {
    const group = await McpClientGroup.connect({ clients: [mcpClient] })
    mcpServers = group.servers
    mcpGroups.push(group)
  } catch (err) {
    console.error(`[mcp] connect failed, falling back to in-process tools: ${err instanceof Error ? err.message : err}`)
  }
  return createMemoryAgent({
    store,
    embed: embedText,
    model,
    judgeModel,
    memory: new ConversationMemoryStore({ redis, ttlSeconds: 24 * 60 * 60 }),
    trustedChatId: chatId,
    attachment,
    mcpServers,
    observability: lens.enabled
      ? { observers: { lens: lens.observer({ captureMode: 'full' }) }, primaryTrace: 'lens' }
      : undefined,
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

// --- Channel adapter (Anvia) ---
const channel = createBot({ token, onEvent: async () => {} })
const addressFor = (chatId: string): ChannelAddress => ({ platform: 'telegram', conversationId: chatId })

/** Telegram message behind a normalized event (message/command share `raw.message`). */
function eventMessage(event: ChannelEvent<TelegramUpdate>): { text?: string; caption?: string; attachments?: ReadonlyArray<{ id: string; type: string; mediaType: string; filename?: string; size?: number }> } | null {
  if (event.type !== 'message' && event.type !== 'command') return null
  const msg = event.raw.message
  if (!msg) return null
  const attachments = msg.photo?.length || msg.document
    ? [
        ...(msg.photo?.length ? [{ id: msg.photo.at(-1)!.file_id, type: 'image', mediaType: 'image/jpeg' }] : []),
        ...(msg.document ? [{ id: msg.document.file_id, type: 'file', mediaType: msg.document.mime_type ?? 'application/octet-stream', filename: msg.document.file_name, size: msg.document.file_size }] : [])
      ]
    : undefined
  return { text: msg.text, caption: msg.caption, attachments }
}

function eventSender(event: ChannelEvent<TelegramUpdate>): { id: number; username?: string; first_name?: string } | null {
  if (!('sender' in event)) return null
  const raw = event.raw.message?.from ?? event.raw.callback_query?.from
  if (!raw) return { id: Number(event.sender.id) }
  return { id: raw.id, username: raw.username, first_name: raw.first_name }
}

function senderUserId(event: ChannelEvent<TelegramUpdate>): string {
  return 'sender' in event ? event.sender.id : ''
}

// ponytail: adapter @anvia/telegram tak expose parse_mode, jadi Markdown dari LLM
// di-strip ke plain text. Kalau butuh bold asli, upgrade: convert → HTML + patch adapter.
function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|\W)\*([^*\n]+)\*(?=\W|$)/g, '$1$2')
    .replace(/(^|\W)_([^_\n]+)_(?=\W|$)/g, '$1$2')
    .replace(/`([^`\n]+)`/g, '$1')
}

async function reply(address: ChannelAddress, message: ChannelMessage): Promise<void> {
  const parts = channel.splitMessage({ ...message, text: message.text ? stripMarkdown(message.text) : message.text })
  for (const part of parts) {
    await channel.send(address, part)
  }
}

// --- Access gate (admin bypass; others need APPROVED) ---
async function checkAccess(from: { id: number; username?: string; first_name?: string }, chatId: string): Promise<boolean> {
  const address = addressFor(chatId)
  if (String(from.id) === adminTelegramId) return true
  const user = await prisma.user.findUnique({ where: { telegramUserId: BigInt(from.id) } })
  if (user?.accessStatus === 'APPROVED') return true
  if (user?.accessStatus === 'DENIED') {
    await reply(address, { text: '❌ Akses kamu ditolak admin. Hubungi admin jika ini keliru.' })
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
  await reply(address, { text: '🔒 Akses belum aktif. Menunggu persetujuan admin.' })
  console.log(`[bot] ACCESS DENIED (pending) user=${from.id}`)
  return false
}

// --- Attachment pipeline: Telegram → R2 → Mistral OCR → agent ---
async function downloadFile(fileId: string): Promise<Uint8Array> {
  const data = await channel.loadAttachment({ type: 'message', id: '', platform: 'telegram', conversation: { id: '', kind: 'direct' }, sender: { id: '', bot: false }, text: '', attachments: [], mentionedBot: false, raw: {} as TelegramUpdate }, { id: fileId, type: 'file', mediaType: 'application/octet-stream' })
  const buf = new Uint8Array(Buffer.from(data.type === 'data' ? data.data : '', 'base64'))
  if (buf.length > MAX_FILE_BYTES) throw new Error('File exceeds 20MB limit')
  return buf
}

async function handleAttachment(
  event: ChannelEvent<TelegramUpdate>,
  address: ChannelAddress,
  fileId: string,
  opts: { mime: string; ext: string; label: string; filename: string }
): Promise<void> {
  const chatId = address.conversationId
  const userId = senderUserId(event)
  const caption = eventMessage(event)?.caption?.trim()
  console.log(`[bot] FILE (${opts.label}) user=${userId} file=${fileId.slice(0, 20)}... caption="${caption?.slice(0, 50) ?? ''}"`)
  await reply(address, { text: `📎 ${opts.label} diterima. Sedang dibaca...` })
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
    const sourceType = opts.mime === 'application/pdf' ? 'pdf' : opts.mime.startsWith('image/') ? 'photo' : 'document'
    const agent = await agentFor(chatId, userId, { sourceUrl: archiveUri, sourceType })
    const result = await runAgent(agent, { telegramUserId: userId, chatId, message: prompt, timezone: 'Asia/Jakarta' })
    if (!result.ok) throw new Error(result.error)
    console.log(`[bot] FILE reply user=${userId}: "${result.reply.slice(0, 60)}"`)
    await reply(address, { text: result.reply })
  } catch (err) {
    console.error(`[bot] FILE FAILED user=${userId}: ${err instanceof Error ? err.message : err}`)
    await reply(address, { text: '❌ Gagal memproses file. Pastikan file valid dan berisi teks yang terbaca.' })
  } finally {
    await teardownRequest()
  }
}

async function handleMessage(event: ChannelEvent<TelegramUpdate>, address: ChannelAddress): Promise<void> {
  const chatId = address.conversationId
  const userId = senderUserId(event)
  const from = eventSender(event)
  const msg = eventMessage(event)
  if (!from || !msg) return
  const text = msg.text?.trim()
  const adminIdNum = Number(adminTelegramId)

  // --- Admin commands (only for ADMIN_TELEGRAM_ID) ---
  const isAdminUser = userId === adminTelegramId
  const isAdminCommand = isAdminUser && (
    text === '/start' || ['/pending', '/approve', '/deny'].includes(text ?? '')
  )

  // /dashboard — any user requests their own dashboard login code.
  if (text === '/dashboard') {
    const user = await prisma.user.findUnique({ where: { telegramUserId: BigInt(userId) } })
    if (!user || user.accessStatus !== 'APPROVED') {
      await reply(address, { text: '🔒 Dashboard hanya untuk user yang sudah disetujui admin.' })
      return
    }
    const code = await createLoginCode(redis, userId)
    await reply(address, {
      text: `🔐 Kode login dashboard (berlaku 5 menit):\n\n${code}\n\nMasukkan di ${process.env.DASHBOARD_URL ?? 'http://localhost:5173'}/dashboard`
    })
    console.log(`[bot] DASHBOARD code issued user=${userId}`)
    return
  }

  // Non-admin /start & /request_access → access request flow (bukan ke agent)
  if (!isAdminUser && (text === '/start' || text === '/request_access')) {
    const user = await prisma.user.findUnique({ where: { telegramUserId: BigInt(userId) } })
    if (user?.accessStatus === 'APPROVED') {
      await reply(address, { text: '✅ Akses sudah aktif. Langsung chat saja.' })
    } else if (user?.accessStatus === 'DENIED') {
      await reply(address, { text: '❌ Akses kamu ditolak admin.' })
    } else {
      if (!user) {
        const created = await prisma.user.create({
          data: {
            telegramUserId: BigInt(userId),
            username: from.username,
            displayName: from.first_name,
            accessStatus: 'PENDING'
          }
        })
        await prisma.accessRequest.create({ data: { userId: created.id, status: 'PENDING' } })
        console.log(`[bot] ACCESS REQUEST created user=${userId} (${from.username ?? from.first_name ?? 'anon'})`)
      }
      await reply(address, { text: '🔒 Permintaan akses dikirim ke admin. Mohon tunggu persetujuan.' })
    }
    return
  }

  // Admin command → access management handler
  if (isAdminCommand && text) {
    const r = await handleTelegramText(accessStore, from, text, adminIdNum)
    await reply(address, { text: r.text, actions: r.actions })
    console.log(`[bot] ADMIN CMD user=${userId}: "${text}"`)
    return
  }

  if (!(await checkAccess(from, chatId))) return

  // Attachments: photos (Telegram re-encodes to jpg) + documents (images/PDF)
  const attachments = msg.attachments ?? []
  const photo = attachments.find((a) => a.type === 'image' && a.mediaType === 'image/jpeg' && !a.filename)
  const document = attachments.find((a) => a !== photo)
  const target = photo ?? document
  if (target) {
    const isPhoto = target === photo
    const mime = isPhoto ? 'image/jpeg' : (imageDocumentMime(target) ?? (target.mediaType === 'application/pdf' ? 'application/pdf' : null))
    if (mime) {
      const ext = isPhoto ? '.jpg' : (target.filename?.includes('.') ? `.${target.filename.split('.').pop()!.toLowerCase()}` : (mime === 'application/pdf' ? '.pdf' : '.png'))
      const label = mime === 'application/pdf' ? 'PDF' : (isPhoto ? 'Screenshot' : 'Gambar')
      const filename = target.filename ?? `file${ext}`
      await handleAttachment(event, address, target.id, { mime, ext, label, filename })
      return
    }
    await reply(address, { text: '📄 Format file belum didukung. Yang bisa dibaca: PNG, JPG, WEBP, BMP, GIF, PDF.' })
    return
  }

  if (!text) return
  console.log(`[bot] TEXT user=${userId}: "${text.slice(0, 60)}"`)

  try {
    const agent = await agentFor(chatId, userId)
    const result = await runAgent(agent, { telegramUserId: userId, chatId, message: text, timezone: 'Asia/Jakarta' })
    if (!result.ok) {
      console.error(`[bot] TEXT FAILED user=${userId}: ${result.error}`)
      await reply(address, { text: '❌ Terjadi kesalahan. Coba lagi.' })
      return
    }
    console.log(`[bot] TEXT reply user=${userId}: "${result.reply.slice(0, 60)}"`)
    await reply(address, { text: result.reply })

    // If the reply references archived images (r2://), send them back as photos.
    const r2Uris = [...result.reply.matchAll(/r2:\/\/[^\s)\]]+/g)].map((m) => m[0])
    if (r2Uris.length > 0) {
      for (const uri of r2Uris.slice(0, 3)) {
        const url = await presignR2(uri)
        if (url) {
          try {
            await channel.send(address, {
              text: '',
              attachments: [{ type: 'image', mediaType: 'image/jpeg', filename: 'archive.jpg', source: { type: 'url', url } }]
            })
            console.log(`[bot] IMAGE returned to chat=${chatId} (${uri.slice(0, 50)}...)`)
          } catch (err) {
            console.error(`[bot] sendPhoto failed: ${err instanceof Error ? err.message : err}`)
          }
        }
      }
    }
  } finally {
    await teardownRequest()
  }
}

/** Close MCP groups spawned during the request + flush Lens traces. */
async function teardownRequest(): Promise<void> {
  while (mcpGroups.length > 0) {
    const group = mcpGroups.pop()!
    try {
      await group.close()
    } catch (err) {
      console.error(`[mcp] close failed: ${err instanceof Error ? err.message : err}`)
    }
  }
  if (lens.enabled) {
    try {
      await lens.flush()
    } catch (err) {
      console.error(`[lens] flush failed: ${err instanceof Error ? err.message : err}`)
    }
  }
}

let running = true
process.on('SIGINT', () => { running = false })
process.on('SIGTERM', () => { running = false })

async function onEvent(event: ChannelEvent<TelegramUpdate>): Promise<void> {
  const address: ChannelAddress = { platform: 'telegram', conversationId: event.conversation.id }

  // Admin approval inline buttons
  if (event.type === 'action') {
    const from = eventSender(event)
    if (!from) return
    try {
      const r = await handleTelegramCallback(accessStore, from, event.actionId, Number(adminTelegramId))
      await reply(address, { text: r.text, actions: r.actions })
      if (r.accessUpdate) {
        const note = r.accessUpdate.status === 'APPROVED'
          ? '✅ Akses kamu sudah disetujui admin. Selamat menggunakan bot!'
          : '❌ Permintaan akses kamu ditolak admin.'
        await reply(addressFor(String(r.accessUpdate.userId)), { text: note })
        console.log(`[bot] ACCESS ${r.accessUpdate.status} notified user=${r.accessUpdate.userId}`)
      }
    } catch (e) {
      console.error('[bot] callback error:', e instanceof Error ? e.message : e)
    }
    return
  }

  // Commands (/start, /pending, ...) arrive as command events — same text flow.
  if (event.type === 'command') {
    await handleMessage(event, address).catch((e) => console.error('[bot] handler error:', e instanceof Error ? e.message : e))
    return
  }

  if (event.type === 'message') {
    await channel.showTyping(address).catch(() => {})
    await handleMessage(event, address).catch((e) => console.error('[bot] handler error:', e instanceof Error ? e.message : e))
    return
  }

  // message-edited / message-deleted / reaction: not used by this bot.
}

await channel.start(onEvent)
console.log('Telegram agent bot (@anvia/telegram channel) started')
// Keep the process alive; the channel polls internally.
while (running) {
  await new Promise((r) => setTimeout(r, 500))
}
console.log('Telegram bot stopped')
try {
  await channel.stop()
} catch (err) {
  console.error(`[bot] stop error: ${err instanceof Error ? err.message : err}`)
}
await teardownRequest()
if (lens.enabled) {
  try {
    await lens.close()
  } catch (err) {
    console.error(`[lens] close failed: ${err instanceof Error ? err.message : err}`)
  }
}
await prisma.$disconnect()
await redis.quit()
