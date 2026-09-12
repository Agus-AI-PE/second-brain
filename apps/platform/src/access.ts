export type AccessStatus = 'PENDING' | 'APPROVED' | 'DENIED'
export type UserRole = 'USER' | 'ADMIN'

export type TelegramUser = {
  id: number
  username?: string
  first_name?: string
  last_name?: string
}

export type MemoryRecord = {
  id: string
  content: string
  sourceUrl?: string
  createdAt: Date
}

export type AccessRecord = {
  telegramUserId: number
  username?: string
  displayName?: string
  role: UserRole
  accessStatus: AccessStatus
}
export type AccessStore = {
  getUser(telegramUserId: number): Promise<AccessRecord | null>
  ensureAdmin(user: TelegramUser): Promise<AccessRecord>
  upsertRequest(user: TelegramUser): Promise<AccessRecord>
  approveRequest(requestId: string): Promise<boolean>
  denyRequest(requestId: string): Promise<boolean>
  approveUser(telegramUserId: number): Promise<AccessRecord | null>
  denyUser(telegramUserId: number): Promise<AccessRecord | null>
  listByStatus(status: AccessStatus): Promise<AccessRecord[]>
  saveMemory(userId: number, content: string, sourceUrl?: string): Promise<MemoryRecord>
  fetchUrl(url: string): Promise<{ title: string; content: string }>
  searchMemories(userId: number, query: string): Promise<MemoryRecord[]>
}

export function displayName(user: TelegramUser): string {
  return [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || String(user.id)
}

export function canUseMemory(user: AccessRecord | null): boolean {
  return user?.accessStatus === 'APPROVED'
}

export function isAdmin(user: AccessRecord | null): boolean {
  return user?.role === 'ADMIN'
}
