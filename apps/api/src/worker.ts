import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from './generated/prisma/index.js'
import { MistralClient } from '@anvia/mistral'
import { Worker, type Job } from 'bullmq'
import { Redis } from 'ioredis'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { upsertMemoryVector } from './vector.js'
import { archiveToR2 } from './r2.js'
import { embedText, EMBED_MODEL, EMBED_DIM } from './embed.js'

const runCurl = promisify(execFile)

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL is required')
const redisUrl = process.env.REDIS_URL
if (!redisUrl) throw new Error('REDIS_URL is required')
const mistralApiKey = process.env.MISTRAL_API_KEY
if (!mistralApiKey) throw new Error('MISTRAL_API_KEY is required')
const telegramToken = process.env.TELEGRAM_BOT_TOKEN
if (!telegramToken) throw new Error('TELEGRAM_BOT_TOKEN is required')

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) })
const connection = new Redis(redisUrl, { maxRetriesPerRequest: null })
const mistral = new MistralClient({ apiKey: mistralApiKey })
const ocr = mistral.ocrModel({ modelId: process.env.MISTRAL_OCR_MODEL ?? 'mistral-ocr-latest' })
const MAX_RETRIES = 5
const MAX_FILE_BYTES = 20 * 1024 * 1024

async function downloadTelegramFile(fileId: string): Promise<Uint8Array> {
  const metaRaw = await runCurl('/usr/bin/curl', [
    '-s', '--max-time', '30',
    `https://api.telegram.org/bot${telegramToken}/getFile?file_id=${encodeURIComponent(fileId)}`
  ], { maxBuffer: 1024 * 1024 })
  const meta = JSON.parse(metaRaw.stdout) as { ok: boolean; result?: { file_path?: string } }
  const filePath = meta.result?.file_path
  if (!meta.ok || !filePath) throw new Error(`Telegram getFile failed: ${metaRaw.stdout.slice(0, 120)}`)
  const fileRaw = await runCurl('/usr/bin/curl', [
    '-s', '--fail', '--max-time', '60',
    `https://api.telegram.org/file/bot${telegramToken}/${filePath}`
  ], { maxBuffer: MAX_FILE_BYTES, encoding: 'buffer' })
  if (fileRaw.stdout.length > MAX_FILE_BYTES) throw new Error('File exceeds 20MB limit')
  return new Uint8Array(fileRaw.stdout)
}

// File → R2 archive → Mistral OCR (upload) → markdown
async function ocrTelegramFile(fileId: string): Promise<{ text: string; mistralFileId: string | null; archiveUrl: string }> {
  console.log(`[photo] downloading from Telegram: ${fileId.slice(0, 20)}...`)
  const bytes = await downloadTelegramFile(fileId)
  console.log(`[photo] downloaded ${bytes.length} bytes, archiving to R2...`)
  const key = `telegram/${new Date().toISOString().slice(0, 10)}/${fileId}.jpg`
  const archiveUrl = await archiveToR2(key, bytes, 'image/jpeg')
  console.log(`[photo] archived: ${archiveUrl}`)
  console.log('[photo] running Mistral OCR...')
  const result = await ocr.ocr({
    source: { type: 'bytes', data: bytes, filename: `tg-${fileId}.jpg` }
  })
  console.log(`[photo] OCR done (${result.markdown.length} chars)`)
  return {
    text: result.markdown,
    mistralFileId: result.uploadedFile?.id ?? null,
    archiveUrl
  }
}

async function processJob(job: Job<{ memoryId: string }>): Promise<void> {
  const memory = await prisma.memory.findUnique({ where: { id: job.data.memoryId } })
  if (!memory) {
    job.log('memory not found, skipping')
    return
  }

  let content = memory.content

  if (memory.sourceType === 'photo' && memory.telegramFileId) {
    const { text, mistralFileId, archiveUrl } = await ocrTelegramFile(memory.telegramFileId)
    content = text
    await prisma.memory.update({
      where: { id: memory.id },
      data: { content, mistralFileId, sourceUrl: archiveUrl }
    })
  }

  if (!content.trim()) throw new Error('No content to embed after OCR')

  console.log(`[worker] embedding ${content.length} chars...`)
  const vector = await embedText(content)
  await upsertMemoryVector(memory.id, content, vector, {
    userId: memory.userId,
    memoryId: memory.id,
    sourceType: memory.sourceType,
    sourceUrl: memory.sourceUrl,
    createdAt: memory.createdAt.toISOString()
  })
}

const worker = new Worker('embedding', processJob, {
  connection,
  concurrency: 4
})

worker.on('completed', (job) => console.log(`[worker] SAVE OK memory=${job.data.memoryId}`))
worker.on('failed', (job, err) => {
  console.error(`[worker] SAVE FAILED (${job?.attemptsMade}/${MAX_RETRIES}) memory=${job?.data.memoryId}: ${err.message}`)
})
worker.on('error', (err) => console.error('worker error:', err.message))

console.log(`Embedding worker started on ${redisUrl}, model=${EMBED_MODEL}, ocr=mistral-ocr`)
