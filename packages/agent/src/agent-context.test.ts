import { describe, expect, it } from 'vitest'
// verify context header building indirectly: runAgent is integration-level; test the date shape it relies on
describe('time context', () => {
  it('Jakarta date/time resolves with correct offset shape', () => {
    const now = new Date('2026-09-12T14:00:00Z') // 21:00 WIB
    const date = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' })
    const time = now.toLocaleTimeString('en-GB', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' })
    const weekday = now.toLocaleDateString('en-US', { timeZone: 'Asia/Jakarta', weekday: 'long' })
    expect(date).toBe('2026-09-12')
    expect(time).toBe('21:00')
    expect(weekday).toBe('Saturday')
  })
  it('date rollover across UTC midnight works', () => {
    const now = new Date('2026-09-12T17:30:00Z') // 00:30 WIB next day
    const date = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' })
    expect(date).toBe('2026-09-13')
  })
})
