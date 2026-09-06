import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { AGENDA_ITEMS, type AgendaItem } from '../data/canvasDoc'
import {
  clearQueuedWorkspaceDraft,
  readQueuedWorkspaceDraft,
  readWorkspaceFile,
  type WorkspaceDraft,
} from '../config/workspace'
import type { FigmaFileResponse } from '../types/figma'
import { patchFigmaNodes } from '../services/figmaDocumentPatch'
import { importFigmaFileWithOAuth } from '../services/figmaApi'
import type { FigmaEditIntent, FigmaSelectionSnapshot } from '../types/figmaWrite'
import type { AgentChatExtras } from '../types/agentComposer'
import {
  createVisualDocument,
  type VisualDocument,
  type VisualDocumentChanges,
} from '../types/visual'

/** 画布视图状态：单稿编辑 / 批量产出板 */
export type CanvasView = 'single' | 'batch'
export type WorkspaceMode = 'design' | 'code'
export type GenerationStatus = 'idle' | 'running' | 'complete' | 'error'

export type ImportedFigmaDocument = {
  key: string
  nodeId?: string
  file: FigmaFileResponse
  images: Record<string, string>
}

type EditorValue = {
  /** Agent 是否正在回放 */
  agentRunning: boolean
  /** 是否已完成过一次生成 */
  agentDone: boolean
  /** 最近一次发给 Agent 的用户输入 */
  agentPrompt: string
  /** 预选 Skill（来自首页功能卡等） */
  agentSkill?: string
  /** 发送时对准的 Figma 图层 */
  agentSelection: FigmaSelectionSnapshot | null
  /** 附件、引用、指令、MCP 等随请求带上的上下文 */
  agentExtras: AgentChatExtras | null
  generationStatus: GenerationStatus
  agentError: string
  canvasView: CanvasView
  workspaceMode: WorkspaceMode
  setWorkspaceMode: (mode: WorkspaceMode) => void
  startAgent: (
    prompt: string,
    skill?: string,
    selection?: FigmaSelectionSnapshot | null,
    extras?: AgentChatExtras | null,
  ) => void
  finishAgent: () => void
  failAgent: (message: string) => void
  retryAgent: () => void
  setCanvasView: (v: CanvasView) => void
  /** 清空会话，回到欢迎态与单稿画布 */
  resetAgent: () => void
  document: AgendaItem[]
  selectedNodeId: string
  selectedNodeIds: string[]
  editingNodeId: string | null
  zoom: number
  pan: { x: number; y: number }
  selectNode: (id: string, options?: { additive?: boolean }) => void
  deselectNode: (id: string) => void
  selectionEpoch: number
  applyFigmaPatches: (nodeIds: string[], patches: FigmaEditIntent[]) => boolean
  startEditing: (id?: string) => void
  stopEditing: () => void
  updateNodeText: (id: string, value: string) => void
  setZoom: (zoom: number) => void
  setPan: (pan: { x: number; y: number }) => void
  resetView: () => void
  figmaDocument: ImportedFigmaDocument | null
  setFigmaDocument: (document: ImportedFigmaDocument | null) => void
  refreshFigmaDocument: () => Promise<void>
  visualDraft: boolean
  setVisualDraft: (value: boolean) => void
  visualReady: boolean
  visualDocument: VisualDocument
  workspaceFileName: string
  updateVisualDocument: (changes: VisualDocumentChanges) => void
  duplicateVisualDocument: () => void
}

const EditorContext = createContext<EditorValue | null>(null)

function extrasFromDraft(draft: WorkspaceDraft | null): AgentChatExtras | null {
  if (!draft?.attachments?.length) return null
  return {
    attachments: draft.attachments,
    contextRefs: [],
    instructions: [],
  }
}

function shouldAutoStartQueuedDraft(draft: WorkspaceDraft | null) {
  if (!draft?.prompt.trim()) return false
  if (draft.skill === 'code-from-figma') return false
  return true
}

export function EditorProvider({ children }: { children: ReactNode }) {
  const queuedWorkspaceDraft = useState<WorkspaceDraft | null>(() => readQueuedWorkspaceDraft())[0]
  const workspaceFile = useState(() => readWorkspaceFile())[0]
  const workspaceFileName = workspaceFile?.fileName ?? '未命名设计稿'
  const startsInCodeMode =
    sessionStorage.getItem('design-studio-editor-mode') === 'code'
    || queuedWorkspaceDraft?.skill === 'code-from-figma'
  const autoStartQueued = shouldAutoStartQueuedDraft(queuedWorkspaceDraft)
  const [agentRunning, setAgentRunning] = useState(autoStartQueued)
  const [agentDone, setAgentDone] = useState(false)
  const [agentPrompt, setAgentPrompt] = useState(
    autoStartQueued ? queuedWorkspaceDraft?.prompt ?? '' : '',
  )
  const [agentSkill, setAgentSkill] = useState<string | undefined>(
    autoStartQueued ? queuedWorkspaceDraft?.skill : queuedWorkspaceDraft?.skill,
  )
  const [agentSelection, setAgentSelection] = useState<FigmaSelectionSnapshot | null>(null)
  const [agentExtras, setAgentExtras] = useState<AgentChatExtras | null>(
    () => extrasFromDraft(queuedWorkspaceDraft),
  )
  const [generationStatus, setGenerationStatus] = useState<GenerationStatus>(
    autoStartQueued ? 'running' : 'idle',
  )
  const [agentError, setAgentError] = useState('')
  const [canvasView, setCanvasView] = useState<CanvasView>('single')
  const [workspaceMode, setWorkspaceModeState] = useState<WorkspaceMode>(
    startsInCodeMode ? 'code' : 'design',
  )
  const [document, setDocument] = useState<AgendaItem[]>(() => AGENDA_ITEMS)
  const [selectedNodeId, setSelectedNodeId] = useState('')
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([])
  const [selectionEpoch, setSelectionEpoch] = useState(0)
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null)
  const [zoom, setZoomState] = useState(0.88)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [figmaDocument, setFigmaDocumentState] = useState<ImportedFigmaDocument | null>(null)
  const figmaDocumentRef = useRef(figmaDocument)
  figmaDocumentRef.current = figmaDocument
  const [visualDraft, setVisualDraft] = useState(false)
  const [visualReady, setVisualReady] = useState(false)
  const [visualDocument, setVisualDocumentState] = useState<VisualDocument>(() => {
    return createVisualDocument(queuedWorkspaceDraft?.prompt, workspaceFileName)
  })

  useEffect(() => {
    sessionStorage.removeItem('design-studio-create-fresh-draft')
  }, [])

  const selectNode = useCallback((id: string, options?: { additive?: boolean }) => {
    setEditingNodeId(null)
    setSelectedNodeId(id)
    setSelectedNodeIds((current) => {
      if (!options?.additive) return [id]
      return current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id]
    })
    setSelectionEpoch((value) => value + 1)
  }, [])

  const deselectNode = useCallback((id: string) => {
    setSelectedNodeIds((current) => {
      const next = current.filter((item) => item !== id)
      setSelectedNodeId(next[0] ?? '')
      return next
    })
  }, [])

  const applyFigmaPatches = useCallback((nodeIds: string[], patches: FigmaEditIntent[]) => {
    if (nodeIds.length === 0 || patches.length === 0) return false
    let applied = false
    setFigmaDocumentState((current) => {
      if (!current) return current
      applied = true
      return {
        ...current,
        file: {
          ...current.file,
          document: patchFigmaNodes(current.file.document, nodeIds, patches),
        },
      }
    })
    return applied
  }, [])

  const startEditing = useCallback((id?: string) => {
    const target = id ?? selectedNodeId
    if (target.endsWith('-title') || target.endsWith('-speaker') || target.endsWith('-time')) {
      setSelectedNodeId(target)
      setSelectedNodeIds([target])
      setEditingNodeId(target)
    }
  }, [selectedNodeId])

  const updateNodeText = useCallback((id: string, value: string) => {
    const match = id.match(/^row-(\d+)-(time|title|speaker)$/)
    if (!match) return
    const index = Number(match[1])
    const field = match[2] as 'time' | 'title' | 'speaker'
    setDocument((current) => current.map((item, i) => i === index ? { ...item, [field]: value } : item))
  }, [])

  const setZoom = useCallback((value: number) => {
    setZoomState(Math.min(2, Math.max(0.35, value)))
  }, [])

  const resetView = useCallback(() => {
    setZoomState(0.88)
    setPan({ x: 0, y: 0 })
  }, [])

  const setWorkspaceMode = useCallback((mode: WorkspaceMode) => {
    setWorkspaceModeState(mode)
    sessionStorage.setItem('design-studio-editor-mode', mode === 'code' ? 'code' : 'figma')
  }, [])

  const setFigmaDocument = useCallback((value: ImportedFigmaDocument | null) => {
    setFigmaDocumentState(value)
    if (value) {
      setWorkspaceModeState((mode) => {
        if (mode !== 'code') {
          sessionStorage.setItem('design-studio-editor-mode', 'figma')
        }
        return mode
      })
      setVisualDraft(false)
      setVisualReady(false)
      setCanvasView('single')
      const nextId = value.nodeId ?? value.file.document.id
      setSelectedNodeId(nextId)
      setSelectedNodeIds([nextId])
      setZoomState(0.72)
      setPan({ x: 0, y: 0 })
    }
  }, [])

  const refreshFigmaDocument = useCallback(async () => {
    const current = figmaDocumentRef.current
    if (!current) return
    try {
      const result = await importFigmaFileWithOAuth({ urlOrKey: current.key })
      setFigmaDocumentState((existing) => {
        if (!existing || existing.key !== result.key) return existing
        return {
          ...existing,
          file: result.file,
          images: result.images,
        }
      })
    } catch {
      // 预览刷新失败时保留当前画布，导出仍可再试。
    }
  }, [])

  const startAgent = useCallback((
    prompt: string,
    skill?: string,
    selection?: FigmaSelectionSnapshot | null,
    extras?: AgentChatExtras | null,
  ) => {
    const trimmed = prompt.trim()
    const hasAttachments = (extras?.attachments?.length ?? 0) > 0
    if (!trimmed && !hasAttachments) return
    const resolvedPrompt = trimmed
      || `请查看我上传的 ${extras?.attachments.length} 个文件`
    const resolvedSkill = skill
      ?? extras?.mcpSkill
      ?? (workspaceMode === 'code' ? 'code-from-figma' : undefined)
    setAgentPrompt(resolvedPrompt)
    setAgentSkill(resolvedSkill)
    setAgentSelection(selection ?? null)
    setAgentExtras(extras ?? null)
    setAgentRunning(true)
    setAgentDone(false)
    setAgentError('')
    setGenerationStatus('running')
    setVisualDraft(false)
    setCanvasView('single')
    if (resolvedSkill === 'code-from-figma') setWorkspaceMode('code')
  }, [setWorkspaceMode, workspaceMode])

  const finishAgent = useCallback(() => {
    setAgentRunning(false)
    setAgentDone(true)
    setAgentError('')
    setGenerationStatus('complete')
    setVisualReady(false)
    setCanvasView('single')
    clearQueuedWorkspaceDraft()
  }, [])

  const failAgent = useCallback((message: string) => {
    setAgentRunning(false)
    setAgentDone(false)
    setAgentError(message)
    setGenerationStatus('error')
  }, [])

  const retryAgent = useCallback(() => {
    if (!agentPrompt.trim()) return
    setAgentRunning(true)
    setAgentDone(false)
    setAgentError('')
    setGenerationStatus('running')
  }, [agentPrompt])

  const updateVisualDocument = useCallback((changes: VisualDocumentChanges) => {
    setVisualDocumentState((current) => ({
      ...current,
      ...changes,
      name: changes.title ?? current.name,
    }))
  }, [])

  const duplicateVisualDocument = useCallback(() => {
    setVisualDocumentState((current) => ({ ...current, copyCount: current.copyCount + 1 }))
  }, [])

  const resetAgent = useCallback(() => {
    setAgentRunning(false)
    setAgentDone(false)
    setAgentPrompt('')
    setAgentSkill(undefined)
    setAgentSelection(null)
    setAgentExtras(null)
    setAgentError('')
    setGenerationStatus('idle')
    setCanvasView('single')
  }, [])

  return (
    <EditorContext.Provider
      value={{
        agentRunning,
        agentDone,
        agentPrompt,
        agentSkill,
        agentSelection,
        agentExtras,
        generationStatus,
        agentError,
        canvasView,
        workspaceMode,
        setWorkspaceMode,
        startAgent,
        finishAgent,
        failAgent,
        retryAgent,
        setCanvasView,
        resetAgent,
        document,
        selectedNodeId,
        selectedNodeIds,
        editingNodeId,
        zoom,
        pan,
        selectNode,
        deselectNode,
        selectionEpoch,
        applyFigmaPatches,
        startEditing,
        stopEditing: () => setEditingNodeId(null),
        updateNodeText,
        setZoom,
        setPan,
        resetView,
        figmaDocument,
        setFigmaDocument,
        refreshFigmaDocument,
        visualDraft,
        setVisualDraft,
        visualReady,
        visualDocument,
        workspaceFileName,
        updateVisualDocument,
        duplicateVisualDocument,
      }}
    >
      {children}
    </EditorContext.Provider>
  )
}

export function useEditor() {
  const ctx = useContext(EditorContext)
  if (!ctx) throw new Error('useEditor must be used within EditorProvider')
  return ctx
}
