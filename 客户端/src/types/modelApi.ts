/** Main-process configuration. Never return the API key through renderer IPC. */
export interface ModelApiSettings {
  baseUrl: string
  model: string
  apiKey: string
  enabled: boolean
}

export interface ModelApiDraft {
  baseUrl: string
  model: string
  apiKey?: string
  enabled: boolean
}

export interface ModelApiPublicSettings {
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
