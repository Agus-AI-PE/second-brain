export type TelegramUpdate = {
  update_id: number
  message?: {
    message_id: number
    chat: { id: number }
    from?: { id: number; username?: string; first_name?: string; last_name?: string }
    text?: string
  }
  callback_query?: {
    id: string
    from: { id: number; username?: string; first_name?: string; last_name?: string }
    data?: string
    message?: { chat: { id: number }; message_id: number }
  }
}

type TelegramResponse<T> = { ok: boolean; result?: T; description?: string }
const allowedUpdates = JSON.stringify(['message', 'callback_query'])
type InlineKeyboard = Array<Array<{ text: string; callback_data: string }>>

export class TelegramClient {
  private readonly baseUrl: string

  constructor(private readonly token: string) {
    this.baseUrl = `https://api.telegram.org/bot${token}`
  }

  async getUpdates(offset?: number): Promise<TelegramUpdate[]> {
    const params = new URLSearchParams({ timeout: '25', allowed_updates: allowedUpdates })
    if (offset !== undefined) params.set('offset', String(offset))
    return this.call<TelegramUpdate[]>('getUpdates', params)
  }

  async sendMessage(chatId: number, text: string, keyboard?: string[][], inlineKeyboard?: InlineKeyboard): Promise<void> {
    await this.call('sendMessage', { chat_id: chatId, text, ...(keyboard ? { reply_markup: { keyboard, resize_keyboard: true } } : inlineKeyboard ? { reply_markup: { inline_keyboard: inlineKeyboard } } : {}) })
  }

  async answerCallbackQuery(callbackQueryId: string): Promise<void> {
    await this.call('answerCallbackQuery', { callback_query_id: callbackQueryId })
  }


  private async call<T>(method: string, body: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl}/${method}`, {
      method: 'POST',
      headers: { 'content-type': body instanceof URLSearchParams ? 'application/x-www-form-urlencoded' : 'application/json' },
      body: body instanceof URLSearchParams ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(35_000)
    })
    const result = await response.json() as TelegramResponse<T>
    if (!response.ok || !result.ok || result.result === undefined) throw new Error(`Telegram ${method} failed: ${result.description ?? response.statusText}`)
    return result.result
  }
}
