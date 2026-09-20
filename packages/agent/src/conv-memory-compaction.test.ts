import { describe, expect, it } from 'vitest'
import { ConversationMemoryStore, type RedisLike } from './conversation-memory.js'
import type { Message } from '@anvia/core'
import type { MemoryCompactionMessage } from '@anvia/core/memory'

/** Redis fake with INCR + a JS simulation of the replace-prefix CAS script. */
function casRedis(initial: Record<string, string> = {}): RedisLike {
  const data: Record<string, string> = { ...initial }
  return {
    async get(k) { return data[k] ?? null },
    async set(k, v) { data[k] = v },
    async expire() {},
    async del(k) { delete data[k] },
    async incr(k) { const n = Number(data[k] ?? '0') + 1; data[k] = String(n); return n },
    async eval(_script, _numKeys, key, revKey, expected, next) {
      const rev = data[String(revKey)] ?? '0'
      if (rev !== String(expected)) return 0
      data[String(key)] = String(next)
      data[String(revKey)] = String(Number(rev) + 1)
      return 1
    }
  }
}

const scope = { sessionId: 'tg:1' }
const text = (role: 'user' | 'assistant', t: string): Message => ({ role, content: [{ type: 'text', text: t }] }) as unknown as Message

const compactionMessage = (summary: string): MemoryCompactionMessage => ({
  role: 'system',
  content: [{ type: 'text', text: summary }],
  metadata: { anvia: { memoryCompaction: { version: 1, compactedMessageCount: 2 } } }
}) as unknown as MemoryCompactionMessage

describe('ConversationMemoryStore compaction capability', () => {
  it('is absent without incr/eval, so the runtime falls back to plain load', () => {
    const store = new ConversationMemoryStore({ redis: { get: async () => null, set: async () => {}, expire: async () => {}, del: async () => {} } })
    expect(store.compaction).toBeUndefined()
  })

  it('exposes snapshot + replacePrefix when the client supports it', () => {
    const store = new ConversationMemoryStore({ redis: casRedis() })
    expect(store.compaction).toBeDefined()
  })

  it('snapshot reports the current revision and messages', async () => {
    const redis = casRedis()
    const store = new ConversationMemoryStore({ redis })
    await store.append({ scope, runId: 'r1', turn: 1, messages: [text('user', 'a'), text('assistant', 'b')] })
    const snap = await store.compaction!.snapshot({ scope })
    expect(snap.revision).toBe('1')
    expect(snap.messages).toHaveLength(2)
  })

  it('replacePrefix commits and keeps the retained tail after the summary', async () => {
    const redis = casRedis()
    const store = new ConversationMemoryStore({ redis })
    await store.append({ scope, runId: 'r1', turn: 1, messages: [text('user', 'old'), text('assistant', 'old-reply'), text('user', 'new')] })
    const snap = await store.compaction!.snapshot({ scope })
    const summary = compactionMessage('summary')

    const res = await store.compaction!.replacePrefix({ scope, revision: snap.revision, messageCount: 2, replacement: summary, runId: 'r2' })
    expect(res.status).toBe('committed')

    const history = await store.load({ scope })
    expect(history).toHaveLength(2)
    expect(JSON.stringify(history[0])).toContain('summary')
    expect(JSON.stringify(history[1])).toContain('new')
  })

  it('replacePrefix rejects a stale revision without touching history', async () => {
    const redis = casRedis()
    const store = new ConversationMemoryStore({ redis })
    await store.append({ scope, runId: 'r1', turn: 1, messages: [text('user', 'a')] })
    const stale = (await store.compaction!.snapshot({ scope })).revision
    await store.append({ scope, runId: 'r2', turn: 2, messages: [text('user', 'b')] }) // bumps revision

    const res = await store.compaction!.replacePrefix({
      scope, revision: stale, messageCount: 1,
      replacement: compactionMessage('summary'),
      runId: 'r3'
    })
    expect(res.status).toBe('conflict')
    expect(await store.load({ scope })).toHaveLength(2)
  })

  it('clear removes history and revision', async () => {
    const redis = casRedis()
    const store = new ConversationMemoryStore({ redis })
    await store.append({ scope, runId: 'r1', turn: 1, messages: [text('user', 'a')] })
    await store.clear({ scope })
    expect(await store.load({ scope })).toHaveLength(0)
    expect((await store.compaction!.snapshot({ scope })).revision).toBe('0')
  })
})
