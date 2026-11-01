import type { Message } from '../data/agentScript'
import type { ClarificationQuestion } from '../types/agentConversation'

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i

/** Only the conversation ID is stored in the browser; task content stays with the local service. */
export function conversationStorageKey(url: string): string {
  const parsed = new URL(url)
  const scope = parsed.searchParams.get('projectId')
    || parsed.searchParams.get('fileKey')
    || parsed.pathname
  return `astrix:design-conversation:${encodeURIComponent(scope)}`
}

export function readConversationId(key: string): string | undefined {
  try {
    const value = localStorage.getItem(key)
    return value && UUID.test(value) ? value : undefined
  } catch { return undefined }
}

export function saveConversationId(key: string, id?: string): void {
  try {
    if (id && UUID.test(id)) localStorage.setItem(key, id)
    else localStorage.removeItem(key)
  } catch { /* The active conversation still works when browser storage is unavailable. */ }
}

export function upsertAgentMessage(messages: Message[], message: Message): Message[] {
  const index = messages.findIndex(item => item.id === message.id)
  if (index < 0) return [...messages, message]
  const next = messages.slice()
  next[index] = message
  return next
}

export function hasRequiredAnswers(questions: ClarificationQuestion[], answers: Record<string, string>): boolean {
  return questions.every(question => !question.required || Boolean(answers[question.id]?.trim()))
}
