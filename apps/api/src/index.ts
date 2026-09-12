import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from './generated/prisma/index.js'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { embeddingQueue } from './queue.js'
import { deleteMemoryVector, searchMemoryVectors } from './vector.js'
import { embedText } from './embed.js'

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL is required')
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) })

const MAX_CONTENT = 100_000
const FETCH_TIMEOUT_MS = 10_000

function stripHtml(html: string): string {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ''
  const body = html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
  return title ? `${title}\n\n${body}` : body
}

async function scrapeUrl(url: string): Promise<string> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { 'user-agent': 'second-brain/0.1' },
    redirect: 'follow'
  })
  if (!res.ok) throw new Error(`Fetch failed: HTTP ${res.status}`)
  const html = await res.text()
  const text = stripHtml(html)
  if (!text) throw new Error('No readable text found')
  return text
}

function resolveUser(telegramUserId: bigint) {
  return prisma.user.upsert({
    where: { telegramUserId },
    update: {},
    create: { telegramUserId }
  })
}

const app = new Hono()

app.get('/', (c) => c.text('Second Brain API'))
app.get('/health', (c) => c.json({ ok: true }))

app.post('/memories', async (c) => {
  const body = await c.req.json<{
    telegramUserId?: string
    content?: string
    url?: string
    telegramFileId?: string
    telegramChatId?: string
    telegramMessageId?: number
  }>().catch(() => null)
  const tid = body?.telegramUserId ? BigInt(body.telegramUserId) : null
  if (tid === null || !/^\d+$/.test(body?.telegramUserId ?? '')) {
    return c.json({ error: 'telegramUserId (numeric) is required' }, 400)
  }
  const user = await resolveUser(tid)

  let content = ''
  let sourceType = 'text'
  let sourceUrl: string | null = null

  if (body?.url) {
    let parsed: URL
    try {
      parsed = new URL(body.url)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error()
    } catch {
      return c.json({ error: 'url must be a valid http(s) URL' }, 400)
    }
    try {
      content = await scrapeUrl(parsed.toString())
      sourceType = 'url'
      sourceUrl = parsed.toString()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Scrape failed'
      return c.json({ error: message }, 502)
    }
  } else if (body?.telegramFileId) {
    // Photo/screenshot from Telegram: store the file_id; OCR runs in the worker.
    sourceType = 'photo'
    content = ''
  } else if (body?.content && body.content.trim()) {
    content = body.content.trim()
  } else {
    return c.json({ error: 'Provide either content, url, or telegramFileId' }, 400)
  }

  if (content.length > MAX_CONTENT) content = content.slice(0, MAX_CONTENT)

  const memory = await prisma.memory.create({
    data: {
      userId: user.id,
      content,
      sourceType,
      sourceUrl,
      telegramFileId: body?.telegramFileId ?? null,
      telegramChatId: body?.telegramChatId ? BigInt(body.telegramChatId) : null,
      telegramMessageId: body?.telegramMessageId ?? null
    }
  })
  console.log(`[api] SAVE QUEUED memory=${memory.id} type=${sourceType} user=${body.telegramUserId}${sourceType === 'photo' ? ` file=${body.telegramFileId!.slice(0, 20)}...` : ''}`)
  await embeddingQueue.add('embed', { memoryId: memory.id }, {
    attempts: 5,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 100,
    removeOnFail: false
  })
  return c.json({
    id: memory.id,
    content: memory.content,
    sourceType: memory.sourceType,
    telegramFileId: memory.telegramFileId,
    telegramChatId: memory.telegramChatId?.toString() ?? null,
    telegramMessageId: memory.telegramMessageId,
    createdAt: memory.createdAt
  }, 201)
})

app.get('/memories', async (c) => {
  const tidParam = c.req.query('telegramUserId')
  if (!tidParam || !/^\d+$/.test(tidParam)) {
    return c.json({ error: 'telegramUserId query param is required' }, 400)
  }
  const user = await prisma.user.findUnique({ where: { telegramUserId: BigInt(tidParam) } })
  if (!user) return c.json({ memories: [] })
  const limit = Math.min(Number(c.req.query('limit') ?? 50) || 50, 100)
  const memories = await prisma.memory.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: { id: true, content: true, sourceType: true, sourceUrl: true, telegramFileId: true, telegramChatId: true, telegramMessageId: true, createdAt: true }
  })
  return c.json({
    memories: memories.map((m) => ({
      ...m,
      telegramChatId: m.telegramChatId?.toString() ?? null
    }))
  })
})

app.delete('/memories/:id', async (c) => {
  const tidParam = c.req.query('telegramUserId')
  if (!tidParam || !/^\d+$/.test(tidParam)) {
    return c.json({ error: 'telegramUserId query param is required' }, 400)
  }
  const user = await prisma.user.findUnique({ where: { telegramUserId: BigInt(tidParam) } })
  if (!user) return c.json({ error: 'Not found' }, 404)
  const existing = await prisma.memory.findUnique({ where: { id: c.req.param('id') } })
  if (!existing || existing.userId !== user.id) return c.json({ error: 'Not found' }, 404)
  await prisma.memory.delete({ where: { id: existing.id } })
  await deleteMemoryVector(existing.id).catch(() => {})
  console.log(`[api] DELETE OK memory=${existing.id}`)
  return c.body(null, 204)
})

app.post('/search', async (c) => {
  const body = await c.req.json<{ telegramUserId?: string; query?: string; topK?: number }>().catch(() => null)
  const tidParam = body?.telegramUserId
  if (!tidParam || !/^\d+$/.test(tidParam)) {
    return c.json({ error: 'telegramUserId (numeric) is required' }, 400)
  }
  const query = body?.query?.trim()
  if (!query) return c.json({ error: 'query is required' }, 400)

  const user = await prisma.user.findUnique({ where: { telegramUserId: BigInt(tidParam) } })
  if (!user) {
    console.log(`[api] SEARCH FAILED (unknown user) user=${tidParam} query="${query}"`)
    return c.json({ results: [] })
  }

  console.log(`[api] SEARCHING user=${tidParam} query="${query}"...`)
  try {
    const vector = await embedText(query)
    const results = await searchMemoryVectors(vector, user.id, Math.min(body?.topK ?? 5, 20))
    if (results.length === 0) {
      console.log(`[api] SEARCH FAILED (no results) query="${query}"`)
    } else {
      console.log(`[api] SEARCH OK query="${query}" hits=${results.map((r) => `${r.score.toFixed(2)}:${r.id.slice(0, 8)}`).join(', ')}`)
    }
    return c.json({ results })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Search failed'
    console.error(`[api] SEARCH FAILED query="${query}": ${message}`)
    return c.json({ error: message }, 502)
  }
})

serve({
  fetch: app.fetch,
  port: Number(process.env.PORT ?? 3000)
}, (info) => {
  console.log(`Server is running on http://localhost:${info.port}`)
})
