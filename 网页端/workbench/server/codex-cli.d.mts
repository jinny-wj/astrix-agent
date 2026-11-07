export type CodexCliStatus = {
  installed: boolean
  authenticated: boolean
  authMethod: 'chatgpt' | 'api-key' | 'unknown' | 'none'
  ready: boolean
  message: string
  bin?: string | null
}

export function getCodexCliStatus(options?: { bin?: string; signal?: AbortSignal }): Promise<CodexCliStatus>
export function codexChildEnv(source?: NodeJS.ProcessEnv): NodeJS.ProcessEnv
export function isCodexModelUnavailable(diagnostic: string): boolean
export function resolveCodexModel(options?: { bin?: string; signal?: AbortSignal; model?: string }): Promise<string>
export function codexModelCompletion(
  config: { mode?: string; codexModel?: string; [key: string]: unknown },
  messages: unknown[],
  tools?: unknown[],
  signal?: AbortSignal,
  onDelta?: (text: string) => void,
): Promise<{ role: 'assistant'; content: string; tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> }>
