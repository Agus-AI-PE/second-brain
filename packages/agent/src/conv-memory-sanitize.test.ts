import { describe, expect, it } from 'vitest'
import { ConversationMemoryStore, type RedisLike } from './conversation-memory.js'
import type { Message } from '@anvia/core'

function fakeRedis(initial: Record<string, string> = {}): RedisLike & { data: Record<string, string> } {
  const data: Record<string, string> = { ...initial }
  return {
    data,
    async get(k) { return data[k] ?? null },
    async set(k, v) { data[k] = v },
    async expire() {},
    async del(k) { delete data[k] }
  }
}

const toolCallMsg = (id: string): Message => ({
  role: 'assistant',
  content: [{ type: 'tool-call', toolCallId: id, callId: id, toolName: 'search_memory', input: {} }]
}) as unknown as Message
const toolResultMsg = (id: string): Message => ({
  role: 'tool',
  content: [{ type: 'tool-result', toolCallId: id, toolName: 'search_memory', output: { type: 'json', value: { results: [] } } }]
}) as unknown as Message

function stored(messages: Message[]): string {
  return JSON.stringify(messages)
}

describe('ConversationMemoryStore history sanitization', () => {
  it('drops assistant tool-call when result is missing (trimmed)', async () => {
    const store = new ConversationMemoryStore({ redis: fakeRedis({ 'bot:conv:s1': stored([
      toolCallMsg('a1'), toolResultMsg('a1'), { role: 'user', content: 'u1' }, toolCallMsg('b2')
    ]) }) })
    const out = await store.load({ scope: { sessionId: 's1' } } as never)
    // dangling b2 tool-call removed; earlier pair + user kept
    expect(out).toHaveLength(3)
    expect(JSON.stringify(out)).not.toContain('b2')
  })

  it('drops tool result when call is missing', async () => {
    const store = new ConversationMemoryStore({ redis: fakeRedis({ 'bot:conv:s2': stored([
      { role: 'user', content: 'u1' }, toolResultMsg('x9')
    ]) }) })
    const out = await store.load({ scope: { sessionId: 's2' } } as never)
    expect(out).toHaveLength(1)
    expect(out[0].role).toBe('user')
  })

  it('keeps valid pair and text content intact', async () => {
    const store = new ConversationMemoryStore({ redis: fakeRedis({ 'bot:conv:s3': stored([
      { role: 'user', content: 'q' }, toolCallMsg('ok1'), toolResultMsg('ok1'),
      { role: 'assistant', content: [{ type: 'text', text: 'answer' }] } as unknown as Message
    ]) }) })
    const out = await store.load({ scope: { sessionId: 's3' } } as never)
    expect(out).toHaveLength(4)
  })

  it('drops assistant message left empty after removing orphan tool-call', async () => {
    const store = new ConversationMemoryStore({ redis: fakeRedis({ 'bot:conv:s4': stored([
      toolCallMsg('orphan'), { role: 'user', content: 'next' }
    ]) }) })
    const out = await store.load({ scope: { sessionId: 's4' } } as never)
    expect(out).toHaveLength(1)
    expect(out[0].role).toBe('user')
  })

  it('returns [] for corrupt JSON', async () => {
    const store = new ConversationMemoryStore({ redis: fakeRedis({ 'bot:conv:s5': 'not json' }) })
    const out = await store.load({ scope: { sessionId: 's5' } } as never)
    expect(out).toEqual([])
  })
})
