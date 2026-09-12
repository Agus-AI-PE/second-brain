import { afterEach, describe, expect, it, vi } from 'vitest'
import { TelegramClient } from './telegram.js'

afterEach(() => vi.restoreAllMocks())

describe('TelegramClient', () => {
  it('sends polling parameters as form data so offset is honored', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true, result: [] })))
    await new TelegramClient('test-token').getUpdates(42)
    const [, init] = fetchMock.mock.calls[0]
    expect(init?.headers).toEqual({ 'content-type': 'application/x-www-form-urlencoded' })
    expect(String(init?.body)).toContain('offset=42')
  })
})
