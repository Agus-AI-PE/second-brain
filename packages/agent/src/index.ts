import { createCompletionModel } from './providers/openai.js'
import { createMemoryAgent, runAgent } from './agent.js'
import { detectIntent, isExplicitSave } from './intent.js'
import { parseReminderTime } from './reminder.js'

export type {
  MemoryRecord,
  MemoryStore,
  EmbedFn,
  ToolDeps,
  ScheduleReminderFn
} from './types.js'
export { createMemoryAgent, runAgent } from './agent.js'
export type { CreateAgentOptions, RunAgentResult } from './agent.js'
export { createCompletionModel } from './providers/openai.js'
export type { ProviderConfig } from './providers/openai.js'
export { createSaveMemoryTool } from './tools/save-memory.js'
export { createSearchMemoryTool } from './tools/search-memory.js'
export { createSetReminderTool } from './tools/set-reminder.js'
export { BASE_INSTRUCTIONS } from './prompts/base-instructions.js'
export { detectIntent, isExplicitSave, type Intent } from './intent.js'
export { parseReminderTime, type ReminderParseResult } from './reminder.js'
export { ConversationMemoryStore, type ConversationMemoryOptions, type RedisLike } from './conversation-memory.js'
export { reminderQueue, type ReminderJobData } from './reminder-queue.js'
