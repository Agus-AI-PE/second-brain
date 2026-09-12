import { createTool } from '@anvia/core'
import { z } from 'zod'
import type { ToolDeps } from '../types.js'

/**
 * chatId is NOT part of the LLM-facing schema. The host binds the trusted
 * chatId (from the Telegram update) at factory time — the model cannot
 * redirect reminders to another chat.
 */
export function createSetReminderTool(
  { store, scheduleReminder }: ToolDeps,
  trustedChatId: string
) {
  return createTool({
    name: 'set_reminder',
    description: 'Schedule a reminder for the user in their current chat. Accepts ISO 8601 datetime with timezone offset.',
    inputSchema: z.object({
      telegramUserId: z.string().describe('Numeric Telegram user id'),
      text: z.string().min(1).describe('Reminder text'),
      remindAt: z.string().datetime({ offset: true }).describe('ISO 8601 datetime with offset, e.g. 2026-09-12T15:00:00+07:00')
    }),
    outputSchema: z.object({
      reminderId: z.string(),
      remindAt: z.string()
    }),
    execute: async ({ telegramUserId, text, remindAt }) => {
      if (!/^\d+$/.test(telegramUserId)) throw new Error('telegramUserId must be numeric')
      const when = new Date(remindAt)
      if (Number.isNaN(when.getTime())) throw new Error(`Invalid datetime: ${remindAt}`)
      if (when.getTime() < Date.now()) throw new Error('remindAt is in the past')
      const reminder = await store.createReminder({
        telegramUserId,
        chatId: trustedChatId,
        text,
        remindAt: when
      })
      if (scheduleReminder) {
        await scheduleReminder({
          reminderId: reminder.id,
          chatId: trustedChatId,
          telegramUserId,
          text,
          deliverAt: reminder.remindAt
        })
      }
      console.log(`[tool] set_reminder OK reminder=${reminder.id} at=${remindAt} chat=${trustedChatId} user=${telegramUserId} scheduled`)
      return { reminderId: reminder.id, remindAt: reminder.remindAt.toISOString() }
    }
  })
}
