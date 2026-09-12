import { Queue } from 'bullmq'
import type { Redis } from 'ioredis'

export type ReminderJobData = {
  reminderId: string
  chatId: string
  telegramUserId: string
  text: string
}

let queue: Queue<ReminderJobData> | null = null

export function reminderQueue(connection: Redis): Queue<ReminderJobData> {
  if (!queue) {
    queue = new Queue<ReminderJobData>('send-reminder', {
      connection,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 10_000 },
        removeOnComplete: 500,
        removeOnFail: false
      }
    })
  }
  return queue
}
