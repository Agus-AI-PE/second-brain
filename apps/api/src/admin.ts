import { Hono } from 'hono'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { Redis } from 'ioredis'
import type { PrismaClient } from './generated/prisma/index.js'

const PAGE = 20
const SESSION_TTL = 24 * 60 * 60

// ponytail: serve dashboard React hasil build (apps/dashboard/dist) langsung dari API.
// Kalau nanti dashboard butuh routing SPA sendiri atau CDN, pindah ke static hosting.
const DIST = new URL('../../dashboard/dist', import.meta.url).pathname
const MIME: Record<string, string> = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.html': 'text/html',
}

export function adminApp(prisma: PrismaClient, redis: Redis): Hono {
  const app = new Hono()

  /** Telegram user id bound to a dashboard session. */
  async function sessionUser(c: { req: { header(name: string): string | undefined } }): Promise<string | null> {
    const session = c.req.header('Authorization')?.replace(/^Bearer /, '') ?? ''
    if (!session) return null
    return redis.get(`dash:session:${session}`)
  }

  app.post('/login', async (c) => {
    const body = await c.req.json<{ code?: string }>().catch(() => null)
    const code = (body?.code ?? '').trim()
    if (!/^\d{6}$/.test(code)) return c.json({ error: 'Invalid code' }, 401)
    const telegramUserId = await redis.get(`dash:code:${code}`)
    if (telegramUserId === null) return c.json({ error: 'Invalid or expired code' }, 401)
    await redis.del(`dash:code:${code}`)
    // Only approved users (or the admin) may log in.
    const user = await prisma.user.findUnique({ where: { telegramUserId: BigInt(telegramUserId) } })
    if (!user || (user.accessStatus !== 'APPROVED' && telegramUserId !== (process.env.ADMIN_TELEGRAM_ID ?? ''))) {
      return c.json({ error: 'Access not approved' }, 403)
    }
    const session = randomUUID()
    await redis.set(`dash:session:${session}`, telegramUserId, 'EX', SESSION_TTL)
    return c.json({ session })
  })

  app.get('/', async (c) => c.html(await readFile(`${DIST}/index.html`, 'utf8')))

  app.get('/assets/:file', async (c) => {
    const file = c.req.param('file')
    if (file.includes('..')) return c.text('Not found', 404)
    const ext = file.slice(file.lastIndexOf('.'))
    if (!(ext in MIME)) return c.text('Not found', 404)
    return c.body(await readFile(`${DIST}/assets/${file}`), 200, {
      'Content-Type': MIME[ext],
      'Cache-Control': 'public, max-age=31536000, immutable',
    })
  })

  app.get('/memories', async (c) => {
    const telegramUserId = await sessionUser(c)
    if (telegramUserId === null) return c.text('Unauthorized', 401)
    const user = await prisma.user.findUnique({ where: { telegramUserId: BigInt(telegramUserId) } })
    if (!user) return c.json({ total: 0, page: 0, memories: [] })
    const page = Math.max(0, Number(c.req.query('page') ?? 0) || 0)
    const q = (c.req.query('q') ?? '').trim()
    const where = {
      userId: user.id,
      ...(q ? { content: { contains: q, mode: 'insensitive' as const } } : {})
    }
    const [memories, total] = await Promise.all([
      prisma.memory.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: PAGE,
        skip: page * PAGE,
        select: { id: true, content: true, sourceType: true, sourceUrl: true, createdAt: true }
      }),
      prisma.memory.count({ where })
    ])
    return c.json({ total, page, memories })
  })

  app.get('/reminders', async (c) => {
    const telegramUserId = await sessionUser(c)
    if (telegramUserId === null) return c.text('Unauthorized', 401)
    const user = await prisma.user.findUnique({ where: { telegramUserId: BigInt(telegramUserId) } })
    if (!user) return c.json({ reminders: [] })
    const includePast = c.req.query('scope') === 'all'
    const rPage = Math.max(0, Number(c.req.query('page') ?? 0) || 0)
    const R_PAGE = 10
    const where = {
      userId: user.id,
      ...(includePast ? {} : { remindAt: { gte: new Date() } })
    }
    const [reminders, rTotal] = await Promise.all([
      prisma.reminder.findMany({
        where,
        orderBy: { remindAt: includePast ? 'desc' : 'asc' },
        take: R_PAGE,
        skip: rPage * R_PAGE,
        select: { id: true, text: true, remindAt: true, status: true }
      }),
      prisma.reminder.count({ where })
    ])
    return c.json({ reminders, total: rTotal, page: rPage })
  })

  return app
}
