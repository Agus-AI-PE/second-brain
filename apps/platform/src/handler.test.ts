import { describe, expect, it } from 'vitest'
import type { AccessRecord, AccessStore, TelegramUser } from './access.js'
import { handleTelegramCallback, handleTelegramText } from './handler.js'

class FakeStore implements AccessStore {
  users = new Map<number, AccessRecord>()
  async getUser(id: number) { return this.users.get(id) ?? null }
  async ensureAdmin(user: TelegramUser) {
    const record: AccessRecord = { telegramUserId: user.id, role: 'ADMIN', accessStatus: 'APPROVED' }
    this.users.set(user.id, record)
    return record
  }
  async upsertRequest(user: TelegramUser) {
    const record: AccessRecord = { telegramUserId: user.id, role: 'USER', accessStatus: 'PENDING' }
    this.users.set(user.id, record)
    return record
  }
  async approveRequest() { return true }
  async denyRequest() { return true }
  async approveUser(id: number) {
    const user = this.users.get(id)
    if (!user || user.accessStatus !== 'PENDING') return null
    user.accessStatus = 'APPROVED'
    return user
  }
  async denyUser(id: number) {
    const user = this.users.get(id)
    if (!user || user.accessStatus !== 'PENDING') return null
    user.accessStatus = 'DENIED'
    return user
  }

  async saveMemory(userId: number, content: string, sourceUrl?: string) { return { id: '1', content, sourceUrl, createdAt: new Date() } }
  async fetchUrl(url: string) { return { title: 'Example', content: 'Fetched content' } }
  async searchMemories(userId: number, query: string) { return query.includes('React') ? [{ id: '1', content: 'React hooks note', sourceUrl: 'https://example.com', createdAt: new Date() }] : [] }
  async listByStatus(status: AccessRecord['accessStatus']) {
    return [...this.users.values()].filter((user) => user.accessStatus === status)
  }
}

describe('Telegram access flow', () => {
  it('requests access and blocks pending users', async () => {
    const store = new FakeStore()
    const user = { id: 42, first_name: 'Demo' }
    expect((await handleTelegramText(store, user, '/request_access', 1)).text).toContain('dikirim')
    expect((await handleTelegramText(store, user, 'cari catatan', 1)).text).toContain('belum aktif')
  })

  it('treats start as an access request', async () => {
    const store = new FakeStore()
    const user = { id: 42, first_name: 'Demo' }
    expect((await handleTelegramText(store, user, '/start', 1)).text).toContain('dikirim')
  })

  it('gives admin access when admin starts the bot', async () => {
    const store = new FakeStore()
    const user = { id: 1, first_name: 'Admin' }
    expect((await handleTelegramText(store, user, '/start', 1)).text).toContain("I'm your second brain")
    expect((await handleTelegramText(store, user, 'hi', 1)).text).toContain('memory siap')
  })

  it('opens pending requests from admin menu callback', async () => {
    const store = new FakeStore()
    const reply = await handleTelegramCallback(store, { id: 1 }, 'noop', 1)
    expect(reply.text).toContain('Tidak ada')
  })
  it('saves text and searches memory for approved users', async () => {
    const store = new FakeStore()
    store.users.set(42, { telegramUserId: 42, role: 'USER', accessStatus: 'APPROVED' })
    expect((await handleTelegramText(store, { id: 42 }, 'simpan React hooks', 1)).text).toContain('Tersimpan')
    const result = await handleTelegramText(store, { id: 42 }, 'cari React', 1)
    expect(result.text).toContain('React hooks note')
    expect(result.text).toContain('https://example.com')
  })
  it('allows approved users to reach memory features', async () => {
    const store = new FakeStore()
    store.users.set(42, { telegramUserId: 42, role: 'USER', accessStatus: 'APPROVED' })
    expect((await handleTelegramText(store, { id: 42 }, 'hi', 1)).text).toContain('memory siap')
  })
})
