import { telegram } from '@anvia/telegram'
import type { TelegramChannel } from '@anvia/telegram'
import type { ChannelEvent, ChannelMessageEvent, ChannelAddress, ChannelMessage } from '@anvia/channel'
import type { TelegramUpdate } from '@anvia/telegram'

export { imageDocumentMime } from './media.js'

export type BotDeps = {
  token: string
  onError?: (err: unknown, ctx: { operation: 'poll' | 'handle'; update?: TelegramUpdate }) => void
  onEvent: (event: ChannelEvent<TelegramUpdate>) => Promise<void>
}

export type { ChannelEvent, ChannelMessageEvent, ChannelAddress, ChannelMessage }

export function createBot(deps: BotDeps): TelegramChannel {
  return telegram({
    token: deps.token,
    polling: { timeoutSeconds: 25 },
    onError: deps.onError
  })
}

export async function runBot(bot: TelegramChannel, deps: BotDeps): Promise<{ stop: () => Promise<void> }> {
  await bot.start(deps.onEvent)
  return { stop: () => bot.stop() }
}

/** Telegram user id of the event sender, as string. */
export function senderId(event: ChannelEvent<TelegramUpdate>): string | null {
  if (!('sender' in event)) return null
  return event.sender.id
}
