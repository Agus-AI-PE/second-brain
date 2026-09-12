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
    try {
      const parsed = JSON.parse(raw) as Message[]
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
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
