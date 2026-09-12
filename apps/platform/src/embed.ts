import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const runCurl = promisify(execFile)

const embedUrl = process.env.EMBED_URL
if (!embedUrl) throw new Error('EMBED_URL is required')

const embedEndpoint = `${embedUrl.replace(/\/$/, '')}/embeddings`
const EMBED_MODEL = process.env.EMBED_MODEL ?? 'openai/text-embedding-3-small'
const EMBED_DIM = Number(process.env.EMBED_DIM ?? 2048)

// ponytail: uses /usr/bin/curl instead of node fetch — OpenRouter's Cloudflare serves a
// JS challenge page to undici (node fetch) on this network. Ceiling: breaks if CF
// escalates to interactive challenge. Upgrade path: curl-impersonate or an embedding
// gateway (self-hosted tei/ollama) with no bot protection in front.
export async function embedText(text: string): Promise<number[]> {
  const { stdout: raw } = await runCurl('/usr/bin/curl', [
    '-s', '--fail', '--max-time', '60',
    embedEndpoint,
    '-H', `authorization: Bearer ${process.env.EMBED_API_KEY ?? ''}`,
    '-H', 'content-type: application/json',
    '--data-binary', JSON.stringify({ model: EMBED_MODEL, input: text })
  ], { maxBuffer: 50 * 1024 * 1024 })
  if (raw.includes('<!DOCTYPE')) {
    throw new Error('Embed API blocked by Cloudflare challenge page (retry later)')
  }
  const start = raw.indexOf('{')
  if (start === -1) throw new Error('Embed API returned no JSON')
  const json = JSON.parse(raw.slice(start)) as { data?: { embedding?: number[] }[] }
  const vector = json.data?.[0]?.embedding
  if (!Array.isArray(vector) || vector.length !== EMBED_DIM) {
    throw new Error(`Unexpected embedding dimension: got ${vector?.length ?? 'none'}, want ${EMBED_DIM}`)
  }
  return vector
}

export { EMBED_MODEL, EMBED_DIM }
