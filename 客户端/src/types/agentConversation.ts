import type { Message } from '../data/agentScript'

export type ClarificationQuestion = {
  id: string
  label: string
  required: boolean
  options?: string[]
}

export type ClarificationAnswer = {
  id: string
  answers: Record<string, string>
}

export type AgentConversationStatus =
  | 'idle' | 'assessing' | 'awaiting_user' | 'ready' | 'running'
  | 'completed' | 'failed' | 'cancelled'

export type AgentConversation = {
  conversationId: string
  taskId: string
  status: AgentConversationStatus
  messages: Message[]
  pending?: {
    id: string
    taskId: string
    questions: ClarificationQuestion[]
  }
  error?: string
  updatedAt?: string
  originalRequest?: string
}
