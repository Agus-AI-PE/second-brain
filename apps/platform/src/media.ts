const IMAGE_MIME_PREFIX = 'image/'
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif']

export function imageDocumentMime(doc: { filename?: string; mediaType?: string }): string | null {
  if (doc.mediaType?.startsWith(IMAGE_MIME_PREFIX)) return doc.mediaType
  const name = doc.filename?.toLowerCase() ?? ''
  if (IMAGE_EXTENSIONS.some((ext) => name.endsWith(ext))) {
    if (name.endsWith('.png')) return 'image/png'
    if (name.endsWith('.webp')) return 'image/webp'
    if (name.endsWith('.bmp')) return 'image/bmp'
    if (name.endsWith('.gif')) return 'image/gif'
    return 'image/jpeg'
  }
  return null
}
