import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../../api/src/generated/prisma/index.js'
import { Redis } from 'ioredis'
import { Worker } from 'bullmq'
import { TelegramClient } from './telegram.js'

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL is required')
const token = process.env.TELEGRAM_BOT_TOKEN
if (!token) throw new Error('TELEGRAM_BOT_TOKEN is required')
const redisUrl = process.env.REDIS_URL
if (!redisUrl) throw new Error('REDIS_URL is required')

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) })
const redis = new Redis(redisUrl, { maxRetriesPerRequest: null })
const telegram = new TelegramClient(token)

type ReminderJobData = {
  reminderId: string
  chatId: string
  telegramUserId: string
  text: string
}

async function deliver(reminderId: string, chatId: string, text: string): Promise<boolean> {
  // Claim: only deliver if still PENDING (idempotent against safety net)
  const claimed = await prisma.reminder.updateMany({
    where: { id: reminderId, status: 'PENDING' },
    data: { status: 'SENDING' }
  })
  if (claimed.count === 0) return false
  try {
    await telegram.sendMessage(Number(chatId), `⏰ Pengingat: ${text}`)
    await prisma.reminder.update({ where: { id: reminderId }, data: { status: 'SENT', sentAt: new Date() } })
    return true
  } catch (err) {
    await prisma.reminder.update({ where: { id: reminderId }, data: { status: 'PENDING' } })
    throw err
  }
}

const worker = new Worker<ReminderJobData>(
  'send-reminder',
  async (job) => {
    const delivered = await deliver(job.data.reminderId, job.data.chatId, job.data.text)
    if (delivered) {
      console.log(`[reminder] SENT id=${job.data.reminderId} to chat=${job.data.chatId}`)
    } else {
      console.log(`[reminder] SKIP (already handled) id=${job.data.reminderId}`)
    }
  },
  { connection: redis.duplicate(), concurrency: 4 }
)

worker.on('failed', (job, err) => {
  console.error(`[reminder] FAILED attempt=${job?.attemptsMade} id=${job?.data.reminderId}: ${err.message}`)
})

// Safety net: catch PENDING reminders past due (missed jobs, Redis flush, downtime)
const SWEEP_INTERVAL_MS = 60_000
async function sweep(): Promise<void> {
  const due = await prisma.reminder.findMany({
    where: { status: 'PENDING', remindAt: { lte: new Date() } },
    take: 20,
    orderBy: { remindAt: 'asc' }
  })
  for (const r of due) {
    try {
      const delivered = await deliver(r.id, r.chatId.toString(), r.text)
      console.log(`[reminder] sweep ${delivered ? 'SENT' : 'skip'} id=${r.id}`)
    } catch (err) {
      console.error(`[reminder] sweep FAILED id=${r.id}: ${err instanceof Error ? err.message : err}`)
    }
  }
}

console.log('Reminder worker started (BullMQ + 60s sweep)')
const sweepTimer = setInterval(() => void sweep().catch((e) => console.error('[reminder] sweep error:', e.message)), SWEEP_INTERVAL_MS)
void sweep()

let running = true
process.on('SIGINT', () => { running = false })
process.on('SIGTERM', () => { running = false })
const exitCheck = setInterval(() => {
  if (!running) {
    clearInterval(sweepTimer)
    clearInterval(exitCheck)
    void worker.close().then(() => {
      console.log('Reminder worker stopped')
      return Promise.all([prisma.$disconnect(), redis.quit()])
    }).then(() => process.exit(0))
  }
}, 1000)
