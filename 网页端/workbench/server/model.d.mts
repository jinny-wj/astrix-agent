export type ModelProvider = 'openai' | 'anthropic' | 'gemini'
export interface ModelConnection {
  provider?: ModelProvider
  baseUrl: string
  model: string
  apiKey: string
}
export interface CompletionMessage {
  role: string
  content?: unknown
  tool_calls?: unknown[]
  [key: string]: unknown
}
export function normalizeModelBaseUrl(value: string, provider?: ModelProvider): string
export function modelCompletionUrl(baseUrl: string): string
export function modelCompletion(
  config: ModelConnection,
  messages: Array<{ role: string; content: string }>,
  tools?: unknown[],
  signal?: AbortSignal,
  onDelta?: (text: string) => void,
): Promise<CompletionMessage>
