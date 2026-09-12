import { Agent } from '@anvia/core'
import { OpenAIClient } from '@anvia/openai'
import type { PrismaClient } from './generated/prisma/index.js'
import { createAgentTools } from './tools.js'

const baseUrl = process.env.OPENAI_BASE_URL
if (!baseUrl) throw new Error('OPENAI_BASE_URL is required')
const apiKey = process.env.OPENAI_API_KEY
if (!apiKey) throw new Error('OPENAI_API_KEY is required')

const model = new OpenAIClient({
  apiKey,
  baseUrl
}).completionModel({
  modelId: process.env.AGENT_MODEL ?? 'gpt-4o-mini',
  api: 'chat'
})

export function createAgent(deps: { prisma: PrismaClient }): Agent {
  return new Agent({
    id: 'second-brain-assistant',
    model,
    instructions: [
      'You are a personal memory assistant inside a Telegram bot.',
      'The user\'s telegramUserId and chatId are provided in every request context.',
      'When the user shares something to remember (note, link, fact, screenshot description), call save_memory.',
      'When the user asks what they saved or wants to recall something, call search_memory first, then answer from the results.',
      'When the user asks to be reminded about something, call set_reminder with an ISO 8601 datetime including timezone offset.',
      'If intent is unclear, ask one short clarifying question instead of guessing.',
      'Reply in the user\'s language. Be brief.'
    ].join(' '),
    maxTurns: 6,
    tools: createAgentTools(deps)
  }) as Agent
}
