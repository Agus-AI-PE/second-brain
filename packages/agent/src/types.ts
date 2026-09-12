import type { createTool } from '@anvia/core'

/**
 * A memory as stored by the application.
 */
export type MemoryRecord = {
  id: string
  content: string
  sourceType: string
  sourceUrl: string | null
  createdAt: Date
}

/**
 * Storage contract the host application implements.
 * The agent package owns no database client.
 */
export interface MemoryStore {
  resolveUserByTelegramId(telegramUserId: string): Promise<{ id: string } | null>
  createMemory(input: {
    telegramUserId: string
    content: string
    sourceType: string
    sourceUrl: string | null
  }): Promise<MemoryRecord>
  searchVectors(input: {
    telegramUserId: string
    query: string
    topK: number
  }): Promise<Array<{ memoryId: string; content: string; score: number; sourceType: string; sourceUrl: string | null; createdAt: string }>>
  createReminder(input: {
    telegramUserId: string
    chatId: string
    text: string
    remindAt: Date
  }): Promise<{ id: string; remindAt: Date }>
}

/**
 * Embedding contract — the host supplies its own embedding provider.
 */
export type EmbedFn = (text: string) => Promise<number[]>

/**
 * Schedules a delayed delivery job for a reminder.
 * Host supplies the queue so the package stays transport-agnostic.
 */
export type ScheduleReminderFn = (job: {
  reminderId: string
  chatId: string
  telegramUserId: string
  text: string
  deliverAt: Date
}) => Promise<void>

export type ToolDeps = {
  store: MemoryStore
  embed: EmbedFn
  scheduleReminder?: ScheduleReminderFn
}

export type AgentTool = ReturnType<typeof createTool>
