import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from './generated/prisma/index.js'
import { Agent } from '@anvia/core'
import { createAgent } from './agent.js'
import { Redis } from 'ioredis'

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL is required')
const telegramToken = process.env.TELEGRAM_BOT_TOKEN
if (!telegramToken) throw new Error('TELEGRAM_BOT_TOKEN is required')
const redisUrl = process.env.REDIS_URL
if (!redisUrl) throw new Error('REDIS_URL is required')

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) })
const connection = new Redis(redisUrl, { maxRetriesPerRequest: null })
const agent = createAgent({ prisma }) as Agent

const adminTelegramId = process.env.ADMIN_TELEGRAM_ID
if (!adminTelegramId) throw new Error('ADMIN_TELEGRAM_ID is required')

const MAX_FILE_BYTES = 20 * 1024 * 1024
const OFFSET_FILE = 'bot:tg_offset'

type TgPhoto = { file_id: string; file_size?: number }
type TgMessage = {
  message_id: number
  chat: { id: number }
  from?: { id: number; username?: string; first_name?: string }
  text?: string
  caption?: string
  photo?: TgPhoto[]
}
type TgUpdate = { update_id: number; message?: TgMessage }

async function tgApi<T = unknown>(method: string, body?: Record<string, unknown>): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${telegramToken}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(65_000)
  })
  const json = await res.json() as { ok: boolean; result?: T; description?: string }
  if (!json.ok) throw new Error(`Telegram ${method} failed: ${json.description}`)
  return json.result as T
}

async function getOffset(): Promise<number | undefined> {
  const raw = await connection.get(OFFSET_FILE)
  return raw ? Number(raw) + 1 : undefined
}

async function saveOffset(id: number): Promise<void> {
  await connection.set(OFFSET_FILE, String(id))
}

function pickLargestPhoto(msg: TgMessage): TgPhoto | undefined {
  return msg.photo?.reduce((a, b) => ((b.file_size ?? 0) > (a.file_size ?? 0) ? b : a))
}

function isAdmin(telegramUserId: string): boolean {
  return telegramUserId === adminTelegramId
}

type AccessCheck =
  | { allowed: true }
  | { allowed: false; reply: string }

async function checkAccess(msg: TgMessage): Promise<AccessCheck> {
  const userId = msg.from ? String(msg.from.id) : String(msg.chat.id)
  if (isAdmin(userId)) return { allowed: true }

  const user = await prisma.user.findUnique({ where: { telegramUserId: BigInt(userId) } })

  if (user?.accessStatus === 'APPROVED') return { allowed: true }
  if (user?.accessStatus === 'DENIED') {
    return { allowed: false, reply: '❌ Akses kamu ditolak admin. Hubungi admin jika ini keliru.' }
  }

  if (!user) {
    const created = await prisma.user.create({
      data: {
        telegramUserId: BigInt(userId),
        username: msg.from?.username,
        displayName: msg.from?.first_name,
        accessStatus: 'PENDING'
      }
    })
    await prisma.accessRequest.create({
      data: { userId: created.id, status: 'PENDING' }
    })
    console.log(`[bot] ACCESS REQUEST created user=${userId} (${msg.from?.username ?? msg.from?.first_name ?? 'anon'})`)
    return {
      allowed: false,
      reply: '🔒 Akses diminta. Menunggu persetujuan admin — kamu akan bisa pakai bot setelah disetujui.'
    }
  }

  // PENDING user already has a request
  return {
    allowed: false,
    reply: '🔒 Masih menunggu persetujuan admin. Coba lagi nanti.'
  }
}

async function handleMessage(msg: TgMessage): Promise<void> {
  const chatId = String(msg.chat.id)
  const userId = msg.from ? String(msg.from.id) : chatId

  const access = await checkAccess(msg)
  if (!access.allowed) {
    console.log(`[bot] ACCESS DENIED (pending/denied) user=${userId}`)
    await tgApi('sendMessage', { chat_id: chatId, text: access.reply })
    return
  }

  const photo = pickLargestPhoto(msg)
  if (photo) {
    console.log(`[bot] PHOTO from user=${userId} fileId=${photo.file_id.slice(0, 20)}...`)
    await tgApi('sendMessage', {
      chat_id: chatId,
      text: '📸 Screenshot diterima. Sedang membaca teksnya (OCR)...'
    })
    try {
      const response = await agent.generate({
        prompt: `[telegramUserId: ${userId}, chatId: ${chatId}]\nSimpan screenshot ini. file_id: ${photo.file_id}. Caption pengguna: ${msg.caption ?? '(tidak ada)'}. Konfirmasi singkat setelah disimpan.`
      })
      const reply = response.type === 'response' ? response.text : 'Gagal memproses screenshot.'
      console.log(`[bot] PHOTO reply user=${userId}: "${reply.slice(0, 60)}"`)
      await tgApi('sendMessage', { chat_id: chatId, text: reply })
    } catch (err) {
      console.error(`[bot] PHOTO FAILED user=${userId}: ${err instanceof Error ? err.message : err}`)
      await tgApi('sendMessage', { chat_id: chatId, text: '❌ Gagal menyimpan screenshot. Coba lagi.' })
    }
    return
  }

  const text = msg.text?.trim()
  if (!text) return
  console.log(`[bot] TEXT from user=${userId}: "${text.slice(0, 60)}"`)

  try {
    const response = await agent.generate({
      prompt: `[telegramUserId: ${userId}, chatId: ${chatId}]\n${text}`
    })
    if (response.type !== 'response') throw new Error(`outcome=${response.type}`)
    console.log(`[bot] TEXT reply user=${userId}: "${response.text.slice(0, 60)}"`)
    await tgApi('sendMessage', { chat_id: chatId, text: response.text })
  } catch (err) {
    console.error(`[bot] TEXT FAILED user=${userId}: ${err instanceof Error ? err.message : err}`)
    await tgApi('sendMessage', { chat_id: chatId, text: '❌ Terjadi kesalahan. Coba lagi.' })
  }
}

let running = true
process.on('SIGINT', () => { running = false })
process.on('SIGTERM', () => { running = false })

console.log('Telegram bot (long polling) started')
while (running) {
  try {
    const updates = await tgApi<TgUpdate[]>('getUpdates', {
      offset: await getOffset(),
      timeout: 50,
      allowed_updates: ['message']
    })
    for (const u of updates) {
      await saveOffset(u.update_id)
      if (u.message) await handleMessage(u.message).catch((e) => console.error('[bot] handler error:', e.message))
      if (!running) break
    }
  } catch (err) {
    console.error('[bot] poll error:', err instanceof Error ? err.message : err)
    await new Promise((r) => setTimeout(r, 3000))
  }
}
console.log('Telegram bot stopped')
await prisma.$disconnect()
await connection.quit()
