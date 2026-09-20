import { Agent } from '@anvia/core'
import type { CompletionModel, MemoryStore as AnviaMemoryStore } from '@anvia/core'
import { createSummaryMemoryCompactor } from '@anvia/core/memory'
import type { McpServer } from '@anvia/core/mcp'
import type { AgentObservabilityOptions } from '@anvia/core/observability'
import { createSaveMemoryTool } from './tools/save-memory.js'
import { createSearchMemoryTool } from './tools/search-memory.js'
import { createSetReminderTool } from './tools/set-reminder.js'
import { BASE_INSTRUCTIONS } from './prompts/base-instructions.js'
import { createMemoryGuardrailPolicy } from './guardrails.js'
import type { ToolDeps } from './types.js'

export type CreateAgentOptions = ToolDeps & {
  model: CompletionModel
  id?: string
  /**
   * Required LLM gatekeeper classifier run on every input before the main
   * model. Classifies each message as memory/chat (pass) vs injection/off-scope
   * (block). Use a cheap fast model (nano/flash tier).
   */
  judgeModel?: CompletionModel
  /** Optional conversation memory (multi-turn context). Host supplies storage. */
  memory?: AnviaMemoryStore
  /**
   * Binds each user's trusted chatId at request time. When set, set_reminder
   * delivers to the chat the message actually came from — the LLM cannot
   * choose the destination.
   */
  trustedChatId?: string
  /**
   * Attachment bound by the host for this request (archived file from Telegram).
   * When set, save_memory automatically attaches sourceUrl + file link; the LLM
   * cannot fabricate or omit it.
   */
  attachment?: { sourceUrl: string; sourceType: string }
  /**
   * MCP servers exposing save_memory/search_memory/set_reminder. When set,
   * in-process tools are replaced by MCP server tools (PRD: standardized
   * storage layer).
   */
  mcpServers?: readonly McpServer[]
  observability?: AgentObservabilityOptions
  /**
   * Conversation compaction policy. Long history is summarized once the
   * projected context exceeds `afterTokens`, keeping the last `recentTurns`
   * turns verbatim. Pass `false` to disable; requires a memory store with the
   * compaction capability.
   */
  compaction?: { afterTokens?: number; recentTurns?: number } | false
}

/** Summarize history once context projects beyond ~12k tokens. */
const DEFAULT_COMPACTION_TOKENS = 12_000

export function createMemoryAgent(options: CreateAgentOptions): Agent {
  const { store, embed, model, memory, scheduleReminder, trustedChatId, attachment, judgeModel, mcpServers, observability } = options
  const compactionConfig = options.compaction === false ? undefined : (options.compaction ?? {})
  // Compaction needs both the policy and the store capability (revision +
  // atomic prefix replacement, implemented by ConversationMemoryStore).
  const compaction = memory?.compaction && compactionConfig !== undefined
    ? {
        trigger: { afterTokens: compactionConfig.afterTokens ?? DEFAULT_COMPACTION_TOKENS },
        retention: { recentTurns: compactionConfig.recentTurns ?? 2 },
        compactor: createSummaryMemoryCompactor({ model, maxTokens: 600, temperature: 0 }),
        conflictRetries: { maxAttempts: 3 }
      }
    : undefined
  return new Agent({
    id: options.id ?? 'second-brain-assistant',
    model,
    instructions: BASE_INSTRUCTIONS,
    temperature: 0.2,
    maxTokens: 800,
    maxTurns: 6,
    guardrails: createMemoryGuardrailPolicy(judgeModel),
    ...(memory ? { memory: { store: memory, ...(compaction ? { compaction } : {}) } } : {}),
    ...(observability ? { observability } : {}),
    ...(mcpServers ? { mcpServers: [...mcpServers] } : {}),
    tools: mcpServers
      ? []
      : [
          createSaveMemoryTool({ store, embed }, attachment),
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
      if (response.type === 'blocked') {
        console.log(`[agent] GUARDRAIL BLOCKED stage=${response.stage} reason=${response.reason}`)
        return { ok: false, error: response.message ?? 'Permintaan diblokir oleh guardrail keamanan.' }
      }
      return { ok: false, error: `Agent outcome: ${response.type}` }
    }
    return { ok: true, reply: response.text }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Agent failed' }
  }
}
