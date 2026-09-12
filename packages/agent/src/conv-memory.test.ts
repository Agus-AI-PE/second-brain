import { describe, expect, it } from 'vitest'
import { ConversationMemoryStore } from './conversation-memory.js'
import type { Message } from '@anvia/core'

function fakeRedis() {
  const m = new Map<string, string>()
  return {
    get: async (k: string) => m.get(k) ?? null,
    set: async (k: string, v: string) => { m.set(k, v) },
    expire: async () => {},
    del: async (k: string) => { m.delete(k) }
  }
}

describe('ConversationMemoryStore', () => {
  it('roundtrips history per session', async () => {
    const store = new ConversationMemoryStore({ redis: fakeRedis() as never })
    const scope = { sessionId: 'tg:123' }
    const msgs: Message[] = [
      { role: 'user', content: 'ingatkan aku 21:23 minum air putih' },
      { role: 'assistant', content: 'Hari ini atau besok?' }
    ]
    await store.append({ scope, runId: 'r1', turn: 1, messages: msgs })
    const loaded = await store.load({ scope })
    expect(loaded).toHaveLength(2)
    expect(loaded[0]).toMatchObject({ role: 'user', content: 'ingatkan aku 21:23 minum air putih' })
  })

  it('trims to maxMessages keeping newest', async () => {
    const store = new ConversationMemoryStore({ redis: fakeRedis() as never, maxMessages: 4 })
    const scope = { sessionId: 'tg:456' }
    for (let i = 1; i <= 6; i++) {
      await store.append({ scope, runId: 'r', turn: i, messages: [{ role: 'user', content: `msg ${i}` }] })
    }
    const loaded = await store.load({ scope })
    expect(loaded).toHaveLength(4)
    expect(loaded[0]).toMatchObject({ content: 'msg 3' })
    expect(loaded[3]).toMatchObject({ content: 'msg 6' })
  })

  it('isolates sessions and clears', async () => {
    const store = new ConversationMemoryStore({ redis: fakeRedis() as never })
    await store.append({ scope: { sessionId: 'a' }, runId: 'r', turn: 1, messages: [{ role: 'user', content: 'hello a' }] })
    await store.append({ scope: { sessionId: 'b' }, runId: 'r', turn: 1, messages: [{ role: 'user', content: 'hello b' }] })
    expect((await store.load({ scope: { sessionId: 'a' } }))[0]).toMatchObject({ content: 'hello a' })
    await store.clear({ scope: { sessionId: 'a' } })
    expect(await store.load({ scope: { sessionId: 'a' } })).toHaveLength(0)
    expect(await store.load({ scope: { sessionId: 'b' } })).toHaveLength(1)
  })
})
