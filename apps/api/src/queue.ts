import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from './generated/prisma/index.js'
import { Queue } from 'bullmq'
import { Redis } from 'ioredis'

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL is required')
const redisUrl = process.env.REDIS_URL
if (!redisUrl) throw new Error('REDIS_URL is required')
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) })

const connection = new Redis(redisUrl, { maxRetriesPerRequest: null })

export const embeddingQueue = new Queue('embedding', { connection })

export const MEMORY_EMBED_URL = 'embedding.embed.memory'

export { prisma }
