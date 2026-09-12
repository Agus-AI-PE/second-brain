export type Intent = 'save' | 'search' | 'reminder' | 'chat'

const savePattern = /\b(simpan|simpanlah|catat|ingat ini|remember this|save this)\b/i
const searchPattern = /\b(cari|carikan|temukan|pernah kusimpan|apa yang kusimpan|search|find)\b/i
const reminderPattern = /\b(ingatkan|remind(?:er)?|jangan lupa)\b/i

export function detectIntent(text: string): Intent {
  if (reminderPattern.test(text)) return 'reminder'
  if (searchPattern.test(text)) return 'search'
  if (savePattern.test(text)) return 'save'
  return 'chat'
}

export function isExplicitSave(text: string): boolean {
  return savePattern.test(text)
}
