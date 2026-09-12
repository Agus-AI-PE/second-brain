import { createTool } from '@anvia/core'
import { z } from 'zod'
import type { ToolDeps } from '../types.js'

export function createSaveMemoryTool({ store }: ToolDeps) {
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
      const memory = await store.createMemory({
        telegramUserId,
        content: content.slice(0, 100_000),
        sourceType: url ? 'url' : 'text',
        sourceUrl: url ?? null
      })
      console.log(`[tool] save_memory OK memory=${memory.id} user=${telegramUserId}`)
      return { memoryId: memory.id, queued: true }
    }
  })
}
