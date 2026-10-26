export type ModelApiProvider = 'openai' | 'anthropic' | 'gemini'

/** Main-process configuration. Never return the API key through renderer IPC. */
export interface ModelApiSettings {
  provider?: ModelApiProvider
  baseUrl: string
  model: string
  apiKey: string
  enabled: boolean
}

export interface ModelApiDraft {
  provider?: ModelApiProvider
  baseUrl: string
  model: string
  apiKey?: string
  enabled: boolean
}

export interface ModelApiPublicSettings {
  provider?: ModelApiProvider
  baseUrl: string
  model: string
  enabled: boolean
  hasApiKey: boolean
  configured: boolean
}

export interface ModelApiConnectionResult {
  ok: boolean
  message: string
}
