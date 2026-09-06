import { useEffect, useRef, useState } from 'react'
import type { Message } from '../../../data/agentScript'
import type { VisualDocumentChanges } from '../../../types/visual'
import { streamAgentChat } from '../../../services/agentApi'
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

function MessageItem({ msg }: { msg: Message }) {
  switch (msg.kind) {
    case 'user':
      return <UserBubble text={msg.text} refs={msg.refs} />
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

/**
 * 向真实 Codex / Claude / Hermes 发起 SSE。全部不可用时展示服务端错误，不会假装已经生成物料。
 */
export default function ConversationFlow({
  running,
  prompt,
  skill,
  selection,
  extras,
  onDone,
  onFail,
  onRetry,
  onArtifact,
  onFigmaWriteSuccess,
}: {
  running: boolean
  prompt: string
  skill?: string
  selection?: FigmaSelectionSnapshot | null
  extras?: AgentChatExtras | null
  onDone: () => void
  onFail: (message: string) => void
  onRetry: () => void
  onArtifact: (changes: VisualDocumentChanges) => void
  onFigmaWriteSuccess?: () => void
}) {
  const [messages, setMessages] = useState<Message[]>([])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [modeLabel, setModeLabel] = useState('生成中')
  const bottomRef = useRef<HTMLDivElement>(null)
  const runIdRef = useRef(0)
  const figmaWriteSuccessRef = useRef(onFigmaWriteSuccess)
  figmaWriteSuccessRef.current = onFigmaWriteSuccess

  useEffect(() => {
    if (!running) return

    const runId = ++runIdRef.current
    const controller = new AbortController()
    setMessages([])
    setError('')
    setPending(true)
    setModeLabel('生成中')
    let reportedError = ''

    void streamAgentChat(
      {
        message: prompt,
        skill,
        selection: selection ?? undefined,
        model: modelIdForAgent(),
        attachments: extras?.attachments,
        contextRefs: extras?.contextRefs,
        instructions: extras?.instructions,
        backend: extras?.backend,
      },
      {
        signal: controller.signal,
        onMessage: (message) => {
          if (runId !== runIdRef.current) return
          if (message.kind === 'artifact') onArtifact(message.changes)
          if (message.kind === 'figma-write' && message.status === 'success') {
            figmaWriteSuccessRef.current?.()
          }
          setMessages((current) => {
            const index = current.findIndex((item) => item.id === message.id)
            if (index === -1) return [...current, message]
            const next = current.slice()
            next[index] = message
            return next
          })
        },
        onMeta: (meta) => {
          if (runId !== runIdRef.current) return
          setModeLabel(
            meta.backend === 'unavailable'
              ? '真实 Agent 不可用'
              : meta.backend === 'figma-bridge'
                ? '正在写回 Figma'
                : meta.backend === 'local-shell' || meta.mode === 'local'
                  ? '演示说明（未调用真实 Agent）'
                  : meta.mode === 'codex'
                    ? `Codex · ${meta.model}`
                    : meta.mode === 'claude'
                      ? `Claude Code · ${meta.model}`
                      : meta.mode === 'hermes'
                        ? `Hermes · ${meta.model}`
                        : `${meta.mode} · ${meta.model}`,
          )
        },
        onError: (message) => {
          if (runId !== runIdRef.current) return
          reportedError = message
          setError(message)
        },
      },
    )
      .then(() => {
        if (runId !== runIdRef.current) return
        setPending(false)
        onDone()
      })
      .catch((err: unknown) => {
        if (runId !== runIdRef.current) return
        if (controller.signal.aborted) return
        setPending(false)
        const message = reportedError || (err instanceof Error ? err.message : 'Agent 请求失败')
        setError(message)
        onFail(message)
      })

    return () => {
      controller.abort()
    }
  }, [running, prompt, skill, selection, extras, onArtifact, onDone, onFail])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, pending, error])

  if (!running && messages.length === 0 && !error && !prompt) return null

  const serverUser = messages.find((message) => message.kind === 'user')
  const contentMessages = messages.filter((message) => message.kind !== 'user')

  return (
    <div className="space-y-[13px] px-[14px] pb-[6px] pt-[14px]">
      {serverUser?.kind === 'user'
        ? <UserBubble text={serverUser.text} refs={serverUser.refs} />
        : prompt
          ? <UserBubble text={prompt} />
          : null}
      {contentMessages.map((msg) => (
        <MessageItem key={msg.id} msg={msg} />
      ))}
      {pending && <Thinking label={modeLabel} />}
      {error && (
        <div className="rounded-[10px] border border-[#f0d4d4] bg-[#fff7f7] px-[12px] py-[10px] text-[12.5px] text-[#b42318]">
          <p>{error}</p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-space-sm rounded-[7px] border border-[#efc8c8] bg-white px-space-md py-space-xs font-medium hover:bg-[#fffafa]"
          >
            重新生成
          </button>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  )
}
