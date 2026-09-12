import { QdrantVectorClient } from '@anvia/qdrant'
import type { EmbeddedDocument, VectorMetadata } from '@anvia/core/embeddings'

export const QDRANT_URL = process.env.QDRANT_URL ?? 'http://localhost:6333'
export const COLLECTION_NAME = process.env.QDRANT_COLLECTION ?? 'memories'
export const EMBED_DIM = Number(process.env.EMBED_DIM ?? 2048)

const client = new QdrantVectorClient({ url: QDRANT_URL })

export const memoryStore = client.vectorStore<string, MemoryMeta>({
  collectionName: COLLECTION_NAME,
  dimensions: EMBED_DIM,
  metric: 'cosine'
})

export type MemoryMeta = {
  userId: string
  memoryId: string
  sourceType: string
  sourceUrl: string | null
  createdAt: string
}

export async function upsertMemoryVector(
  memoryId: string,
  content: string,
  vector: number[],
  meta: MemoryMeta
): Promise<void> {
  const doc: EmbeddedDocument<string, MemoryMeta> = {
    id: memoryId,
    document: content,
    metadata: meta,
    embeddings: [{ document: content, vector }]
  }
  await memoryStore.upsert({ documents: [doc] })
}

export async function deleteMemoryVector(memoryId: string): Promise<void> {
  await memoryStore.delete({ documentIds: [memoryId] })
}

export async function searchMemoryVectors(
  vector: number[],
  userId: string,
  topK = 5
): Promise<Array<{ id: string; content: string; score: number; meta: MemoryMeta | undefined }>> {
  await memoryStore.ensure()
  const results = await memoryStore.search({
    vector,
    topK,
    filter: { type: 'eq', key: 'userId', value: userId }
  })
  return results.map((r) => ({
    id: r.id,
    content: r.document,
    score: r.score,
    meta: r.metadata as MemoryMeta | undefined
  }))
}

export type { VectorMetadata }
