export type ReminderParseResult =
  | { kind: 'scheduled'; remindAt: Date }
  | { kind: 'needs_date' }
  | { kind: 'invalid' }

const timePattern = /jam\s+(\d{1,2})(?::(\d{2}))?\s*(pagi|siang|sore|malam)?/i

export function parseReminderTime(text: string, now = new Date()): ReminderParseResult {
  const match = text.match(timePattern)
  if (!match) return { kind: 'invalid' }

  let hour = Number(match[1])
  const minute = Number(match[2] ?? 0)
  const period = match[3]?.toLowerCase()
  if (hour > 23 || minute > 59) return { kind: 'invalid' }
  if (period === 'malam' && hour < 12) hour += 12
  if (period === 'siang' && hour < 12) hour += 12

  const remindAt = new Date(now)
  remindAt.setHours(hour, minute, 0, 0)
  if (/\bhari ini\b/i.test(text) && remindAt <= now) return { kind: 'needs_date' }
  if (!/\bhari ini\b|\b(besok|lusa)\b/i.test(text)) return { kind: 'needs_date' }
  if (/\bbesok\b/i.test(text)) remindAt.setDate(remindAt.getDate() + 1)
  if (/\blusa\b/i.test(text)) remindAt.setDate(remindAt.getDate() + 2)
  return { kind: 'scheduled', remindAt }
}
