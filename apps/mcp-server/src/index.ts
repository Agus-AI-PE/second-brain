import './env.js'
import { PrismaPg } from '@prisma/adapter-pg'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { McpServer } from '@modelcontextprotocol/server'
import { Redis } from 'ioredis'
import { PrismaClient } from '../../api/src/generated/prisma/index.js'
import { PrismaMemoryStore } from '../../platform/src/memory-store.js'
import { reminderQueue } from '@second-brain/agent'
import { registerMemoryTools } from './tools.js'

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL is required')
const redisUrl = process.env.REDIS_URL
if (!redisUrl) throw new Error('REDIS_URL is required')

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) })
const redis = new Redis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: false })
const store = new PrismaMemoryStore(prisma, redis)

serveStdio(() => {
  const server = new McpServer({ name: 'second-brain-memory', version: '1.0.0' }, { capabilities: { tools: {} } })
  registerMemoryTools(server, {
    store,
    // Delayed delivery: same queue/workers as the agent path.
    scheduleReminder: async (job: { reminderId: string; chatId: string; telegramUserId: string; text: string; deliverAt: Date }) => {
      const delay = Math.max(0, job.deliverAt.getTime() - Date.now())
      await reminderQueue(redis).add('deliver', job, { delay })
    }
  })
  return server
})

process.on('SIGINT', async () => {
  await prisma.$disconnect()
  await redis.quit()
  process.exit(0)
})
