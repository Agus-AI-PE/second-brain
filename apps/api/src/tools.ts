import { createTool } from '@anvia/core'
import { z } from 'zod'
import type { PrismaClient } from './generated/prisma/index.js'
import { embeddingQueue } from './queue.js'
import { embedText, EMBED_DIM } from './embed.js'
import { searchMemoryVectors } from './vector.js'

export type ToolDeps = {
  prisma: PrismaClient
}

export function createSaveMemoryTool({ prisma }: ToolDeps) {
  return createTool({
    name: 'save_memory',
    description: 'Save a piece of information the user wants to remember (note, link, fact). Returns a memory id.',
    inputSchema: z.object({
      telegramUserId: z.string().describe('Numeric Telegram user id of the owner'),
      content: z.string().min(1).max(100_000).describe('The text to remember'),
      url: z.string().url().optional().describe('Optional source URL')
    }),
    outputSchema: z.object({
      memoryId: z.string(),
      queued: z.boolean()
    }),
    execute: async ({ telegramUserId, content, url }) => {
      if (!/^\d+$/.test(telegramUserId)) throw new Error('telegramUserId must be numeric')
      const user = await prisma.user.upsert({
        where: { telegramUserId: BigInt(telegramUserId) },
        update: {},
        create: { telegramUserId: BigInt(telegramUserId) }
      })
      const memory = await prisma.memory.create({
        data: {
          userId: user.id,
          content: content.slice(0, 100_000),
          sourceType: url ? 'url' : 'text',
          sourceUrl: url ?? null
        }
      })
      await embeddingQueue.add('embed', { memoryId: memory.id }, {
        attempts: 5,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 100,
        removeOnFail: false
      })
      console.log(`[tool] save_memory OK memory=${memory.id} user=${telegramUserId}`)
      return { memoryId: memory.id, queued: true }
    }
  })
}

export function createSearchMemoryTool({ prisma }: ToolDeps) {
  return createTool({
    name: 'search_memory',
    description: 'Semantic search over the user\'s saved memories. Use for recall questions ("what did I save about...").',
    inputSchema: z.object({
      telegramUserId: z.string().describe('Numeric Telegram user id to search within'),
      query: z.string().min(1).describe('Natural-language search query'),
      topK: z.number().int().min(1).max(10).optional().describe('Max results, default 5')
    }),
    outputSchema: z.object({
      results: z.array(z.object({
        id: z.string(),
        content: z.string(),
        score: z.number(),
        sourceType: z.string(),
        createdAt: z.string()
      }))
    }),
    execute: async ({ telegramUserId, query, topK }) => {
      if (!/^\d+$/.test(telegramUserId)) throw new Error('telegramUserId must be numeric')
      const user = await prisma.user.findUnique({ where: { telegramUserId: BigInt(telegramUserId) } })
      if (!user) {
        console.log(`[tool] search_memory EMPTY (unknown user) user=${telegramUserId}`)
        return { results: [] }
      }
      const vector = await embedText(query)
      const hits = await searchMemoryVectors(vector, user.id, topK ?? 5)
      console.log(`[tool] search_memory user=${telegramUserId} query="${query}" hits=${hits.length}`)
      return {
        results: hits.map((h) => ({
          id: h.id,
          content: h.content,
          score: h.score,
          sourceType: h.meta?.sourceType ?? 'text',
          createdAt: h.meta?.createdAt ?? ''
        }))
      }
    }
  })
}

export function createSetReminderTool({ prisma }: ToolDeps) {
  return createTool({
    name: 'set_reminder',
    description: 'Schedule a reminder for the user. Accepts ISO 8601 datetime with timezone.',
    inputSchema: z.object({
      telegramUserId: z.string().describe('Numeric Telegram user id'),
      chatId: z.string().describe('Telegram chat id to send the reminder to'),
      text: z.string().min(1).describe('Reminder text'),
      remindAt: z.string().datetime({ offset: true }).describe('ISO 8601 datetime with offset, e.g. 2026-09-12T15:00:00+07:00')
    }),
    outputSchema: z.object({
      reminderId: z.string(),
      remindAt: z.string()
    }),
    execute: async ({ telegramUserId, chatId, text, remindAt }) => {
      if (!/^\d+$/.test(telegramUserId)) throw new Error('telegramUserId must be numeric')
      const when = new Date(remindAt)
      if (Number.isNaN(when.getTime())) throw new Error(`Invalid datetime: ${remindAt}`)
      if (when.getTime() < Date.now()) throw new Error('remindAt is in the past')
      const user = await prisma.user.upsert({
        where: { telegramUserId: BigInt(telegramUserId) },
        update: {},
        create: { telegramUserId: BigInt(telegramUserId) }
      })
      const reminder = await prisma.reminder.create({
        data: {
          userId: user.id,
          chatId: BigInt(chatId),
          text,
          remindAt: when
        }
      })
      console.log(`[tool] set_reminder OK reminder=${reminder.id} at=${remindAt} user=${telegramUserId}`)
      return { reminderId: reminder.id, remindAt: reminder.remindAt.toISOString() }
    }
  })
}

export function createAgentTools(deps: ToolDeps) {
  return [
    createSaveMemoryTool(deps),
    createSearchMemoryTool(deps),
    createSetReminderTool(deps)
  ]
}

export { EMBED_DIM }
