import { Agent } from '@anvia/core'
import type { CompletionModel, MemoryStore as AnviaMemoryStore } from '@anvia/core'
import { createSaveMemoryTool } from './tools/save-memory.js'
import { createSearchMemoryTool } from './tools/search-memory.js'
import { createSetReminderTool } from './tools/set-reminder.js'
import { BASE_INSTRUCTIONS } from './prompts/base-instructions.js'
import type { ToolDeps } from './types.js'

export type CreateAgentOptions = ToolDeps & {
  model: CompletionModel
  id?: string
  /** Optional conversation memory (multi-turn context). Host supplies storage. */
  memory?: AnviaMemoryStore
  /**
   * Binds each user's trusted chatId at request time. When set, set_reminder
   * delivers to the chat the message actually came from — the LLM cannot
   * choose the destination.
   */
  trustedChatId?: string
}

export function createMemoryAgent(options: CreateAgentOptions): Agent {
  const { store, embed, model, memory, scheduleReminder, trustedChatId } = options
  return new Agent({
    id: options.id ?? 'second-brain-assistant',
    model,
    instructions: BASE_INSTRUCTIONS,
    maxTurns: 6,
    ...(memory ? { memory: { store: memory } } : {}),
    tools: [
      createSaveMemoryTool({ store, embed }),
      createSearchMemoryTool({ store, embed }),
      createSetReminderTool({ store, embed, scheduleReminder }, trustedChatId ?? '')
    ]
  }) as Agent
}

export type RunAgentResult =
  | { ok: true; reply: string }
  | { ok: false; error: string }

export type RunAgentInput = {
  telegramUserId: string
  chatId: string
  message: string
  /** IANA timezone of the user, e.g. "Asia/Jakarta". Default UTC. */
  timezone?: string
}

export async function runAgent(
  agent: Agent,
  input: RunAgentInput
): Promise<RunAgentResult> {
  try {
    const tz = input.timezone ?? 'UTC'
    const now = new Date()
    const date = now.toLocaleDateString('en-CA', { timeZone: tz })
    const time = now.toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' })
    const weekday = now.toLocaleDateString('en-US', { timeZone: tz, weekday: 'long' })
    const utc = now.toISOString()
    const contextHeader = [
      `[Context]`,
      `telegramUserId: ${input.telegramUserId}`,
      `chatId: ${input.chatId}`,
      `Current date: ${weekday}, ${date} (${tz})`,
      `Current time: ${time} ${tz}`,
      `UTC now: ${utc}`,
      `Resolve relative times ("besok", "nanti malam") against this. Use ISO 8601 with offset for reminders.`
    ].join('\n')

    const response = await agent.generate({
      prompt: `${contextHeader}\n\nUser: ${input.message}`,
      session: { sessionId: `tg:${input.telegramUserId}`, userId: input.telegramUserId }
    })
    if (response.type !== 'response') {
      return { ok: false, error: `Agent outcome: ${response.type}` }
    }
    return { ok: true, reply: response.text }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Agent failed' }
  }
}
