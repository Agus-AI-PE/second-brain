import type { Message } from '@anvia/core'
import type { MemoryStore as AnviaMemoryStore, MemoryLoadOptions, MemoryAppendOptions, MemoryClearOptions } from '@anvia/core'
import type { MemoryCompactionCapability } from '@anvia/core/memory'

export type RedisLike = {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<unknown>
  expire(key: string, seconds: number): Promise<unknown>
  del(key: string): Promise<unknown>
  /** Optional: enables revision tracking for memory compaction. */
  incr?(key: string): Promise<number>
  /** Optional: enables the atomic compaction prefix replacement (CAS). */
  eval?(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>
}

export type ConversationMemoryOptions = {
  redis: RedisLike
  /** Session TTL in seconds. Default 24 hours. */
  ttlSeconds?: number
  /**
   * Hard cap on stored messages. Default 200. Compaction (not trimming) is the
   * primary context-size mechanism; this is a backstop for stores without the
   * compaction capability.
   */
  maxMessages?: number
}

/**
 * Atomic compare-and-swap used by {@link ConversationMemoryStore.compaction}:
 * replace the message list only when the caller's revision is still current.
 * KEYS: [messages, revision] — ARGV: [expectedRevision, newMessages, ttlSeconds]
 */
const REPLACE_PREFIX_SCRIPT = `
local rev = redis.call('GET', KEYS[2])
if not rev then rev = '0' end
if rev ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2])
redis.call('SET', KEYS[2], tostring(tonumber(rev) + 1))
redis.call('EXPIRE', KEYS[1], ARGV[3])
redis.call('EXPIRE', KEYS[2], ARGV[3])
return 1
`

/**
 * Anvia MemoryStore backed by Redis: per-session conversation history
 * (short-term dialog context, distinct from long-term Qdrant memory).
 * History stored as JSON array of Anvia Messages.
 *
 * Implements the optional `compaction` capability (revision + atomic prefix
 * replacement) so `@anvia/core` can swap long history for a summary checkpoint
 * via `createSummaryMemoryCompactor`. Without a Lua-capable client the
 * capability is omitted and the runtime falls back to plain history loading.
 */
export class ConversationMemoryStore implements AnviaMemoryStore {
  readonly compaction?: MemoryCompactionCapability

  private readonly redis: RedisLike
  private readonly ttl: number
  private readonly max: number

  constructor(options: ConversationMemoryOptions) {
    this.redis = options.redis
    this.ttl = options.ttlSeconds ?? 24 * 60 * 60
    this.max = options.maxMessages ?? 200
    if (typeof options.redis.eval === 'function') {
      this.compaction = {
        snapshot: async ({ scope }) => ({
          revision: await this.revision(scope),
          messages: await this.load({ scope })
        }),
        replacePrefix: async ({ scope, revision, messageCount, replacement }) => {
          const key = this.key(scope)
          const current = await this.load({ scope })
          const next = [replacement, ...current.slice(messageCount)]
          const committed = await this.redis.eval!(
            REPLACE_PREFIX_SCRIPT,
            2,
            key,
            this.revisionKey(scope),
            revision,
            JSON.stringify(next),
            this.ttl
          )
          return { status: committed === 1 ? 'committed' : 'conflict' }
        }
      }
    }
  }

  private key(scope: MemoryLoadOptions['scope']): string {
    return `bot:conv:${scope.sessionId}`
  }

  private revisionKey(scope: MemoryLoadOptions['scope']): string {
    return `${this.key(scope)}:rev`
  }

  private async revision(scope: MemoryLoadOptions['scope']): Promise<string> {
    return (await this.redis.get(this.revisionKey(scope))) ?? '0'
  }

  async load(options: MemoryLoadOptions): Promise<Message[]> {
    const raw = await this.redis.get(this.key(options.scope))
    if (!raw) return []
    let messages: Message[]
    try {
      const parsed = JSON.parse(raw) as Message[]
      messages = Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
    return sanitizeHistory(messages)
  }

  async append(options: MemoryAppendOptions): Promise<void> {
    const key = this.key(options.scope)
    const existing = await this.load({ scope: options.scope })
    const merged = [...existing, ...options.messages].slice(-this.max)
    await this.redis.set(key, JSON.stringify(merged))
    await this.redis.expire(key, this.ttl)
    if (typeof this.redis.incr === 'function') {
      await this.redis.incr(this.revisionKey(options.scope))
      await this.redis.expire(this.revisionKey(options.scope), this.ttl)
    }
  }

  async clear(options: MemoryClearOptions): Promise<void> {
    await this.redis.del(this.key(options.scope))
    await this.redis.del(this.revisionKey(options.scope))
  }
}

/**
 * Drop dangling tool-call/tool-result pairs so history is always a valid
 * chat-completions sequence. Providers (e.g. OpenAI gateways) return HTTP 400
 * for an assistant message with tool_calls whose matching tool result is
 * missing — which trimming (maxMessages) can produce.
 */
type MessagePart = { type: string; toolCallId?: string; callId?: string; text?: string }

function contentParts(message: Message): readonly MessagePart[] | undefined {
  return Array.isArray(message.content) ? (message.content as unknown as readonly MessagePart[]) : undefined
}

function sanitizeHistory(messages: Message[]): Message[] {
  const toolCallIds = new Set(
    messages
      .flatMap((m) => contentParts(m) ?? [])
      .filter((p) => p.type === 'tool-call')
      .map((p) => p.toolCallId ?? p.callId)
      .filter((id): id is string => typeof id === 'string')
  )
  const kept: Message[] = []
  for (const m of messages) {
    const parts = contentParts(m)
    if (m.role === 'assistant' && parts?.some((p) => p.type === 'tool-call')) {
      kept.push(m)
      continue
    }
    if (m.role === 'tool' && parts) {
      const hasMatchingCall = parts.some(
        (p) => p.type === 'tool-result' && typeof p.toolCallId === 'string' && toolCallIds.has(p.toolCallId)
      )
      if (!hasMatchingCall) continue
    }
    kept.push(m)
  }
  // Second pass: drop assistant tool-calls whose result was dropped.
  const resultIds = new Set(
    kept
      .flatMap((m) => (m.role === 'tool' ? (contentParts(m) ?? []) : []))
      .filter((p) => p.type === 'tool-result' && typeof p.toolCallId === 'string')
      .map((p) => p.toolCallId as string)
  )
  return kept.flatMap((m) => {
    const parts = contentParts(m)
    if (m.role !== 'assistant' || !parts) return [m]
    const orphan = parts.filter((p) => {
      const id = p.toolCallId ?? p.callId
      return p.type === 'tool-call' && typeof id === 'string' && !resultIds.has(id)
    })
    if (orphan.length === 0) return [m]
    const rest = parts.filter((p) => !orphan.includes(p))
    if (rest.length === 0) return []
    return [{ ...m, content: rest } as Message]
  })
}
