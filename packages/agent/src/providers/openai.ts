import { OpenAIClient } from '@anvia/openai'
import type { CompletionModel } from '@anvia/core'

export type ProviderConfig = {
  baseUrl: string
  apiKey: string
  modelId: string
}

export function createCompletionModel(config: ProviderConfig): CompletionModel {
  const client = new OpenAIClient({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl
  })
  return client.completionModel({
    modelId: config.modelId,
    api: 'chat'
  })
}
