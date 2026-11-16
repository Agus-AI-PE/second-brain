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
    // Retry transient model-call failures (408/429, ECONNRESET, UND_ERR_*,
    // provider hiccups — see docs/bugs/0001). Without this the first message
    // after a cold start often fails and the user sees an error reply.
    retries: { maxAttempts: 3, initialDelayMs: 500, maxDelayMs: 2000 },
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
  /** Guardrail block — `message` is user-safe and should be shown as-is. */
  | { ok: false; kind: 'blocked'; message: string }
  /** Transient or unexpected failure — `message` is internal detail for logs. */
  | { ok: false; kind: 'error'; message: string }

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

  const result = await attempt(agent, `${contextHeader}\n\nUser: ${input.message}`, input)
  if (result.ok || result.kind !== 'error' || !looksTransient(result.message)) return result

  // One extra attempt for transient failures the Agent-level retries miss —
  // e.g. a Cloudflare challenge page returned as HTTP 200 HTML (docs/bugs/0001)
  // that does not throw a retryable network error. Kept to a single retry so
  // total worst-case delay stays a few seconds.
  console.log(`[agent] transient error, retrying once: ${result.message}`)
  await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
  return attempt(agent, `${contextHeader}\n\nUser: ${input.message}`, input)
}

/** Extra delay before runAgent's single transient retry. */
const RETRY_DELAY_MS = 1000

const TRANSIENT_ERROR = /fetch failed|econnreset|econnrefused|etimedout|und_err|cloudflare|challenge|rate.?limit|status 429|status 50[234]|service unavailable|bad gateway|timeout|timed out/i

function looksTransient(message: string): boolean {
  return TRANSIENT_ERROR.test(message)
}

async function attempt(agent: Agent, prompt: string, input: RunAgentInput): Promise<RunAgentResult> {
  try {
    const response = await agent.generate({
      prompt,
      session: { sessionId: `tg:${input.telegramUserId}`, userId: input.telegramUserId }
    })
    if (response.type !== 'response') {
      if (response.type === 'blocked') {
        console.log(`[agent] GUARDRAIL BLOCKED stage=${response.stage} reason=${response.reason}`)
        return { ok: false, kind: 'blocked', message: response.message ?? 'Permintaan diblokir oleh guardrail keamanan.' }
      }
      return { ok: false, kind: 'error', message: `Agent outcome: ${response.type}` }
    }
    return { ok: true, reply: response.text }
  } catch (err) {
    return { ok: false, kind: 'error', message: err instanceof Error ? err.message : 'Agent failed' }
  }
}
