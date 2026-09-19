const BASE = '/dashboard'

export async function loginWithCode(code: string): Promise<void> {
  const res = await fetch(`${BASE}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code })
  })
  if (res.status === 401) throw new Error('Kode salah atau kedaluwarsa.')
  if (res.status === 403) throw new Error('Akses belum disetujui admin.')
  if (!res.ok) throw new Error('Login gagal, coba lagi.')
  const { session } = (await res.json()) as { session: string }
  localStorage.setItem('dash_session', session)
}

export function getSession(): string | null {
  return localStorage.getItem('dash_session')
}

export function logout(): void {
  localStorage.removeItem('dash_session')
}

export type MemoryDto = {
  id: string
  content: string
  sourceType: string
  sourceUrl: string | null
  createdAt: string
}

export type MemoriesResponse = {
  total: number
  page: number
  memories: MemoryDto[]
}

export async function fetchMemories(page = 0, q = ''): Promise<MemoriesResponse> {
  const session = getSession()
  if (!session) throw new Error('Not logged in')
  const params = new URLSearchParams({ page: String(page) })
  if (q) params.set('q', q)
  const res = await fetch(`${BASE}/memories?${params}`, {
    headers: { Authorization: `Bearer ${session}` }
  })
  if (res.status === 401) {
    logout()
    throw new Error('Session expired')
  }
  if (!res.ok) throw new Error('Failed to fetch memories')
  return (await res.json()) as MemoriesResponse
}

export type ReminderDto = {
  id: string
  text: string
  remindAt: string
  status: string
}

export type RemindersResponse = {
  reminders: ReminderDto[]
  total: number
  page: number
}

const R_PAGE_SIZE = 10

export async function fetchReminders(scope: 'upcoming' | 'all' = 'upcoming', page = 0): Promise<RemindersResponse> {
  const session = getSession()
  if (!session) throw new Error('Not logged in')
  const params = new URLSearchParams()
  if (scope === 'all') params.set('scope', 'all')
  if (page > 0) params.set('page', String(page))
  const res = await fetch(`${BASE}/reminders?${params}`, {
    headers: { Authorization: `Bearer ${session}` }
  })
  if (res.status === 401) {
    logout()
    throw new Error('Session expired')
  }
  if (!res.ok) throw new Error('Failed to fetch reminders')
  return (await res.json()) as RemindersResponse
}

export { R_PAGE_SIZE }
