import { describe, expect, it, vi } from 'vitest'
import type { CompletionModel, CompletionRequest, CompletionResponse } from '@anvia/core'
import { ConversationMemoryStore } from './conversation-memory.js'
import { createMemoryAgent, runAgent } from './agent.js'

const usage = { inputTokens: 1, outputTokens: 1, totalTokens: 2, cachedInputTokens: 0, cacheCreationInputTokens: 0 }

const noopMemory = () =>
  new ConversationMemoryStore({
    redis: {
      get: async () => null,
      set: async () => null,
      expire: async () => null,
      del: async () => null
    }
  })

const FULL_CAPS = {
  streaming: false, tools: true, toolChoice: false, imageInput: false,
  documentInput: false, outputSchema: false, reasoning: false
}

/** Model that throws on the first `throws` call(s), then replies. */
function flakyModel(error: Error, throws: number, reply = 'ok'): CompletionModel {
  let calls = 0
  return {
    provider: 'mock',
    modelId: 'mock-1',
    capabilities: FULL_CAPS,
    async completion(_request: CompletionRequest): Promise<CompletionResponse> {
      calls++
      if (calls <= throws) throw error
      return { choice: [{ type: 'text', text: reply }], usage, rawResponse: null }
    }
  } as unknown as CompletionModel
}

function agentWith(model: CompletionModel) {
  return createMemoryAgent({ model, store: {} as never, embed: async () => [], memory: noopMemory() })
}

describe('runAgent retry + failure kinds', () => {
  it('retries once on transient-looking failures the core retries miss (e.g. CF challenge HTML)', async () => {
    const model = flakyModel(new Error('Cloudflare challenge page returned instead of JSON'), 1)
    const completionSpy = vi.spyOn(model, 'completion')
    const result = await runAgent(agentWith(model), { telegramUserId: '123', chatId: '123', message: 'hello' })
    expect(result).toEqual({ ok: true, reply: 'ok' })
    expect(completionSpy).toHaveBeenCalledTimes(2)
  })

  it('does not retry non-transient failures', async () => {
    const model = flakyModel(new Error('invalid api key'), 1)
    const completionSpy = vi.spyOn(model, 'completion')
    const result = await runAgent(agentWith(model), { telegramUserId: '123', chatId: '123', message: 'hello' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.kind).toBe('error')
    expect(result.message).toMatch(/invalid api key/)
    expect(completionSpy).toHaveBeenCalledTimes(1)
  })

  it('gives up after the single transient retry', async () => {
    const model = flakyModel(new Error('fetch failed'), 10)
    const result = await runAgent(agentWith(model), { telegramUserId: '123', chatId: '123', message: 'hello' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.kind).toBe('error')
    expect(result.message).toMatch(/fetch failed/)
  }, 15_000)
})
