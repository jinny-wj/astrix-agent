import { useEffect, useState } from 'react'
import type { DesktopWorkspaceContext } from '../../types/desktop'
import { useDesktopAgentWorkspace } from '../../hooks/useDesktopAgentWorkspace'
import { useFigmaLayerTarget } from '../../hooks/useFigmaLayerTarget'
import { useEditor } from '../../state/editorStore'
import type { AgentChatExtras } from '../../types/agentComposer'
import type { AgentConversation, ClarificationAnswer } from '../../types/agentConversation'
import { cancelAgentConversation } from '../../services/agentApi'
import { conversationStorageKey, readConversationId, saveConversationId } from '../../services/agentConversation'
import '../../types/desktop'
import AiInputArea from './AiInputArea'
import AiWelcome from './AiWelcome'
import ConversationFlow from './agent/ConversationFlow'
import './ai-panel.css'

function PanelHeader({
  onReset, onClose, title, prompt,
}: {
  onReset: () => void
  onClose: () => void
  title: string
  prompt: string
}) {
  const [historyOpen, setHistoryOpen] = useState(false)
  return (
    <div className="ai-panel-header">
      <span className="ai-panel-file-title" title={title}>{title}</span>
      <div className="ai-panel-header-actions">
        <button title="新任务" aria-label="新任务" onClick={() => { setHistoryOpen(false); onReset() }}>
          <img src="/assets/agent-reference/create.svg" alt="" />
        </button>
        <button title="本次会话记录" aria-label="本次会话记录" aria-expanded={historyOpen} onClick={() => setHistoryOpen(!historyOpen)}>
          <img src="/assets/agent-reference/time.svg" alt="" />
        </button>
        <button title="收起 AI 助手" aria-label="收起 AI 助手" onClick={onClose}>
          <img src="/assets/agent-reference/exit.svg" alt="" />
        </button>
      </div>
      {historyOpen && (
        <div className="ai-panel-session" role="dialog" aria-label="本次会话记录">
          <div className="flex items-center justify-between"><strong>本次会话</strong><button onClick={() => setHistoryOpen(false)} aria-label="关闭会话记录">×</button></div>
          <p>{prompt || '当前还没有发送消息。'}</p>
          <span>完整对话保存在本机，可在下方查看；刷新后可以继续。</span>
        </div>
      )}
    </div>
  )
}

export default function AiPanel({
  variant = 'editor',
}: {
  variant?: 'editor' | 'standalone'
}) {
  const {
    agentRunning,
    agentDone,
    agentPrompt,
    agentSkill,
    agentSelection,
    agentExtras,
    startAgent,
    finishAgent,
    pauseAgent,
    failAgent,
    retryAgent,
    resetAgent,
    refreshFigmaDocument,
    updateVisualDocument,
    generationStatus,
    workspaceMode,
    workspaceFileName,
  } = useEditor()
  const [nativeTitle, setNativeTitle] = useState('')
  const [collapsed, setCollapsed] = useState(false)
  const [storageKey] = useState(() => conversationStorageKey(window.location.href))
  const [conversationId, setConversationId] = useState(() => readConversationId(storageKey))
  const [conversation, setConversation] = useState<AgentConversation | null>(null)
  const [conversationEpoch, setConversationEpoch] = useState(0)
  useEffect(() => {
    const host = window.designStudioAgentHost
    if (!host) return
    let active = true
    const apply = (value: unknown) => {
      const context = value as DesktopWorkspaceContext | null
      if (active) setNativeTitle(context?.title || '')
    }
    void host.getContext().then(apply).catch(() => {})
    const unsubscribe = host.onContext(apply)
    return () => { active = false; unsubscribe() }
  }, [])
  const layerTarget = useFigmaLayerTarget()
  useDesktopAgentWorkspace({
    onStart: (prompt, skill) => sendToAgent(prompt, skill),
  })
  const hasConversation = agentRunning || agentDone || Boolean(agentPrompt) || Boolean(conversationId) || generationStatus === 'error'
  const serverBusy = conversation?.status === 'running' || conversation?.status === 'assessing'

  const sendToAgent = (text: string, skill?: string, extras?: AgentChatExtras) => {
    const resolvedSkill = skill
      ?? extras?.mcpSkill
      ?? (workspaceMode === 'code' ? 'code-from-figma' : undefined)
    const snapshot = layerTarget.snapshot
    startAgent(text, resolvedSkill, snapshot, extras)
  }

  const beginNewConversation = () => {
    if (conversationId) void cancelAgentConversation(conversationId).catch(() => {})
    saveConversationId(storageKey)
    setConversationId(undefined)
    setConversation(null)
    setConversationEpoch(value => value + 1)
    resetAgent()
  }

  const acceptConversation = (value: AgentConversation) => {
    saveConversationId(storageKey, value.conversationId)
    setConversationId(value.conversationId)
    setConversation(value)
  }

  const answerClarification = (answer: ClarificationAnswer) => {
    const questions = conversation?.pending?.questions ?? []
    const text = questions.map(question => `${question.label}：${answer.answers[question.id] ?? ''}`).join('\n')
    sendToAgent(text || '补充当前任务信息', undefined, {
      attachments: [], contextRefs: [], instructions: [], clarificationAnswer: answer,
    })
  }

  if (collapsed) return <button className="ai-panel-reopen" onClick={() => setCollapsed(false)}>打开 AI 助手</button>

  return (
    <aside
      aria-label="AI 助手工作区"
      className={[
        'ai-panel flex min-h-0 flex-col',
        variant === 'standalone'
          ? 'h-full w-full'
          : 'w-[402px] shrink-0',
      ].join(' ')}
    >
      <div className="ai-panel-surface">
      <PanelHeader
        onReset={beginNewConversation}
        onClose={() => window.designStudioAgentHost?.hidePanel ? window.designStudioAgentHost.hidePanel() : setCollapsed(true)}
        title={nativeTitle || workspaceFileName || '未命名文件'}
        prompt={conversation?.originalRequest || agentPrompt}
      />
      <div className="ai-panel-conversation scroll-clean min-h-0 flex-1 overflow-y-auto">
        {hasConversation ? (
          <ConversationFlow
            key={conversationEpoch}
            running={agentRunning}
            prompt={agentPrompt}
            skill={agentSkill}
            selection={agentSelection}
            extras={agentExtras}
            conversationId={conversationId}
            onConversation={acceptConversation}
            onAnswer={answerClarification}
            onDone={finishAgent}
            onPause={pauseAgent}
            onFail={failAgent}
            onRetry={retryAgent}
            onArtifact={updateVisualDocument}
            onFigmaWriteSuccess={() => { void refreshFigmaDocument() }}
          />
        ) : (
          <AiWelcome />
        )}
      </div>
      <div className="ai-panel-composer shrink-0">
        <AiInputArea
          onSend={sendToAgent}
          disabled={agentRunning || serverBusy}
          awaitingClarification={conversation?.status === 'awaiting_user'}
          layers={layerTarget.layers}
          figmaActive={Boolean(layerTarget.fileKey)}
          bridgeConnected={layerTarget.bridgeConnected}
          onDismissLayer={layerTarget.dismiss}
        />
      </div>
      </div>
    </aside>
  )
}
