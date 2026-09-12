import { describe, expect, it } from 'vitest'
import { detectIntent, isExplicitSave } from './intent.js'
import { parseReminderTime } from './reminder.js'

describe('detectIntent', () => {
  it('detects explicit memory commands', () => {
    expect(detectIntent('Tolong simpan artikel ini')).toBe('save')
    expect(detectIntent('cari catatan React')).toBe('search')
    expect(detectIntent('ingatkan saya hari ini jam 8 malam')).toBe('reminder')
  })

  it('keeps ordinary chat outside memory commands', () => {
    expect(detectIntent('React hooks bagus')).toBe('chat')
    expect(isExplicitSave('https://example.com')).toBe(false)
  })

  it('asks for a full date when today time already passed', () => {
    const now = new Date('2026-09-10T17:00:00+07:00')
    expect(parseReminderTime('ingatkan saya hari ini jam 3 sore', now)).toEqual({ kind: 'needs_date' })
  })
})
