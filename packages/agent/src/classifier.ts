import { generateCompletion } from '@anvia/core'
import { z } from 'zod'
import type { CompletionModel } from '@anvia/core'

// --- Classification schema (zod-validated, always) ---

export const MemoryIntentSchema = z.object({
  intent: z.enum(['save_memory', 'search_memory', 'set_reminder', 'general_chat']),
  sentiment: z.enum(['angry', 'frustrated', 'neutral', 'positive']),
  confidence_score: z.number().min(0).max(1),
  reasoning: z.string()
})

export type MemoryIntentClassification = z.infer<typeof MemoryIntentSchema>

export const AgentReplySchema = z.object({
  response: z.string()
})

const CLASSIFIER_INSTRUCTIONS = [
  'You are an intent classifier for a personal memory assistant.',
  'Classify the user message to route to the correct handler:',
  '- save_memory: user shares something to remember (note, fact, link, screenshot content)',
  '- search_memory: user asks what they saved or wants to recall something',
  '- set_reminder: user asks to be reminded about something at a time',
  '- general_chat: anything else (small talk, questions not about their memories)',
  'Sentiment reflects the user\'s emotional tone. Be honest with confidence_score.'
].join(' ')

// --- Route personas ---

export const ROUTE_PROMPTS = {
  save_memory: 'You are a memory capture assistant. Confirm what was saved briefly and warmly.',
  search_memory: 'You are a memory recall assistant. Answer from the provided memory results; say clearly when nothing was found.',
  set_reminder: 'You are a reminder assistant. Confirm the reminder with its exact time.',
  general_chat: 'You are a friendly personal assistant. Give a short helpful answer.'
} as const satisfies Record<MemoryIntentClassification['intent'], string>

export type ClassifyDeps = {
  model: CompletionModel
}

export async function classifyIntent(
  deps: ClassifyDeps,
  userMessage: string
): Promise<MemoryIntentClassification> {
  const result = await generateCompletion({
    model: deps.model,
    instructions: CLASSIFIER_INSTRUCTIONS,
    prompt: `User input: ${userMessage}`,
    outputSchema: MemoryIntentSchema
  })
  console.log('[classifier] intent=%s sentiment=%s confidence=%.2f reasoning=%s',
    result.output.intent, result.output.sentiment, result.output.confidence_score, result.output.reasoning)
  return result.output
}

// FRISKY: single LLM call per turn would be cheaper; two-call classify→route kept for
// observability and persona separation. Upgrade path: merge into one call with the
// agent's tool loop when classification quality is proven stable.
export async function routeAndRespond(
  deps: ClassifyDeps,
  userMessage: string,
  classification: MemoryIntentClassification,
  context?: string
): Promise<string> {
  const resolved: MemoryIntentClassification['intent'] =
    classification.sentiment === 'angry' && classification.intent !== 'save_memory'
      ? 'general_chat'
      : classification.intent

  const instructions = [
    ROUTE_PROMPTS[resolved],
    context ? `Context:\n${context}` : ''
  ].filter(Boolean).join('\n\n')

  const result = await generateCompletion({
    model: deps.model,
    instructions,
    prompt: `User message: ${userMessage}`,
    outputSchema: AgentReplySchema
  })
  return result.output.response
}

export async function classifyAndRoute(
  deps: ClassifyDeps,
  userMessage: string,
  context?: string
): Promise<{ classification: MemoryIntentClassification; response: string }> {
  const classification = await classifyIntent(deps, userMessage)
  const response = await routeAndRespond(deps, userMessage, classification, context)
  return { classification, response }
}
