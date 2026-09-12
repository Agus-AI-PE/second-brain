import { createTool } from '@anvia/core'
import { z } from 'zod'
import type { ToolDeps } from '../types.js'

export function createSearchMemoryTool({ store, embed }: ToolDeps) {
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
        memoryId: z.string(),
        content: z.string(),
        score: z.number(),
        sourceType: z.string(),
        sourceUrl: z.string().nullable().describe('Source link if the memory was saved from a URL or archived file (r2:// = archived image/PDF)'),
        createdAt: z.string()
      }))
    }),
    execute: async ({ telegramUserId, query, topK }) => {
      if (!/^\d+$/.test(telegramUserId)) throw new Error('telegramUserId must be numeric')
      const user = await store.resolveUserByTelegramId(telegramUserId)
      if (!user) {
        console.log(`[tool] search_memory EMPTY (unknown user) user=${telegramUserId}`)
        return { results: [] }
      }
      const hits = await store.searchVectors({ telegramUserId, query, topK: topK ?? 5 })
      console.log(`[tool] search_memory user=${telegramUserId} query="${query}" hits=${hits.length}`)
      return { results: hits }
    }
  })
}
