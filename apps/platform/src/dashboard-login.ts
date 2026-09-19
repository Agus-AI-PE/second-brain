import { randomInt } from 'node:crypto'
import type { Redis } from 'ioredis'

/** Mint a 6-digit dashboard login code; API verifies it via shared Redis. */
export async function createLoginCode(redis: Redis, telegramUserId: string): Promise<string> {
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
  await redis.set(`dash:code:${code}`, telegramUserId, 'EX', 5 * 60)
  return code
}
