import type {
  AgentAttachment,
  AgentBackendKind,
  AgentContextItem,
  AgentInstruction,
} from '../../src/types/agentComposer'
import type { FigmaSelectionSnapshot } from '../../src/types/figmaWrite'
import type { VisualDocumentChanges } from '../../src/types/visual'

export type ContextRef = {
  name: string
  size: string
  output: string
}

export type ResultItem = {
  label: string
  ratio: number
  tone: 'red' | 'dark' | 'light' | 'warm'
}

export type AgentUiMessage =
  | { id: string; kind: 'user'; text: string; refs?: ContextRef[] }
  | { id: string; kind: 'skill'; name: string; body: string }
  | { id: string; kind: 'collected'; read: number; search: number }
  | {
      id: string
      kind: 'tool'
      provider: string
      tool: string
      action: string
      status: 'running' | 'success' | 'error'
      nodeId?: string
      note?: string
      preview?: boolean
    }
  | { id: string; kind: 'text'; text: string }
  | { id: string; kind: 'result'; title: string; items: ResultItem[] }
  | {
      id: string
      kind: 'figma-write'
      commandIds: string[]
      summary: string
      status: 'queued' | 'success' | 'error'
      detail?: string
    }
  | {
      id: string
      kind: 'artifact'
      artifact: 'visual-document'
      title: string
      summary: string
      changes: VisualDocumentChanges
    }

export type AgentRuntimeMeta = {
  mode: 'codex' | 'claude' | 'hermes' | 'local'
  model: string
  shell: boolean
  backend: 'codex-cli' | 'claude-agent-sdk' | 'hermes-agent' | 'local-shell' | 'unavailable'
}

export type AgentRunInput = {
  message: string
  skill?: string
  model?: string
  signal?: AbortSignal
  source?: 'figma-workspace' | 'figma-sidepanel' | 'studio'
  selection?: FigmaSelectionSnapshot | null
  attachments?: AgentAttachment[]
  contextRefs?: AgentContextItem[]
  instructions?: AgentInstruction[]
  backend?: AgentBackendKind
  cwd?: string
  /** Only the first attempted runtime should render the user/skill context. */
  emitRequestContext?: boolean
}

export type AgentRuntime = {
  meta: AgentRuntimeMeta
  run: (input: AgentRunInput) => AsyncGenerator<AgentUiMessage>
}
