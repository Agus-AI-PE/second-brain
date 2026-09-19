// Interactive CLI harness — test agent without Telegram/infra.
// Env from `pnpm run agent` → dotenv-cli (repo-root .env).
import * as readline from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { LensClient } from '@anvia/lens'
import { Redis } from 'ioredis'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../../api/src/generated/prisma/index.js'
import { PrismaMemoryStore } from './memory-store.js'
import { embedText } from './embed.js'
import { createMemoryAgent, createCompletionModel, runAgent, ConversationMemoryStore } from '@second-brain/agent'

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL is required')

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) })
const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: null })
const store = new PrismaMemoryStore(prisma, redis)
const model = createCompletionModel({
  baseUrl: process.env.OPENAI_BASE_URL ?? '',
  apiKey: process.env.OPENAI_API_KEY ?? '',
  modelId: process.env.AGENT_MODEL ?? 'gpt-5.6-luna'
})

const ADMIN_ID = process.env.ADMIN_TELEGRAM_ID ?? ''

const lens = new LensClient({
  baseUrl: process.env.ANVIA_LENS_BASE_URL,
  publicKey: process.env.ANVIA_LENS_PUBLIC_KEY,
  secretKey: process.env.ANVIA_LENS_SECRET_KEY,
  serviceName: 'second-brain-cli',
  environment: process.env.ANVIA_LENS_ENVIRONMENT ?? 'local',
  optional: true
})

async function main(): Promise<void> {
  if (!ADMIN_ID) throw new Error('ADMIN_TELEGRAM_ID is required')

  const agent = createMemoryAgent({
    store,
    embed: embedText,
    model,
    memory: new ConversationMemoryStore({ redis, ttlSeconds: 900 }),
    trustedChatId: ADMIN_ID,
    observability: lens.enabled
      ? { observers: { lens: lens.observer({ captureMode: 'full' }) }, primaryTrace: 'lens' }
      : undefined
  })

  const rl = readline.createInterface({ input: stdin, output: stdout })
  console.log(`[cli] agent ready. user=${ADMIN_ID} model=${process.env.AGENT_MODEL ?? 'gpt-5.6-luna'}`)
  console.log('[cli] type message, /quit to exit')

  while (true) {
    const message = await rl.question('\nyou> ')
    if (!message.trim()) continue
    if (message.trim() === '/quit') break

    const result = await runAgent(agent, {
      telegramUserId: ADMIN_ID,
      chatId: ADMIN_ID,
      message,
      timezone: process.env.TZ ?? 'Asia/Jakarta'
    })
    console.log(result.ok ? `\nagent> ${result.reply}` : `\n[cli] ERROR: ${result.error}`)
  }

  rl.close()
  await prisma.$disconnect()
  await redis.quit()
  if (lens.enabled) await lens.close()
}

main().catch((err) => {
  console.error('[cli] FAILED:', err instanceof Error ? err.message : err)
  process.exit(1)
})
