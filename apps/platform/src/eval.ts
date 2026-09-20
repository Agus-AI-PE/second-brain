// Env comes from `pnpm run eval` → dotenv-cli (repo-root .env).
import { agentEvalTarget, contains, runEvalSuite } from '@anvia/core/evals'
import type { EvalReporter } from '@anvia/core/evals'
import { LensClient } from '@anvia/lens'
import { Redis } from 'ioredis'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../../api/src/generated/prisma/index.js'
import { PrismaMemoryStore } from './memory-store.js'
import { embedText } from './embed.js'
import { createMemoryAgent, createCompletionModel, ConversationMemoryStore } from '@second-brain/agent'

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

const lens = new LensClient({
  baseUrl: process.env.ANVIA_LENS_BASE_URL,
  publicKey: process.env.ANVIA_LENS_PUBLIC_KEY,
  secretKey: process.env.ANVIA_LENS_SECRET_KEY,
  serviceName: 'second-brain-rag-eval',
  environment: process.env.ANVIA_LENS_ENVIRONMENT ?? 'local',
  optional: true
})

const ADMIN_ID = process.env.ADMIN_TELEGRAM_ID ?? ''

/**
 * RAG eval cases: input = recall question, expected = substring that must
 * appear in the answer. Seeds one memory per case for retrieval ground truth,
 * cleans up after.
 */
const CASES = [
  {
    id: 'react-article',
    memory: 'Artikel React 19: actions memungkinkan form submission tanpa useState manual.',
    input: 'cariin artikel react yang aku simpan',
    expected: 'React 19'
  },
  {
    id: 'deploy-note',
    memory: 'Server staging deployment pakai docker compose di VPS Hetzner CX22.',
    input: 'di mana aku deploy staging?',
    expected: 'Hetzner'
  }
]

const consoleReporter: EvalReporter<string> = {
  report(args) {
    const out = args.output as { output?: string } | undefined
    const text = typeof out?.output === 'string' ? out.output : String(args.output)
    console.log(`[eval] ${args.case.id}: ${args.outcome?.outcome ?? 'unknown'} | output="${text.slice(0, 140).replace(/\n/g, ' ')}"`)
  }
}

async function main(): Promise<void> {
  if (!ADMIN_ID) throw new Error('ADMIN_TELEGRAM_ID is required (eval uses the admin user)')

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

  // Seed memories so retrieval has ground truth.
  const seeded: string[] = []
  for (const c of CASES) {
    const m = await store.createMemory({ telegramUserId: ADMIN_ID, content: c.memory, sourceType: 'text', sourceUrl: null })
    seeded.push(m.id)
    console.log(`[eval] seeded memory=${m.id} (${c.id})`)
  }
  console.log('[eval] waiting 20s for embedding worker to index seeds...')
  await new Promise((r) => setTimeout(r, 20_000))

  const result = await runEvalSuite({
    name: 'rag-recall',
    cases: CASES.map((c) => ({ id: c.id, input: c.input, expected: c.expected })),
    target: agentEvalTarget<string, string, { output: string }>({
      agent,
      // Same context header the bot builds in runAgent — tools need the
      // telegramUserId binding from it.
      request: ({ input, testCase }) => ({
        prompt: [
          `[Context]`,
          `telegramUserId: ${ADMIN_ID}`,
          `chatId: ${ADMIN_ID}`,
          `Current date: ${new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' })} (Asia/Jakarta)`
        ].join('\n') + `\n\nUser: ${input}`,
        session: { sessionId: `eval:${testCase.id}:${Date.now()}`, userId: ADMIN_ID }
      }),
      // Metric `contains()` and the console reporter read `.output`.
      output: ({ response }) => ({ output: response.text })
    }),
    metrics: [contains()],
    reporters: [...(lens.enabled ? [lens.evalReporter()] : []), consoleReporter]
  })

  console.log('[eval] suite done:', JSON.stringify(result.cases), 'metrics:', JSON.stringify(result.metrics))
  for (const id of seeded) {
    await prisma.memory.delete({ where: { id } }).catch(() => {})
  }
  console.log('[eval] cleaned up seeds')
  await prisma.$disconnect()
  await redis.quit()
  if (lens.enabled) {
    // Observability must never fail the eval run (bad keys / Lens down).
    await lens.close().catch((err) => {
      console.warn('[eval] lens close failed (ignored):', err instanceof Error ? err.message : err)
    })
  }
}

main().catch((err) => {
  console.error('[eval] FAILED:', err instanceof Error ? err.message : err)
  process.exit(1)
})
