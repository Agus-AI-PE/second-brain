import type { Message } from '@anvia/core'
import type { MemoryStore as AnviaMemoryStore, MemoryLoadOptions, MemoryAppendOptions, MemoryClearOptions } from '@anvia/core'

export type RedisLike = {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<unknown>
  expire(key: string, seconds: number): Promise<unknown>
  del(key: string): Promise<unknown>
}

export type ConversationMemoryOptions = {
  redis: RedisLike
  /** Session TTL in seconds. Default 24 hours. */
  ttlSeconds?: number
  /** Max messages kept per session. Default 40 (20 turns). */
  maxMessages?: number
}

/**
 * Anvia MemoryStore backed by Redis: per-session conversation history
 * (short-term dialog context, distinct from long-term Qdrant memory).
 * History stored as JSON array of Anvia Messages; oldest trimmed first.
 */
export class ConversationMemoryStore implements AnviaMemoryStore {
  private readonly redis: RedisLike
  private readonly ttl: number
  private readonly max: number

  constructor(options: ConversationMemoryOptions) {
    this.redis = options.redis
    this.ttl = options.ttlSeconds ?? 24 * 60 * 60
    this.max = options.maxMessages ?? 40
  }

  private key(scope: MemoryLoadOptions['scope']): string {
    return `bot:conv:${scope.sessionId}`
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
  }

  async clear(options: MemoryClearOptions): Promise<void> {
    await this.redis.del(this.key(options.scope))
  }
}

/**
 * Drop dangling tool-call/tool-result pairs so history is always a valid
 * chat-completions sequence. Providers (e.g. OpenAI gateways) return HTTP 400
 * for an assistant message with tool_calls whose matching tool result is
 * missing — which trimming (maxMessages) can produce.
 */
function sanitizeHistory(messages: Message[]): Message[] {
  const toolCallIds = new Set(
    messages
      .filter((m) => m.role === 'assistant' && Array.isArray(m.content))
      .flatMap((m) => (m.content as Array<{ type: string; toolCallId?: string; callId?: string }>))
      .filter((p) => p.type === 'tool-call')
      .map((p) => p.toolCallId ?? p.callId)
      .filter((id): id is string => typeof id === 'string')
  )
  const kept: Message[] = []
  for (const m of messages) {
    if (m.role === 'assistant' && Array.isArray(m.content) && m.content.some((p: { type: string }) => p.type === 'tool-call')) {
      kept.push(m)
      continue
    }
    if (m.role === 'tool' && Array.isArray(m.content)) {
      const hasMatchingCall = m.content.some(
        (p: { type: string; toolCallId?: string }) => p.type === 'tool-result' && typeof p.toolCallId === 'string' && toolCallIds.has(p.toolCallId)
      )
      if (!hasMatchingCall) continue
    }
    kept.push(m)
  }
  // Second pass: drop assistant tool-calls whose result was dropped.
  const resultIds = new Set(
    kept
      .filter((m) => m.role === 'tool' && Array.isArray(m.content))
      .flatMap((m) => (m.content as Array<{ type: string; toolCallId?: string }>))
      .filter((p) => p.type === 'tool-result' && typeof p.toolCallId === 'string')
      .map((p) => p.toolCallId as string)
  )
  return kept.flatMap((m) => {
    if (m.role !== 'assistant' || !Array.isArray(m.content)) return [m]
    const parts = (m.content as Array<{ type: string; toolCallId?: string; callId?: string; text?: string }>)
    const toolParts = parts.filter((p) => p.type === 'tool-call')
    const orphan = toolParts.filter((p) => {
      const id = p.toolCallId ?? p.callId
      return typeof id === 'string' && !resultIds.has(id)
    })
    if (orphan.length === 0) return [m]
    const rest = parts.filter((p) => !orphan.includes(p))
    if (rest.length === 0) return []
    return [{ ...m, content: rest }]
  })
}
