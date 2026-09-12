import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'

const accountId = process.env.R2_ACCOUNT_ID
if (!accountId) throw new Error('R2_ACCOUNT_ID is required')
const accessKeyId = process.env.R2_ACCESS_KEY_ID
if (!accessKeyId) throw new Error('R2_ACCESS_KEY_ID is required')
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
if (!secretAccessKey) throw new Error('R2_SECRET_ACCESS_KEY is required')
const bucket = process.env.R2_BUCKET
if (!bucket) throw new Error('R2_BUCKET is required')

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId, secretAccessKey }
})

export async function archiveToR2(key: string, data: Uint8Array, contentType: string): Promise<string> {
  await r2.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: data, ContentType: contentType }))
  return `r2://${bucket}/${key}`
}
