export type AgentBackendKind = 'codex' | 'claude' | 'hermes' | 'shell'

export type AgentAttachmentKind = 'image' | 'text' | 'binary'

export type AgentAttachment = {
  id: string
  name: string
  mime: string
  size: number
  kind: AgentAttachmentKind
  path?: string
  text?: string
  previewUrl?: string
}

export type AgentContextKind = 'layer' | 'file' | 'skill' | 'conversation'

export type AgentContextItem = {
  id: string
  kind: AgentContextKind
  label: string
  detail?: string
  nodeId?: string
  fileKey?: string
  skill?: string
}

export type AgentInstruction = {
  id: string
  title: string
  body: string
  preset?: boolean
}

export type AgentChatExtras = {
  attachments: AgentAttachment[]
  contextRefs: AgentContextItem[]
  instructions: AgentInstruction[]
  backend?: AgentBackendKind
  mcpSkill?: string
}

export type AgentMcpService = {
  id: string
  name: string
  description: string
  available: boolean
  skill?: string
  source: 'skill' | 'codex-mcp'
}

export type AgentServerInfo = {
  id: AgentBackendKind
  name: string
  online: boolean
  detail: string
  active?: boolean
}

export type AgentStatusSnapshot = {
  configured: boolean
  mode: 'codex' | 'claude' | 'hermes' | 'local' | 'remote'
  model: string
  shell?: boolean
  backend?: string
  baseUrl: string | null
  binaries: Record<string, { available: boolean; path: string | null }>
  mcp: AgentMcpService[]
  servers: AgentServerInfo[]
}
