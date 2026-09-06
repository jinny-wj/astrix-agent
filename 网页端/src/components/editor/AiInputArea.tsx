import {
  CircleDashed,
  Image as ImageIcon,
  ArrowUp,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { QUICK_ACTIONS, type QuickAction } from '../../data/aiPanel'
import {
  flattenNamedLayers,
  type TargetedLayer,
} from '../../services/figmaLayer'
import {
  emojiPalette,
  filesToUploadPayload,
  readActiveInstructionIds,
  readLocalFiles,
  readPreferredBackend,
  readSavedInstructions,
  revokeAttachmentPreview,
  writeActiveInstructionIds,
  writePreferredBackend,
  writeSavedInstructions,
} from '../../services/agentComposer'
import { getAgentStatus, uploadAgentAttachments } from '../../services/agentApi'
import { requestRecentFigmaFiles } from '../../services/figmaRecents'
import { useEditor } from '../../state/editorStore'
import type {
  AgentAttachment,
  AgentBackendKind,
  AgentChatExtras,
  AgentContextItem,
  AgentInstruction,
  AgentMcpService,
  AgentStatusSnapshot,
} from '../../types/agentComposer'
import ModelSwitcher from '../ModelSwitcher'
import PlusComposerMenu, {
  type ComposerPanel,
} from './composer/PlusComposerMenu'

/** 能力标签左侧的小图标，按 glyph 区分 */
function ActionGlyph({ action }: { action: QuickAction }) {
  const color = action.accent ? '#3b6fe0' : '#7a7a81'
  const g = action.glyph

  return (
    <svg viewBox="0 0 14 14" className="h-[12px] w-[12px] shrink-0">
      {g === 'zap' && (
        <path d="M8 1L3 8h3l-1 5 5-7H7z" fill={color} />
      )}
      {g === 'sparkle' && (
        <path d="M7 1l1.3 3.7L12 6l-3.7 1.3L7 11 5.7 7.3 2 6l3.7-1.3z" fill={color} />
      )}
      {(g === 'image' || g === 'picture' || g === 'visual') && (
        <g fill="none" stroke={color} strokeWidth="1.2">
          <rect x="1.5" y="2.5" width="11" height="9" rx="1.5" />
          <circle cx="5" cy="5.8" r="1.1" fill={color} stroke="none" />
          <path d="M2.5 10l3-3 2 2 2.2-2 2 3" />
        </g>
      )}
      {g === 'component' && (
        <g fill="none" stroke={color} strokeWidth="1.2">
          <rect x="1.6" y="1.6" width="4.4" height="4.4" rx="1" />
          <rect x="8" y="1.6" width="4.4" height="4.4" rx="1" />
          <rect x="1.6" y="8" width="4.4" height="4.4" rx="1" />
          <rect x="8" y="8" width="4.4" height="4.4" rx="1" />
        </g>
      )}
      {g === 'font' && (
        <g fill="none" stroke={color} strokeWidth="1.3" strokeLinecap="round">
          <path d="M3 3h8M7 3v8" />
        </g>
      )}
      {g === 'icon' && (
        <g fill="none" stroke={color} strokeWidth="1.2">
          <circle cx="7" cy="7" r="5.2" />
          <path d="M4.6 7h4.8M7 4.6v4.8" strokeLinecap="round" />
        </g>
      )}
      {g === 'spec' && (
        <g fill="none" stroke={color} strokeWidth="1.2">
          <circle cx="7" cy="7" r="5.2" />
          <path d="M7 4v3l2.2 1.4" strokeLinecap="round" />
        </g>
      )}
      {g === 'analyze' && (
        <g fill="none" stroke={color} strokeWidth="1.2" strokeLinecap="round">
          <path d="M2.5 11V7M6 11V3.5M9.5 11V6" />
        </g>
      )}
    </svg>
  )
}

function FigmaGlyph() {
  return (
    <svg viewBox="0 0 12 18" className="h-[11px] w-[8px] shrink-0" aria-hidden="true">
      <path d="M3 0h3v6H3a3 3 0 0 1 0-6z" fill="#f24e1e" />
      <path d="M6 0h3a3 3 0 0 1 0 6H6V0z" fill="#ff7262" />
      <path d="M6 6h3a3 3 0 0 1 0 6H6V6z" fill="#1abcfe" />
      <path d="M3 6h3v6H3a3 3 0 0 1 0-6z" fill="#a259ff" />
      <path d="M3 12h3v3a3 3 0 1 1-3-3z" fill="#0acf83" />
    </svg>
  )
}

const SKILL_CONTEXT: AgentContextItem[] = [
  { id: 'skill:portrait-beautify', kind: 'skill', label: '一键美化', skill: 'portrait-beautify' },
  { id: 'skill:kv-resource-extension', kind: 'skill', label: '资源位延展', skill: 'kv-resource-extension' },
  { id: 'skill:visual-draft-generation', kind: 'skill', label: '视觉稿生成', skill: 'visual-draft-generation' },
  { id: 'skill:code-from-figma', kind: 'skill', label: 'Figma 转代码', skill: 'code-from-figma' },
  { id: 'skill:loop', kind: 'skill', label: 'Loop', skill: 'loop' },
  { id: 'skill:hermes', kind: 'skill', label: 'Hermes', skill: 'hermes' },
]

export default function AiInputArea({
  onSend,
  disabled,
  layers = [],
  onDismissLayer,
  figmaActive = false,
  bridgeConnected = false,
}: {
  onSend?: (text: string, skill?: string, extras?: AgentChatExtras) => void
  disabled?: boolean
  layers?: TargetedLayer[]
  onDismissLayer?: (id: string) => void
  figmaActive?: boolean
  bridgeConnected?: boolean
}) {
  const { figmaDocument, visualDocument, workspaceFileName, selectNode, agentPrompt } = useEditor()
  const [value, setValue] = useState('')
  const [plusOpen, setPlusOpen] = useState(false)
  const [plusPanel, setPlusPanel] = useState<ComposerPanel>('root')
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [skillsOnly, setSkillsOnly] = useState(false)
  const [attachments, setAttachments] = useState<AgentAttachment[]>([])
  const [contextRefs, setContextRefs] = useState<AgentContextItem[]>([])
  const [instructions, setInstructions] = useState<AgentInstruction[]>(() => readSavedInstructions())
  const [activeInstructionIds, setActiveInstructionIds] = useState<Set<string>>(
    () => new Set(readActiveInstructionIds()),
  )
  const [enabledMcpIds, setEnabledMcpIds] = useState<Set<string>>(new Set())
  const [mcpSkill, setMcpSkill] = useState<string | undefined>()
  const [preferredBackend, setPreferredBackend] = useState<AgentBackendKind | undefined>(
    () => readPreferredBackend(),
  )
  const [status, setStatus] = useState<AgentStatusSnapshot | null>(null)
  const [recentFiles, setRecentFiles] = useState<AgentContextItem[]>([])
  const [uploadError, setUploadError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const plusRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => window.designStudioAgentHost?.onUiAction?.((action) => {
    setEmojiOpen(false)
    if (action === 'skills') {
      setSkillsOnly(true)
      setPlusPanel('context')
      setPlusOpen(true)
    } else {
      setPlusOpen(false)
    }
  }), [])
  const activeLayer = layers[0]
  const placeholder = layers.length
    ? `修改${layers.length === 1 ? `「${layers[0].name}」` : `这 ${layers.length} 个图层`}，例如：改成红色、右移 20px…`
    : '输入你想要的需求，引用一个skill帮你完成'

  const contextItems = useMemo<AgentContextItem[]>(() => {
    const items: AgentContextItem[] = []
    for (const layer of layers) {
      items.push({
        id: `layer:${layer.id}`,
        kind: 'layer',
        label: layer.name,
        detail: layer.type,
        nodeId: layer.id,
        fileKey: layer.fileKey,
      })
    }
    if (figmaDocument) {
      items.push({
        id: `file:${figmaDocument.key}`,
        kind: 'file',
        label: figmaDocument.file.name || workspaceFileName,
        detail: '当前文件',
        fileKey: figmaDocument.key,
      })
      for (const node of flattenNamedLayers(figmaDocument.file.document, 24)) {
        if (items.some((item) => item.nodeId === node.id)) continue
        items.push({
          id: `layer:${node.id}`,
          kind: 'layer',
          label: node.name,
          detail: node.type,
          nodeId: node.id,
          fileKey: figmaDocument.key,
        })
      }
    } else if (workspaceFileName) {
      items.push({
        id: `file:${workspaceFileName}`,
        kind: 'file',
        label: workspaceFileName,
        detail: visualDocument.title || '当前画布',
      })
    }
    items.push(...recentFiles, ...SKILL_CONTEXT)
    if (agentPrompt) {
      items.push({
        id: 'conversation:last',
        kind: 'conversation',
        label: agentPrompt.slice(0, 36) || '上一轮对话',
        detail: '上一轮用户请求',
      })
    }
    return items
  }, [layers, figmaDocument, workspaceFileName, visualDocument.title, recentFiles, agentPrompt])

  const selectedContextIds = useMemo(
    () => new Set(contextRefs.map((item) => item.id)),
    [contextRefs],
  )

  const extras = (): AgentChatExtras => ({
    attachments,
    contextRefs,
    instructions: instructions.filter((item) => activeInstructionIds.has(item.id)),
    backend: preferredBackend,
    mcpSkill,
  })

  const canSend = (value.trim().length > 0 || attachments.length > 0) && !disabled

  useEffect(() => {
    if (!plusOpen && !emojiOpen) return undefined
    const close = (event: MouseEvent) => {
      const target = event.target as Node
      if (plusRef.current?.contains(target)) return
      setPlusOpen(false)
      setPlusPanel('root')
      setEmojiOpen(false)
    }
    document.addEventListener('mousedown', close)
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setPlusOpen(false)
      setEmojiOpen(false)
      textareaRef.current?.focus()
    }
    document.addEventListener('keydown', onEscape)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', onEscape)
    }
  }, [plusOpen, emojiOpen])

  useEffect(() => {
    if (!plusOpen) return undefined
    let cancelled = false
    void getAgentStatus()
      .then((snapshot) => {
        if (!cancelled) setStatus(snapshot)
      })
      .catch(() => {
        if (!cancelled) setStatus(null)
      })
    void requestRecentFigmaFiles(800).then((result) => {
      if (cancelled) return
      setRecentFiles(
        result.files.slice(0, 6).map((file) => ({
          id: `file:${file.key}`,
          kind: 'file' as const,
          label: file.title || file.key,
          detail: '最近打开',
          fileKey: file.key,
        })),
      )
    }).catch(() => {})
    return () => {
      cancelled = true
    }
  }, [plusOpen, plusPanel])

  const pickFiles = () => {
    setPlusOpen(false)
    setPlusPanel('root')
    fileInputRef.current?.click()
  }

  const addFiles = async (list: FileList | null) => {
    if (!list || list.length === 0) return
    setUploadError('')
    const local = await readLocalFiles(list)
    setAttachments((current) => [...current, ...local].slice(0, 8))
    try {
      const uploaded = await uploadAgentAttachments(await filesToUploadPayload(list))
      setAttachments((current) => current.map((item) => {
        const match = uploaded.find((file) => file.name === item.name)
        return match ? { ...item, ...match, previewUrl: item.previewUrl } : item
      }))
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : '上传失败，将仅把可读文本发给 Agent')
    }
  }

  const removeAttachment = (id: string) => {
    setAttachments((current) => {
      const target = current.find((item) => item.id === id)
      if (target) revokeAttachmentPreview(target)
      return current.filter((item) => item.id !== id)
    })
  }

  const buildPayload = (text: string, skill?: string) => {
    const payload = extras()
    const contextSkill = [...payload.contextRefs]
      .reverse()
      .find((item) => item.kind === 'skill')?.skill
    return {
      text,
      skill: skill ?? payload.mcpSkill ?? contextSkill,
      extras: payload,
    }
  }

  const handleSend = (skill?: string) => {
    const text = value.trim()
    if (disabled) return
    if (!text && attachments.length === 0) return
    const payload = buildPayload(text, skill)
    setValue('')
    attachments.forEach(revokeAttachmentPreview)
    setAttachments([])
    setContextRefs([])
    onSend?.(payload.text, payload.skill, payload.extras)
  }

  const handleQuickAction = (action: QuickAction) => {
    if (disabled) return
    const skillByLabel: Record<string, string> = {
      一键美化: 'portrait-beautify',
      资源位延展: 'kv-resource-extension',
      人物战报: 'battle-report',
      视觉稿生成: 'visual-draft-generation',
      'Figma 转代码': 'code-from-figma',
      批量生成: 'kv-resource-extension',
      Loop: 'loop',
      Hermes: 'hermes',
    }
    const text = value.trim() || action.label
    const payload = buildPayload(text, skillByLabel[action.label] ?? action.label)
    setValue('')
    attachments.forEach(revokeAttachmentPreview)
    setAttachments([])
    setContextRefs([])
    onSend?.(payload.text, payload.skill, payload.extras)
  }

  const toggleContext = (item: AgentContextItem) => {
    setContextRefs((current) => {
      const exists = current.some((entry) => entry.id === item.id)
      if (exists) {
        if (item.kind === 'skill' && item.skill && item.skill === mcpSkill) {
          setMcpSkill(undefined)
        }
        return current.filter((entry) => entry.id !== item.id)
      }
      if (item.kind === 'skill' && item.skill) setMcpSkill(item.skill)
      return [...current, item]
    })
    if (item.kind === 'layer' && item.nodeId) selectNode(item.nodeId)
  }

  const toggleInstruction = (id: string) => {
    setActiveInstructionIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      writeActiveInstructionIds([...next])
      return next
    })
  }

  const saveInstruction = (item: AgentInstruction) => {
    setInstructions((current) => {
      const next = [...current.filter((entry) => entry.id !== item.id), item]
      writeSavedInstructions(next)
      return next
    })
    setActiveInstructionIds((current) => {
      const next = new Set(current)
      next.add(item.id)
      writeActiveInstructionIds([...next])
      return next
    })
  }

  const deleteInstruction = (id: string) => {
    setInstructions((current) => {
      const next = current.filter((item) => item.id !== id)
      writeSavedInstructions(next)
      return next
    })
    setActiveInstructionIds((current) => {
      const next = new Set(current)
      next.delete(id)
      writeActiveInstructionIds([...next])
      return next
    })
  }

  const toggleMcp = (service: AgentMcpService) => {
    const enabling = !enabledMcpIds.has(service.id)
    setEnabledMcpIds((current) => {
      const next = new Set(current)
      if (enabling) next.add(service.id)
      else next.delete(service.id)
      return next
    })
    if (enabling && service.skill) setMcpSkill(service.skill)
    if (!enabling && service.skill && service.skill === mcpSkill) setMcpSkill(undefined)
    if (service.id === 'figma-layers' && activeLayer) {
      const item: AgentContextItem = {
        id: `layer:${activeLayer.id}`,
        kind: 'layer',
        label: activeLayer.name,
        detail: activeLayer.type,
        nodeId: activeLayer.id,
        fileKey: activeLayer.fileKey,
      }
      setContextRefs((current) => {
        const exists = current.some((entry) => entry.id === item.id)
        if (enabling) return exists ? current : [...current, item]
        return current.filter((entry) => entry.id !== item.id)
      })
    }
  }

  const pickBackend = (id: AgentBackendKind) => {
    setPreferredBackend(id)
    writePreferredBackend(id)
  }

  const insertEmoji = (emoji: string) => {
    const textarea = textareaRef.current
    if (!textarea) {
      setValue((current) => current + emoji)
      setEmojiOpen(false)
      return
    }
    const start = textarea.selectionStart ?? value.length
    const end = textarea.selectionEnd ?? value.length
    const next = `${value.slice(0, start)}${emoji}${value.slice(end)}`
    setValue(next)
    setEmojiOpen(false)
    requestAnimationFrame(() => {
      textarea.focus()
      const caret = start + emoji.length
      textarea.setSelectionRange(caret, caret)
    })
  }

  const onTextChange = (next: string) => {
    setValue(next)
    if (next.endsWith('#') && !plusOpen) {
      setPlusOpen(true)
      setSkillsOnly(false)
      setPlusPanel('context')
      setEmojiOpen(false)
    }
  }

  return (
    <div className="px-[14px] pb-[12px] pt-[10px]">
      <div className="flex flex-wrap gap-[7px] pb-[12px]">
        {QUICK_ACTIONS.map((action) => (
          <button
            key={action.label}
            type="button"
            onClick={() => handleQuickAction(action)}
            className="flex items-center gap-[5px] rounded-[8px] border border-hairline bg-white px-[9px] py-[6px] text-[12px] text-[#3d3d42] transition-colors hover:bg-[#f7f7f8]"
          >
            <ActionGlyph action={action} />
            {action.label}
          </button>
        ))}
      </div>

      <div className="ai-reference-input">
        {figmaActive && (
          <div className="mb-2 text-[11px] leading-5" role="status" aria-live="polite">
            <p className={bridgeConnected ? 'text-[#33865a]' : 'text-[#996622]'}>
              {bridgeConnected
                ? layers.length ? `已选 ${layers.length} 个图层 · 修改仅作用于下方选区` : '已连接 Bridge · 请在 Figma 画布中点击图层'
                : '尚未连接此文件的 Bridge · 登录 Figma 不等于已连接图层'}
            </p>
            {!bridgeConnected && (
              <details className="text-[#777780]">
                <summary className="cursor-pointer text-[#3b6fe0]">连接图层并开启修改</summary>
                <p className="py-1">内嵌 Figma / 浏览器：需先发布 Bridge 插件，再从 Plugins 中运行并保持打开，才能同步此画布选区。</p>
                <p className="py-1">本地测试：在 Figma 官方桌面版的 Plugins → Development 中导入 manifest.json 并运行。这时同步的是官方桌面版里的选区，不是内嵌页面的选区。</p>
                {window.designStudioAgentHost?.installBridge && (
                  <button type="button" className="text-[#3b6fe0]" onClick={() => window.designStudioAgentHost?.installBridge?.()}>查看本地插件文件（官方 Figma 桌面版）</button>
                )}
              </details>
            )}
          </div>
        )}
        {layers.length > 0 && (
          <div className="mb-[8px] flex max-h-[150px] flex-wrap gap-[6px] overflow-y-auto" aria-label="当前选中图层">
            {layers.map((layer) => (
              <span
                key={layer.id}
                title={`${layer.name} · ${layer.type} · ${layer.id}`}
                className="inline-flex max-w-full items-center gap-[6px] rounded-[7px] bg-[#f4f4f6] py-[3px] pl-[4px] pr-[4px]"
              >
                {layer.thumbnailUrl ? (
                  <img
                    src={layer.thumbnailUrl}
                    alt=""
                    className="h-[18px] w-[18px] rounded-[4px] object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <span className="flex h-[18px] w-[18px] items-center justify-center rounded-[4px] bg-white">
                    <FigmaGlyph />
                  </span>
                )}
                <span className="min-w-0 truncate text-[11.5px] text-[#3d3d42]">
                  {layer.name}
                </span>
                <span className="shrink-0 text-[10px] uppercase tracking-wide text-[#8a8a90]">
                  {layer.type}
                </span>
                <button
                  type="button"
                  aria-label={`取消对准 ${layer.name}`}
                  onPointerDown={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                  }}
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    onDismissLayer?.(layer.id)
                  }}
                  className="flex h-[18px] w-[18px] items-center justify-center rounded-[4px] text-[#8a8a90] hover:bg-white hover:text-ink"
                >
                  <X size={11} strokeWidth={2} />
                </button>
              </span>
            ))}
          </div>
        )}

        {activeLayer?.characters !== undefined && (
          <div className="mb-2 rounded-lg bg-[#f6f8fc] px-2 py-2 text-[11px] text-[#626978]">
            <div className="mb-1 flex items-center justify-between">
              <span>{layers.length > 1 ? '首个图层原文' : '当前图层原文'}</span>
              <button type="button" disabled={disabled} className="text-[#3b6fe0] disabled:opacity-40" onClick={() => {
                const prefix = '把文字改为“'
                const original = activeLayer.characters ?? ''
                setValue(`${prefix}${original}”`)
                requestAnimationFrame(() => {
                  textareaRef.current?.focus()
                  textareaRef.current?.setSelectionRange(prefix.length, prefix.length + original.length)
                })
              }}>修改文字</button>
            </div>
            <p className="max-h-16 overflow-y-auto whitespace-pre-wrap break-words">{activeLayer.characters || '（空文本）'}</p>
          </div>
        )}

        {(attachments.length > 0 || contextRefs.length > 0 || mcpSkill) && (
          <div className="mb-[8px] flex flex-wrap gap-[6px]">
            {attachments.map((file) => (
              <span
                key={file.id}
                className="inline-flex max-w-full items-center gap-[6px] rounded-[7px] bg-[#eef3ff] py-[3px] pl-[4px] pr-[4px]"
              >
                {file.previewUrl ? (
                  <img src={file.previewUrl} alt="" className="h-[18px] w-[18px] rounded-[4px] object-cover" />
                ) : (
                  <ImageIcon size={12} strokeWidth={1.8} className="ml-[2px] text-[#3b6fe0]" />
                )}
                <span className="max-w-[140px] truncate text-[11.5px] text-[#3d3d42]">{file.name}</span>
                <button
                  type="button"
                  aria-label={`移除 ${file.name}`}
                  onClick={() => removeAttachment(file.id)}
                  className="flex h-[18px] w-[18px] items-center justify-center text-[#8a8a90] hover:text-ink"
                >
                  <X size={11} />
                </button>
              </span>
            ))}
            {contextRefs.map((item) => (
              <span
                key={item.id}
                className="inline-flex max-w-full items-center gap-[5px] rounded-[7px] bg-[#f4f4f6] px-[6px] py-[3px] text-[11.5px] text-[#3d3d42]"
              >
                #{item.label}
                <button
                  type="button"
                  aria-label={`移除 ${item.label}`}
                  onClick={() => toggleContext(item)}
                  className="text-[#8a8a90] hover:text-ink"
                >
                  <X size={11} />
                </button>
              </span>
            ))}
            {mcpSkill ? (
              <span className="inline-flex items-center gap-[5px] rounded-[7px] bg-[#eef3ff] px-[6px] py-[3px] text-[11.5px] text-[#3b6fe0]">
                MCP · {mcpSkill}
                <button type="button" onClick={() => setMcpSkill(undefined)} className="text-[#8a8a90] hover:text-ink">
                  <X size={11} />
                </button>
              </span>
            ) : null}
          </div>
        )}

        {uploadError ? (
          <p className="mb-[6px] text-[11px] text-[#b42318]">{uploadError}</p>
        ) : null}

        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onTextChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setPlusOpen(false)
              setEmojiOpen(false)
              return
            }
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              handleSend()
            }
          }}
          rows={2}
          placeholder={placeholder}
          aria-label="给 AI 助手输入需求"
          className="ai-reference-textarea scroll-clean"
        />

        <div className="ai-reference-tools">
          <div ref={plusRef} className="ai-reference-tool-group">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,.png,.jpg,.jpeg,.webp,.gif,.svg,.pdf,.txt,.md,.json,.csv,.fig"
              className="hidden"
              onChange={(event) => {
                void addFiles(event.target.files)
                event.target.value = ''
              }}
            />
            <button type="button" className="ai-reference-tool" aria-label="添加照片和文件" title="添加照片和文件" onClick={pickFiles}>
              <img src="/assets/agent-reference/attach.svg" alt="" />
            </button>
            <button type="button" className="ai-reference-tool" aria-label="引用技能" title="引用技能" aria-expanded={plusOpen && skillsOnly} onClick={() => { setEmojiOpen(false); setSkillsOnly(true); setPlusPanel('context'); setPlusOpen(true) }}>
              <img src="/assets/agent-reference/cube.svg" alt="" />
            </button>
            <button type="button" className="ai-reference-tool" aria-label="添加指令" title="添加指令" aria-expanded={plusOpen && plusPanel === 'instruction'} onClick={() => { setEmojiOpen(false); setSkillsOnly(false); setPlusPanel('instruction'); setPlusOpen(true) }}>
              <img src="/assets/agent-reference/book.svg" alt="" />
            </button>
            <button type="button" className="ai-reference-tool" aria-label="更多工具和上下文" title="更多工具和上下文" aria-expanded={plusOpen && plusPanel === 'root'} onClick={() => { setEmojiOpen(false); setSkillsOnly(false); setPlusPanel('root'); setPlusOpen(!plusOpen || plusPanel !== 'root') }}>
              <img src="/assets/agent-reference/hand.svg" alt="" />
            </button>
            {plusOpen ? (
              <PlusComposerMenu
                panel={plusPanel}
                onPanel={(panel) => { setSkillsOnly(false); setPlusPanel(panel) }}
                onEmoji={() => { setPlusOpen(false); setEmojiOpen(true) }}
                onAddFiles={pickFiles}
                contextItems={skillsOnly ? SKILL_CONTEXT : contextItems}
                selectedContextIds={selectedContextIds}
                onToggleContext={toggleContext}
                instructions={instructions}
                activeInstructionIds={activeInstructionIds}
                onToggleInstruction={toggleInstruction}
                onSaveInstruction={saveInstruction}
                onDeleteInstruction={deleteInstruction}
                status={status}
                enabledMcpIds={enabledMcpIds}
                onToggleMcp={toggleMcp}
                preferredBackend={preferredBackend}
                onPickBackend={pickBackend}
              />
            ) : null}

            {emojiOpen ? (
              <div className="absolute bottom-[calc(100%+8px)] left-[28px] z-50 grid w-[196px] grid-cols-8 gap-[4px] rounded-[12px] border border-[#e7e8ec] bg-white p-[8px] shadow-[0_12px_40px_rgba(28,32,42,0.14)]">
                {emojiPalette().map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => insertEmoji(emoji)}
                    className="h-[20px] rounded-[4px] text-[14px] hover:bg-[#f4f5f7]"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            ) : null}

          </div>

          <button
            type="button"
            aria-label="发送消息"
            disabled={!canSend}
            onClick={() => handleSend()}
            className="ai-reference-send"
          >
            {canSend ? <ArrowUp size={18} strokeWidth={1.8} /> : <img src="/assets/agent-reference/send.svg" alt="" />}
          </button>
        </div>
      </div>

      <div className="mt-[9px] flex min-w-0 items-center justify-between gap-2 text-[11.5px]">
        <div className="flex items-center gap-[13px] text-[#8a8a90]">
          <span className="flex items-center gap-[4px]">
            <CircleDashed size={11} strokeWidth={2} />0%
          </span>
          <span className="flex items-center gap-[4px]">
            <CircleDashed size={11} strokeWidth={2} />
            100%
          </span>
        </div>
        <ModelSwitcher variant="plain" />
        <span className="min-w-0 truncate text-[#3fa96a]" title={activeLayer?.name}>
          {activeLayer ? `已对准 ${activeLayer.name}` : '点选图层即可对准'}
        </span>
      </div>
    </div>
  )
}
