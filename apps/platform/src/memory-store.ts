import { PrismaClient } from '../../api/src/generated/prisma/index.js'
import type { MemoryStore } from '@second-brain/agent'
import { Queue } from 'bullmq'
import type { Redis } from 'ioredis'
import { embedText } from './embed.js'
import { searchMemoryVectors } from './vector.js'

/**
 * Prisma-backed MemoryStore satisfying the @second-brain/agent contract.
 * Embedding goes through apps/api's shared embed module; vector search through Qdrant.
 */
export class PrismaMemoryStore implements MemoryStore {
  readonly embeddingQueue: Queue<{ memoryId: string }>

  constructor(
    private readonly prisma: PrismaClient,
    connection: Redis
  ) {
    this.embeddingQueue = new Queue<{ memoryId: string }>('embedding', {
      connection,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 100,
        removeOnFail: false
      }
    })
  }

  async resolveUserByTelegramId(telegramUserId: string) {
    return this.prisma.user.findUnique({
      where: { telegramUserId: BigInt(telegramUserId) },
      select: { id: true }
    })
  }

  async createMemory(input: {
    telegramUserId: string
    content: string
    sourceType: string
    sourceUrl: string | null
  }) {
    const user = await this.prisma.user.upsert({
      where: { telegramUserId: BigInt(input.telegramUserId) },
      update: {},
      create: { telegramUserId: BigInt(input.telegramUserId) }
    })
    const memory = await this.prisma.memory.create({
      data: {
        userId: user.id,
        content: input.content,
        sourceType: input.sourceType,
        sourceUrl: input.sourceUrl
      }
    })
    await this.embeddingQueue.add('embed', { memoryId: memory.id })
    console.log(`[platform] memory queued memory=${memory.id}`)
    return {
      id: memory.id,
      content: memory.content,
      sourceType: memory.sourceType,
      sourceUrl: memory.sourceUrl,
      createdAt: memory.createdAt
    }
  }

  async searchVectors(input: { telegramUserId: string; query: string; topK: number }) {
    const user = await this.resolveUserByTelegramId(input.telegramUserId)
    if (!user) return []
    const vector = await embedText(input.query)
    // Qdrant payload stores the INTERNAL user id (see createMemory → upsertMemoryVector),
    // not the telegram id — resolve before filtering.
    const hits = await searchMemoryVectors(vector, user.id, input.topK)
    return hits.map((h) => ({
      id: h.id,
      content: h.content,
      score: h.score,
      sourceType: h.meta?.sourceType ?? 'text',
      createdAt: h.meta?.createdAt ?? new Date().toISOString()
    }))
  }

  async createReminder(input: { telegramUserId: string; chatId: string; text: string; remindAt: Date }) {
    const user = await this.prisma.user.upsert({
      where: { telegramUserId: BigInt(input.telegramUserId) },
      update: {},
      create: { telegramUserId: BigInt(input.telegramUserId) }
    })
    const reminder = await this.prisma.reminder.create({
      data: {
        userId: user.id,
        chatId: BigInt(input.chatId),
        text: input.text,
        remindAt: input.remindAt
      }
    })
    return { id: reminder.id, remindAt: reminder.remindAt }
  }
}

export { embedText }
