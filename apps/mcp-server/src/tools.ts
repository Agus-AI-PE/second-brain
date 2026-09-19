import { McpServer } from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { z } from 'zod'
import type { MemoryStore, ScheduleReminderFn } from '@second-brain/agent'

/**
 * Per-connection context, injected by the host via env of the stdio child
 * process. The LLM never sees or chooses these — they are bound at spawn,
 * mirroring the trustedChatId/attachment binding in packages/agent.
 */
const TELEGRAM_USER_ID = process.env.SB_TELEGRAM_USER_ID ?? ''
const CHAT_ID = process.env.SB_CHAT_ID ?? ''
const ATTACHMENT_SOURCE_URL = process.env.SB_ATTACHMENT_SOURCE_URL ?? ''
const ATTACHMENT_SOURCE_TYPE = process.env.SB_ATTACHMENT_SOURCE_TYPE ?? ''

type Deps = { store: MemoryStore; scheduleReminder?: ScheduleReminderFn }

export function registerMemoryTools(server: McpServer, deps: Deps): McpServer {
  const { store, scheduleReminder } = deps
  server.registerTool(
    'save_memory',
    {
      description: 'Save a piece of information the user wants to remember (note, link, fact). Returns a memory id.',
      inputSchema: z.object({
        content: z.string().min(1).max(100_000).describe('The text to remember'),
        url: z.string().url().optional().describe('Optional source URL')
      }),
      outputSchema: z.object({ memoryId: z.string(), queued: z.boolean() })
    },
    async ({ content, url }) => {
      const sourceUrl = ATTACHMENT_SOURCE_URL || url || null
      const sourceType = ATTACHMENT_SOURCE_TYPE || (url ? 'url' : 'text')
      const memory = await store.createMemory({
        telegramUserId: TELEGRAM_USER_ID,
        content: content.slice(0, 100_000),
        sourceType,
        sourceUrl
      })
      console.log(`[mcp-server] save_memory OK memory=${memory.id} user=${TELEGRAM_USER_ID} type=${sourceType}`)
      const output = { memoryId: memory.id, queued: true }
      return { content: [{ type: 'text' as const, text: JSON.stringify(output) }], structuredContent: output }
    }
  )

  server.registerTool(
    'search_memory',
    {
      description: "Semantic search over the user's saved memories. Use for recall questions (\"what did I save about...\").",
      inputSchema: z.object({
        query: z.string().min(1).describe('Natural-language search query'),
        topK: z.number().int().min(1).max(10).optional().describe('Max results, default 5')
      }),
      outputSchema: z.object({
        results: z.array(z.object({
          memoryId: z.string(),
          content: z.string(),
          score: z.number(),
          sourceType: z.string(),
          sourceUrl: z.string().nullable(),
          createdAt: z.string()
        }))
      })
    },
    async ({ query, topK }) => {
      const hits = await store.searchVectors({ telegramUserId: TELEGRAM_USER_ID, query, topK: topK ?? 5 })
      console.log(`[mcp-server] search_memory user=${TELEGRAM_USER_ID} query="${query}" hits=${hits.length}`)
      const output = { results: hits }
      return { content: [{ type: 'text' as const, text: JSON.stringify(output) }], structuredContent: output }
    }
  )

  server.registerTool(
    'set_reminder',
    {
      description: 'Schedule a reminder for the user in their current chat. Accepts ISO 8601 datetime with timezone offset.',
      inputSchema: z.object({
        text: z.string().min(1).describe('Reminder text'),
        remindAt: z.string().datetime({ offset: true }).describe('ISO 8601 datetime with offset, e.g. 2026-09-12T15:00:00+07:00')
      }),
      outputSchema: z.object({ reminderId: z.string(), remindAt: z.string() })
    },
    async ({ text, remindAt }) => {
      const when = new Date(remindAt)
      if (Number.isNaN(when.getTime())) throw new Error(`Invalid datetime: ${remindAt}`)
      if (when.getTime() < Date.now()) throw new Error('remindAt is in the past')
      const reminder = await store.createReminder({
        telegramUserId: TELEGRAM_USER_ID,
        chatId: CHAT_ID,
        text,
        remindAt: when
      })
      if (scheduleReminder) {
        await scheduleReminder({
          reminderId: reminder.id,
          chatId: CHAT_ID,
          telegramUserId: TELEGRAM_USER_ID,
          text,
          deliverAt: reminder.remindAt
        })
      }
      console.log(`[mcp-server] set_reminder OK reminder=${reminder.id} at=${remindAt} chat=${CHAT_ID}`)
      const output = { reminderId: reminder.id, remindAt: reminder.remindAt.toISOString() }
      return { content: [{ type: 'text' as const, text: JSON.stringify(output) }], structuredContent: output }
    }
  )
  return server
}

/** Build the env the stdio child receives for one request. Empty strings = unset. */
export function contextEnv(input: {
  telegramUserId: string
  chatId: string
  attachment?: { sourceUrl: string; sourceType: string }
}): Record<string, string> {
  const env: Record<string, string> = {
    SB_TELEGRAM_USER_ID: input.telegramUserId,
    SB_CHAT_ID: input.chatId
  }
  if (input.attachment) {
    env.SB_ATTACHMENT_SOURCE_URL = input.attachment.sourceUrl
    env.SB_ATTACHMENT_SOURCE_TYPE = input.attachment.sourceType
  }
  return env
}
