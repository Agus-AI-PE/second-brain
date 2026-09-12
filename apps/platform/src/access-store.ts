import { PrismaClient } from '../../api/src/generated/prisma/index.js'
import type { AccessRecord, AccessStore, MemoryRecord, TelegramUser } from './access.js'
import { displayName } from './access.js'

function toRecord(user: { telegramUserId: bigint; username: string | null; displayName: string | null; role: AccessRecord['role']; accessStatus: AccessRecord['accessStatus'] }): AccessRecord {
  return { telegramUserId: Number(user.telegramUserId), username: user.username ?? undefined, displayName: user.displayName ?? undefined, role: user.role, accessStatus: user.accessStatus }
}

function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return host === 'localhost' || host.endsWith('.local') || host === '127.0.0.1' || host === '::1' || host.startsWith('10.') || host.startsWith('192.168.') || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || host.startsWith('169.254.')
}
export class PrismaAccessStore {
  constructor(private readonly prisma: PrismaClient) {}

  async getUser(telegramUserId: number): Promise<AccessRecord | null> {
    const user = await this.prisma.user.findUnique({ where: { telegramUserId: BigInt(telegramUserId) } })
    return user ? toRecord(user) : null
  }

  async ensureAdmin(user: TelegramUser): Promise<AccessRecord> {
    const record = await this.prisma.user.upsert({
      where: { telegramUserId: BigInt(user.id) },
      create: { telegramUserId: BigInt(user.id), username: user.username, displayName: displayName(user), role: 'ADMIN', accessStatus: 'APPROVED' },
      update: { username: user.username, displayName: displayName(user), role: 'ADMIN', accessStatus: 'APPROVED' }
    })
    return toRecord(record)
  }

  async upsertRequest(user: TelegramUser): Promise<AccessRecord> {
    const record = await this.prisma.user.upsert({
      where: { telegramUserId: BigInt(user.id) },
      create: { telegramUserId: BigInt(user.id), username: user.username, displayName: displayName(user), accessStatus: 'PENDING' },
      update: { username: user.username, displayName: displayName(user) }
    })
    const pending = await this.prisma.accessRequest.findFirst({ where: { userId: record.id, status: 'PENDING' } })
    if (!pending) await this.prisma.accessRequest.create({ data: { userId: record.id } })
    return toRecord(record)
  }

  async approveRequest(requestId: string): Promise<boolean> {
    const request = await this.prisma.accessRequest.findUnique({ where: { id: requestId } })
    if (!request) return false
    await this.prisma.$transaction([
      this.prisma.accessRequest.update({ where: { id: requestId }, data: { status: 'APPROVED', reviewedAt: new Date() } }),
      this.prisma.user.update({ where: { id: request.userId }, data: { accessStatus: 'APPROVED' } })
    ])
    return true
  }

  async denyRequest(requestId: string): Promise<boolean> {
    const request = await this.prisma.accessRequest.findUnique({ where: { id: requestId } })
    if (!request) return false
    await this.prisma.$transaction([
      this.prisma.accessRequest.update({ where: { id: requestId }, data: { status: 'DENIED', reviewedAt: new Date() } }),
      this.prisma.user.update({ where: { id: request.userId }, data: { accessStatus: 'DENIED' } })
    ])
    return true
  }

  async approveUser(telegramUserId: number): Promise<AccessRecord | null> {
    const result = await this.prisma.user.updateMany({ where: { telegramUserId: BigInt(telegramUserId), accessStatus: 'PENDING' }, data: { accessStatus: 'APPROVED' } })
    return result.count ? this.getUser(telegramUserId) : null
  }

  async denyUser(telegramUserId: number): Promise<AccessRecord | null> {
    const result = await this.prisma.user.updateMany({ where: { telegramUserId: BigInt(telegramUserId), accessStatus: 'PENDING' }, data: { accessStatus: 'DENIED' } })
    return result.count ? this.getUser(telegramUserId) : null
  }
  async fetchUrl(url: string): Promise<{ title: string; content: string }> {
    let parsed = new URL(url)
    for (let redirects = 0; redirects <= 5; redirects++) {
      if (parsed.protocol !== 'https:') throw new Error('Only HTTPS URLs are supported')
      if (isPrivateHostname(parsed.hostname)) throw new Error('Private URL rejected')
      const response = await fetch(parsed, { redirect: 'manual', signal: AbortSignal.timeout(10_000), headers: { accept: 'text/html,text/plain' } })
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location')
        if (!location || redirects === 5) throw new Error('Too many redirects')
        parsed = new URL(location, parsed)
        continue
      }
      if (!response.ok) throw new Error('URL fetch failed')
      const body = await response.text()
      if (body.length > 1_000_000) throw new Error('URL content too large')
      const title = body.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ?? parsed.hostname
      const content = body.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 20_000)
      if (!content) throw new Error('URL has no readable content')
      return { title, content }
    }
    throw new Error('URL fetch failed')
  }


  async saveMemory(userId: number, content: string, sourceUrl?: string): Promise<MemoryRecord> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { telegramUserId: BigInt(userId) } })
    const memory = await this.prisma.memory.create({ data: { userId: user.id, content, sourceUrl, sourceType: sourceUrl ? 'URL' : 'TEXT' } })
    return { id: memory.id, content: memory.content, sourceUrl: memory.sourceUrl ?? undefined, createdAt: memory.createdAt }
  }



  async searchMemories(userId: number, query: string): Promise<MemoryRecord[]> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { telegramUserId: BigInt(userId) } })
    const memories = await this.prisma.memory.findMany({ where: { userId: user.id, content: { contains: query, mode: 'insensitive' } }, orderBy: { createdAt: 'desc' }, take: 3 })
    return memories.map((memory) => ({ id: memory.id, content: memory.content, sourceUrl: memory.sourceUrl ?? undefined, createdAt: memory.createdAt }))
  }
  async listByStatus(status: AccessRecord['accessStatus']): Promise<AccessRecord[]> {
    const users = await this.prisma.user.findMany({ where: { accessStatus: status }, orderBy: { createdAt: 'asc' } })
    return users.map(toRecord)
  }



}
