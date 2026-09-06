import type { Message } from '../data/agentScript'
import type { FigmaSelectionSnapshot } from '../types/figmaWrite'
import type {
  AgentAttachment,
  AgentBackendKind,
  AgentContextItem,
  AgentInstruction,
  AgentStatusSnapshot,
} from '../types/agentComposer'

export type AgentStatus = AgentStatusSnapshot

export type AgentStreamHandlers = {
  onMeta?: (meta: { mode: string; model: string; backend?: string }) => void
  onMessage: (message: Message) => void
  onError?: (message: string) => void
  signal?: AbortSignal
}

export async function getAgentStatus(): Promise<AgentStatus> {
  const response = await fetch('/api/agent/status', {
    cache: 'no-store',
  })
  if (!response.ok) {
    throw new Error('无法读取 Agent 状态')
  }
  return response.json() as Promise<AgentStatus>
}

export async function uploadAgentAttachments(files: Array<{
  name: string
  mime: string
  contentBase64: string
}>): Promise<AgentAttachment[]> {
  const response = await fetch('/api/agent/attachments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files }),
  })
  if (!response.ok) {
    let detail = '上传附件失败'
    try {
      const payload = (await response.json()) as { error?: string }
      if (payload.error) detail = payload.error
    } catch {
      // ignore
    }
    throw new Error(detail)
  }
  const payload = (await response.json()) as { files?: AgentAttachment[] }
  return payload.files ?? []
}

function parseSseChunk(
  chunk: string,
  onEvent: (event: string, data: string) => void,
) {
  const blocks = chunk.split('\n\n')
  for (const block of blocks) {
    if (!block.trim() || block.startsWith(':')) continue
    let event = 'message'
    const dataLines: string[] = []
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
    }
    if (dataLines.length > 0) onEvent(event, dataLines.join('\n'))
  }
}

export async function streamAgentChat(
  input: {
    message: string
    skill?: string
    selection?: FigmaSelectionSnapshot | null
    model?: string
    attachments?: AgentAttachment[]
    contextRefs?: AgentContextItem[]
    instructions?: AgentInstruction[]
    backend?: AgentBackendKind
  },
  handlers: AgentStreamHandlers,
): Promise<void> {
  const response = await fetch('/api/agent/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: input.message,
      skill: input.skill,
      selection: input.selection ?? undefined,
      model: input.model,
      attachments: input.attachments?.map((item) => ({
        id: item.id,
        name: item.name,
        mime: item.mime,
        size: item.size,
        kind: item.kind,
        path: item.path,
        text: item.text,
      })),
      contextRefs: input.contextRefs,
      instructions: input.instructions,
      backend: input.backend,
      source: 'studio',
    }),
    signal: handlers.signal,
  })

  if (!response.ok) {
    let detail = `Agent 请求失败（HTTP ${response.status}）`
    try {
      const payload = (await response.json()) as { error?: string }
      if (payload.error) detail = payload.error
    } catch {
      // ignore
    }
    throw new Error(detail)
  }

  if (!response.body) {
    throw new Error('浏览器不支持流式响应')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let sawDone = false
  let streamError = ''

  const handleEvent = (event: string, data: string) => {
    if (event === 'meta') {
      try {
        handlers.onMeta?.(JSON.parse(data) as { mode: string; model: string; backend?: string })
      } catch {
        // ignore malformed metadata
      }
      return
    }
    if (event === 'message') {
      try {
        handlers.onMessage(JSON.parse(data) as Message)
      } catch {
        // ignore malformed message frames
      }
      return
    }
    if (event === 'error') {
      try {
        const payload = JSON.parse(data) as { message?: string }
        streamError = payload.message ?? 'Agent 执行失败'
      } catch {
        streamError = 'Agent 执行失败'
      }
      handlers.onError?.(streamError)
      return
    }
    if (event === 'done') sawDone = true
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    const parts = buffer.split('\n\n')
    buffer = parts.pop() ?? ''

    for (const part of parts) {
      parseSseChunk(`${part}\n\n`, handleEvent)
    }
  }

  if (buffer.trim()) {
    parseSseChunk(`${buffer}\n\n`, handleEvent)
  }

  if (streamError) throw new Error(streamError)
  if (!sawDone) throw new Error('Agent 连接提前结束，请重试')
}
