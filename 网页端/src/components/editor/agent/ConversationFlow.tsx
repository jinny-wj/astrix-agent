import { useEffect, useRef, useState } from 'react'
import type { Message } from '../../../data/agentScript'
import type { VisualDocumentChanges } from '../../../types/visual'
import { cancelAgentConversation, getAgentConversation, streamAgentChat } from '../../../services/agentApi'
import { upsertAgentMessage } from '../../../services/agentConversation'
import type { AgentConversation, ClarificationAnswer } from '../../../types/agentConversation'
import ClarificationCard from './ClarificationCard'
import { modelIdForAgent } from '../../../config/models'
import type { FigmaSelectionSnapshot } from '../../../types/figmaWrite'
import type { AgentChatExtras } from '../../../types/agentComposer'
import {
  CollectedContext,
  MarkdownMessage,
  SkillCard,
  UserBubble,
  VisualArtifactCard,
} from './MessageParts'
import { ResultGrid, ToolCard } from './ToolParts'

/** 正在思考的动态提示 */
function Thinking({ label = '生成中' }: { label?: string }) {
  return (
    <div className="flex items-center gap-[7px] text-[12.5px] text-[#8a8a90]">
      <span className="flex gap-[3px]">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-[4px] w-[4px] animate-bounce rounded-full bg-[#b0b0b6]"
            style={{ animationDelay: `${i * 0.15}s` }}
          />
        ))}
      </span>
      {label}
    </div>
  )
}

function MessageItem({ msg, activeQuestionId, disabled, onAnswer }: {
  msg: Message
  activeQuestionId?: string
  disabled: boolean
  onAnswer: (answer: ClarificationAnswer) => void
}) {
  switch (msg.kind) {
    case 'user':
      return <UserBubble text={msg.text} refs={msg.refs} />
    case 'clarification':
      return <ClarificationCard message={msg} active={msg.id === activeQuestionId} disabled={disabled} onAnswer={onAnswer} />
    case 'skill':
      return <SkillCard name={msg.name} body={msg.body} />
    case 'collected':
      return <CollectedContext read={msg.read} search={msg.search} />
    case 'tool':
      return (
        <ToolCard
          provider={msg.provider}
          tool={msg.tool}
          action={msg.action}
          status={msg.status}
          nodeId={msg.nodeId}
          note={msg.note}
          preview={msg.preview}
        />
      )
    case 'text':
      return <MarkdownMessage text={msg.text} />
    case 'figma-write':
      return (
        <div className={`rounded-[10px] border px-[12px] py-[10px] text-[12.5px] ${
          msg.status === 'error'
            ? 'border-[#f0d4d4] bg-[#fff7f7] text-[#b42318]'
            : 'border-[#bce7cf] bg-[#f5fbf7] text-[#2f6f4e]'
        }`}>
          <p className="font-medium">{msg.summary}</p>
          {msg.detail ? <p className="mt-[4px] text-[11.5px] opacity-80">{msg.detail}</p> : null}
        </div>
      )
    case 'result':
      return <ResultGrid title={msg.title} items={msg.items} />
    case 'artifact':
      return <VisualArtifactCard title={msg.title} summary={msg.summary} />
  }
}

/** 多轮任务使用服务端保存的会话；浏览器只保留会话 ID。 */
export default function ConversationFlow({
  running, prompt, skill, selection, extras, conversationId,
  onConversation, onAnswer, onDone, onPause, onFail, onRetry,
  onArtifact, onFigmaWriteSuccess,
}: {
  running: boolean
  prompt: string
  skill?: string
  selection?: FigmaSelectionSnapshot | null
  extras?: AgentChatExtras | null
  conversationId?: string
  onConversation: (conversation: AgentConversation) => void
  onAnswer: (answer: ClarificationAnswer) => void
  onDone: () => void
  onPause: () => void
  onFail: (message: string) => void
  onRetry: () => void
  onArtifact: (changes: VisualDocumentChanges) => void
  onFigmaWriteSuccess?: () => void
}) {
  const [messages, setMessages] = useState<Message[]>([])
  const [snapshot, setSnapshot] = useState<AgentConversation | null>(null)
  const [pending, setPending] = useState(false)
  const [restoring, setRestoring] = useState(Boolean(conversationId))
  const [cancelling, setCancelling] = useState(false)
  const [restoreAttempt, setRestoreAttempt] = useState(0)
  const [error, setError] = useState('')
  const [modeLabel, setModeLabel] = useState('正在检查需求')
  const bottomRef = useRef<HTMLDivElement>(null)
  const runIdRef = useRef(0)
  const requestIdRef = useRef<string>()
  const requestInputRef = useRef<{ prompt: string; skill?: string; selection?: FigmaSelectionSnapshot | null; extras?: AgentChatExtras | null }>()
  const activeControllerRef = useRef<AbortController | null>(null)
  const snapshotRef = useRef<AgentConversation | null>(null)
  const conversationIdRef = useRef(conversationId)
  const callbacks = useRef({ onConversation, onDone, onPause, onFail, onArtifact, onFigmaWriteSuccess })
  callbacks.current = { onConversation, onDone, onPause, onFail, onArtifact, onFigmaWriteSuccess }
  conversationIdRef.current = conversationId

  const applyConversation = (value: AgentConversation) => {
    snapshotRef.current = value
    conversationIdRef.current = value.conversationId
    setSnapshot(value)
    setMessages(value.messages)
    callbacks.current.onConversation(value)
  }
  const applyRef = useRef(applyConversation)
  applyRef.current = applyConversation

  useEffect(() => {
    if (!conversationId || running) { setRestoring(false); return }
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    setRestoring(true)
    const restore = async () => {
      try {
        const value = await getAgentConversation(conversationId, controller.signal)
        if (controller.signal.aborted) return
        applyRef.current(value)
        setError(value.status === 'failed' ? value.error || '上次任务未完成，可补充需求后继续。' : '')
        setRestoring(false)
        if (value.status === 'running' || value.status === 'assessing') timer = setTimeout(() => { void restore() }, 1000)
      } catch (err) {
        if (!controller.signal.aborted) {
          setRestoring(false)
          setError(err instanceof Error ? err.message : '恢复会话失败')
        }
      }
    }
    void restore()
    return () => { controller.abort(); if (timer) clearTimeout(timer) }
  }, [conversationId, running, restoreAttempt])

  useEffect(() => {
    if (!running) return
    const runId = ++runIdRef.current
    const controller = new AbortController()
    activeControllerRef.current = controller
    const previousInput = requestInputRef.current
    const isSameSubmission = previousInput?.prompt === prompt && previousInput.skill === skill
      && previousInput.selection === selection && previousInput.extras === extras
    const requestId = isSameSubmission && requestIdRef.current ? requestIdRef.current : crypto.randomUUID()
    requestIdRef.current = requestId
    requestInputRef.current = { prompt, skill, selection, extras }
    setError('')
    setPending(true)
    setRestoring(false)
    setModeLabel('正在检查需求')
    let reportedError = ''
    setMessages(current => upsertAgentMessage(current, { id: 'request-' + requestId, kind: 'user', text: prompt }))

    void Promise.resolve().then(() => {
      controller.signal.throwIfAborted()
      return streamAgentChat({
      message: prompt, conversationId: conversationIdRef.current, requestId,
      clarificationAnswer: extras?.clarificationAnswer,
      skill, selection: selection ?? undefined, model: modelIdForAgent(),
      attachments: extras?.attachments, contextRefs: extras?.contextRefs,
      instructions: extras?.instructions, backend: extras?.backend,
    }, {
      signal: controller.signal,
      onConversation: value => {
        if (runId !== runIdRef.current || controller.signal.aborted) return
        applyRef.current(value)
        if (value.status === 'assessing') setModeLabel('正在检查需求')
      },
      onMessage: message => {
        if (runId !== runIdRef.current || controller.signal.aborted) return
        if (message.kind === 'artifact') callbacks.current.onArtifact(message.changes)
        if (message.kind === 'figma-write' && message.status === 'success') callbacks.current.onFigmaWriteSuccess?.()
        setMessages(current => upsertAgentMessage(current, message))
      },
      onMeta: meta => {
        if (runId !== runIdRef.current || controller.signal.aborted) return
        setModeLabel(meta.backend === 'unavailable' ? '真实 Agent 不可用'
          : meta.backend === 'figma-bridge' ? '等待 Figma 执行回执'
          : meta.backend === 'model-api' ? `API · ${meta.model}`
          : meta.backend === 'local-shell' || meta.mode === 'local' ? '演示说明（未调用真实 Agent）'
          : meta.mode === 'codex' ? `Codex · ${meta.model}`
          : meta.mode === 'claude' ? `Claude Code · ${meta.model}`
          : meta.mode === 'hermes' ? `Hermes · ${meta.model}` : `${meta.mode} · ${meta.model}`)
      },
      onError: message => {
        if (runId !== runIdRef.current || controller.signal.aborted) return
        reportedError = message
        setError(message)
      },
      })
    }).then(() => {
      if (runId !== runIdRef.current || controller.signal.aborted) return
      requestIdRef.current = undefined
      setPending(false)
      const status = snapshotRef.current?.status
      if (status === 'completed') callbacks.current.onDone()
      else callbacks.current.onPause()
    }).catch((err: unknown) => {
      if (runId !== runIdRef.current || controller.signal.aborted) return
      // A transport failure does not prove execution failed. Reuse this submission ID on retry.
      setPending(false)
      const message = reportedError || (err instanceof Error ? err.message : 'Agent 请求失败')
      setError(message)
      callbacks.current.onFail(message)
    })
    return () => { controller.abort(); if (activeControllerRef.current === controller) activeControllerRef.current = null }
  }, [running, prompt, skill, selection, extras])

  const lastVisibleMessage = JSON.stringify(messages[messages.length - 1])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [lastVisibleMessage, pending, error])

  const serverBusy = snapshot?.status === 'running' || snapshot?.status === 'assessing'
  const busy = pending || running || serverBusy || cancelling
  const activeQuestionId = snapshot?.status === 'awaiting_user' ? snapshot.pending?.id : undefined
  const cancel = async () => {
    const id = conversationIdRef.current
    if (!id || cancelling) return
    setCancelling(true)
    ++runIdRef.current
    activeControllerRef.current?.abort()
    requestIdRef.current = undefined
    try { applyRef.current(await cancelAgentConversation(id)); setError('') }
    catch (err) { setError(err instanceof Error ? err.message : '取消失败') }
    finally { setCancelling(false); setPending(false); callbacks.current.onPause() }
  }

  if (!running && !conversationId && !messages.length && !error) return null
  return (
    <div className="space-y-[13px] px-[14px] pb-[6px] pt-[14px]" aria-live="polite">
      {snapshot && <div className="flex items-center justify-between gap-[8px] text-[11.5px] text-[#7b7d88]">
        <span>{snapshot.status === 'awaiting_user' ? '等待补充 · 原任务已保留'
          : snapshot.status === 'ready' ? '需求已保存 · 等待选择或配置模型'
          : snapshot.status === 'cancelled' ? '任务已取消 · 对话已保留'
          : snapshot.status === 'completed' ? '本轮已结束 · 对话已保存'
          : snapshot.status === 'failed' ? '任务未完成 · 上下文已保留' : '当前任务'}</span>
        {(busy || activeQuestionId) && <button type="button" onClick={() => { void cancel() }} disabled={cancelling}
          className="shrink-0 rounded-[6px] border border-[#e3e4eb] bg-white px-[7px] py-[4px] hover:bg-[#f4f4f8] disabled:opacity-50"
        >{cancelling ? '正在取消…' : '取消任务'}</button>}
      </div>}
      {snapshot?.status === 'ready' && <p className="rounded-[9px] bg-[#f5f5fa] px-[11px] py-[9px] text-[12px] leading-relaxed text-[#676b80]">关键信息已保存，任务尚未执行。稍后选择或配置模型，再发送“继续”即可沿用原任务。</p>}
      {messages.map(msg => <MessageItem key={msg.id} msg={msg} activeQuestionId={activeQuestionId} disabled={busy} onAnswer={onAnswer} />)}
      {(pending || serverBusy) && <Thinking label={modeLabel} />}
      {restoring && !messages.length && <Thinking label="正在恢复本机会话…" />}
      {error && <div className="rounded-[10px] border border-[#f0d4d4] bg-[#fff7f7] px-[12px] py-[10px] text-[12.5px] text-[#b42318]">
        <p>{error}</p>
        <button type="button" disabled={pending || running || cancelling} onClick={() => prompt && !serverBusy ? onRetry() : setRestoreAttempt(value => value + 1)}
          className="mt-space-sm rounded-[7px] border border-[#efc8c8] bg-white px-space-md py-space-xs font-medium hover:bg-[#fffafa] disabled:opacity-50"
        >重试</button>
      </div>}
      <div ref={bottomRef} />
    </div>
  )
}
