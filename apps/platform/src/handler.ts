import type { AccessRecord, AccessStore, TelegramUser } from './access.js'
import { canUseMemory } from './access.js'

export type InlineButton = { text: string; callback_data: string }
export type Reply = {
  text: string
  actions?: Array<{ id: string; label: string }>
  keyboard?: string[][]
  accessUpdate?: { userId: number; status: 'APPROVED' | 'DENIED' }
}

async function statusActions(
  store: AccessStore,
  status: AccessRecord['accessStatus']
): Promise<Array<{ id: string; label: string }>> {
  const users = await store.listByStatus(status)
  const actions: Array<{ id: string; label: string }> = []
  for (const user of users) {
    if (status === 'PENDING') {
      actions.push({ id: `approve_user:${user.telegramUserId}`, label: `✓ ${user.displayName ?? user.telegramUserId}` })
      actions.push({ id: `deny_user:${user.telegramUserId}`, label: '✕ Tolak' })
    } else {
      actions.push({ id: 'noop', label: user.displayName ?? String(user.telegramUserId) })
    }
  }
  return actions
}

export async function handleTelegramCallback(
  store: AccessStore,
  user: TelegramUser,
  data: string,
  adminTelegramId: number
): Promise<Reply> {
  if (user.id !== adminTelegramId) return { text: 'Aksi tidak diizinkan.' }
  if (data === 'noop') return { text: 'Tidak ada aksi.' }
  const userAction = data.match(/^(approve_user|deny_user):(\d+)$/)
  if (userAction) {
    const updated =
      userAction[1] === 'approve_user'
        ? await store.approveUser(Number(userAction[2]))
        : await store.denyUser(Number(userAction[2]))
    return {
      text: updated
        ? 'Akses user diperbarui.'
        : 'User tidak ditemukan atau sudah diproses.',
      accessUpdate:
        updated && updated.accessStatus !== 'PENDING'
          ? { userId: updated.telegramUserId, status: updated.accessStatus }
          : undefined
    }
  }
  return { text: 'Menu diperbarui.' }
}

export async function handleTelegramText(
  store: AccessStore,
  user: TelegramUser,
  text: string,
  adminTelegramId: number
): Promise<Reply> {
  const current = await store.getUser(user.id)
  if (user.id === adminTelegramId && text === '/start') {
    await store.ensureAdmin(user)
    return {
      text: "👋 Just chat me! I'm your second brain.\n\n/menu — menu admin (pending, approve, deny)\nAtau langsung: simpan memori, cari memori, set reminder.",
      keyboard: [['/pending', '/approve', '/deny']]
    }
  }
  if (text === '/start' || text === '/request_access') {
    if (canUseMemory(current)) return { text: 'Akses sudah aktif.' }
    const requested = await store.upsertRequest(user)
    return {
      text:
        requested.accessStatus === 'APPROVED'
          ? 'Akses sudah aktif.'
          : 'Permintaan akses dikirim ke Eling Haaland. Mohon menunggu dengan santai 😎'
    }
  }
  if (
    user.id === adminTelegramId &&
    ['/pending', '/approve', '/deny'].includes(text)
  ) {
    const status =
      text === '/pending'
        ? 'PENDING'
        : text === '/approve'
          ? 'APPROVED'
          : 'DENIED'
    const labels = {
      PENDING: 'pending',
      APPROVED: 'approved',
      DENIED: 'denied'
    } as const
    const users = await store.listByStatus(status)
    return {
      text: `User ${labels[status]}:`,
      actions: await statusActions(store, status)
    }
  }
  if (!canUseMemory(current))
    return {
      text: 'Akses belum aktif. Kirim /request_access untuk meminta akses.'
    }
  if (/\b(simpan|catat)\b/i.test(text)) {
    const url = text.match(/https?:\/\/\S+/)?.[0]
    if (url) {
      try {
        const page = await store.fetchUrl(url)
        const memory = await store.saveMemory(user.id, `${page.title}\n\n${page.content}`, url)
        return { text: `Tersimpan. ${memory.sourceUrl}` }
      } catch {
        return { text: 'URL tidak bisa dibaca. Pastikan URL publik dan coba lagi.' }
      }
    }
    const content = text.replace(/^\s*(simpan|catat)\b[:,]?\s*/i, '').trim()
    if (!content) return { text: 'Kirim isi memory setelah kata simpan.' }
    const memory = await store.saveMemory(user.id, content)
    return { text: `Tersimpan. ${memory.sourceUrl ?? 'Memory teks'}` }
  }
  if (/\b(cari|carikan|temukan)\b/i.test(text)) {
    const query = text.replace(/^\s*(cari|carikan|temukan)\b[:,]?\s*/i, '').trim()
    if (!query) return { text: 'Kirim kata kunci yang ingin dicari.' }
    const memories = await store.searchMemories(user.id, query)
    if (!memories.length) return { text: 'Belum ditemukan. Mau perluas kata kunci?' }
    return { text: memories.map((memory) => `${memory.content}${memory.sourceUrl ? `\nSumber: ${memory.sourceUrl}` : ''}`).join('\n\n') }
  }
  return { text: 'Akses aktif. Fitur memory siap digunakan.' }
}
