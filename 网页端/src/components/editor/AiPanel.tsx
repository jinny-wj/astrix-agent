import { useEffect, useState } from 'react'
import type { DesktopWorkspaceContext } from '../../types/desktop'
import { useDesktopAgentWorkspace } from '../../hooks/useDesktopAgentWorkspace'
import { useFigmaLayerTarget } from '../../hooks/useFigmaLayerTarget'
import { useEditor } from '../../state/editorStore'
import type { AgentChatExtras } from '../../types/agentComposer'
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
        <button title="新会话" aria-label="新会话" onClick={() => { setHistoryOpen(false); onReset() }}>
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
          <span>仅显示当前会话，不包含已清空的历史。</span>
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
  const hasConversation = agentRunning || agentDone || Boolean(agentPrompt) || generationStatus === 'error'

  const sendToAgent = (text: string, skill?: string, extras?: AgentChatExtras) => {
    const resolvedSkill = skill
      ?? extras?.mcpSkill
      ?? (workspaceMode === 'code' ? 'code-from-figma' : undefined)
    const snapshot = layerTarget.snapshot
    startAgent(text, resolvedSkill, snapshot, extras)
  }

  const beginNewConversation = () => {
    resetAgent()
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
        prompt={agentPrompt}
      />
      <div className="ai-panel-conversation scroll-clean min-h-0 flex-1 overflow-y-auto">
        {hasConversation ? (
          <ConversationFlow
            running={agentRunning}
            prompt={agentPrompt}
            skill={agentSkill}
            selection={agentSelection}
            extras={agentExtras}
            onDone={finishAgent}
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
          disabled={agentRunning}
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
