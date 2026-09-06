import type { AgentAttachment } from '../types/agentComposer'

const WORKSPACE_DRAFT_KEY = 'design-studio:workspace-draft'
const WORKSPACE_PROMPT_KEY = 'design-studio:workspace-prompt'
const WORKSPACE_SKILL_KEY = 'design-studio:workspace-skill'
const WORKSPACE_FIGMA_IMPORT_KEY = 'design-studio:figma-import'
const WORKSPACE_FILE_ID_KEY = 'design-studio:workspace-file-id'
const WORKSPACE_FILE_NAME_KEY = 'design-studio:workspace-file-name'
const WORKSPACE_BOOTSTRAP_PREFIX = 'design-studio:file-bootstrap:'

export type WorkspaceDraft = {
  prompt: string
  skill?: string
  attachments?: AgentAttachment[]
}

export const CODE_FROM_FIGMA_PROMPT =
  '请根据当前 Figma 选区生成可运行的 React + Tailwind 组件。对照图层结构、文案、颜色、圆角和间距。代码写在对话里即可，不要假装这是 IDE。若还没有导入文件，先请我读取或打开 Figma。'

export type QueuedFigmaImport = {
  url: string
  title?: string
}

export type WorkspaceFile = {
  fileId: string
  fileName: string
}

type WorkspaceBootstrap = WorkspaceDraft & {
  fileName: string
  createdAt: number
}

function createWorkspaceFileId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `file-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function untitledFileName() {
  const time = new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date())
  return `未命名 ${time}`
}

export function serializeWorkspaceAttachment(file: AgentAttachment): AgentAttachment {
  return {
    id: file.id,
    name: file.name,
    mime: file.mime,
    size: file.size,
    kind: file.kind,
    ...(file.path ? { path: file.path } : {}),
    ...(file.text ? { text: file.text } : {}),
  }
}

export function describeWorkspaceAttachments(files: AgentAttachment[]) {
  if (files.length === 0) return ''
  const lines = files.map((file, index) => {
    const location = file.path ? `本地路径 ${file.path}` : '已上传，请按附件读取'
    return `${index + 1}. ${file.name}（${file.kind}，${location}）`
  })
  return `已上传参考文件（请用 Read 打开这些本地路径，不要只看文件名）：\n${lines.join('\n')}`
}

export function withAttachmentPrompt(prompt: string, files?: AgentAttachment[]) {
  const described = describeWorkspaceAttachments(files ?? [])
  if (!described) return prompt
  return [prompt.trim(), described].filter(Boolean).join('\n\n')
}

function draftHasWork(draft: WorkspaceDraft) {
  return Boolean(
    draft.prompt.trim()
    || draft.skill
    || (draft.attachments?.length ?? 0) > 0,
  )
}

export function queueWorkspaceDraft(draft: WorkspaceDraft) {
  const stored: WorkspaceDraft = {
    prompt: draft.prompt,
    skill: draft.skill,
    attachments: draft.attachments?.map(serializeWorkspaceAttachment),
  }
  sessionStorage.setItem(WORKSPACE_DRAFT_KEY, JSON.stringify(stored))
  sessionStorage.setItem(WORKSPACE_PROMPT_KEY, draft.prompt)
  if (draft.skill) {
    sessionStorage.setItem(WORKSPACE_SKILL_KEY, draft.skill)
  } else {
    sessionStorage.removeItem(WORKSPACE_SKILL_KEY)
  }
  sessionStorage.setItem('design-studio-create-fresh-draft', '1')
  sessionStorage.setItem(
    'design-studio-editor-mode',
    draft.skill === 'code-from-figma' ? 'code' : 'figma',
  )
}

/** 首页每次点进来都生成一份全新文件。跨标签用 localStorage 交接，因为 sessionStorage 不能带到新标签页。 */
export function beginNewWorkspaceFile(draft: WorkspaceDraft): WorkspaceFile {
  const file = {
    fileId: createWorkspaceFileId(),
    fileName: untitledFileName(),
  }
  const bootstrap: WorkspaceBootstrap = {
    prompt: draft.prompt,
    skill: draft.skill,
    attachments: draft.attachments?.map(serializeWorkspaceAttachment),
    fileName: file.fileName,
    createdAt: Date.now(),
  }
  localStorage.setItem(`${WORKSPACE_BOOTSTRAP_PREFIX}${file.fileId}`, JSON.stringify(bootstrap))
  return file
}

export function beginCodeWorkspaceFile() {
  return beginNewWorkspaceFile({
    skill: 'code-from-figma',
    prompt: '',
  })
}

function applyWorkspaceSession(file: WorkspaceFile, draft?: WorkspaceDraft) {
  if (draft && draftHasWork(draft)) queueWorkspaceDraft(draft)
  sessionStorage.setItem(WORKSPACE_FILE_ID_KEY, file.fileId)
  sessionStorage.setItem(WORKSPACE_FILE_NAME_KEY, file.fileName)
  clearQueuedFigmaImport()
}

/** 新标签页打开后，把这份文件的草稿写进当前标签的 sessionStorage。 */
export function hydrateWorkspaceFile(fileId: string): WorkspaceFile {
  const existing = readWorkspaceFile()
  if (existing?.fileId === fileId) return existing

  const raw = localStorage.getItem(`${WORKSPACE_BOOTSTRAP_PREFIX}${fileId}`)
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as WorkspaceBootstrap
      const file = {
        fileId,
        fileName: parsed.fileName || '未命名设计稿',
      }
      applyWorkspaceSession(file, {
        prompt: typeof parsed.prompt === 'string' ? parsed.prompt : '',
        skill: parsed.skill,
        attachments: parsed.attachments,
      })
      localStorage.removeItem(`${WORKSPACE_BOOTSTRAP_PREFIX}${fileId}`)
      return file
    } catch {
      localStorage.removeItem(`${WORKSPACE_BOOTSTRAP_PREFIX}${fileId}`)
    }
  }

  const file = { fileId, fileName: '未命名设计稿' }
  applyWorkspaceSession(file)
  return file
}

export function readWorkspaceFile(): WorkspaceFile | null {
  const fileId = sessionStorage.getItem(WORKSPACE_FILE_ID_KEY)?.trim()
  const fileName = sessionStorage.getItem(WORKSPACE_FILE_NAME_KEY)?.trim()
  if (!fileId) return null
  return {
    fileId,
    fileName: fileName || '未命名设计稿',
  }
}

export function readQueuedWorkspaceDraft(): WorkspaceDraft | null {
  const serialized = sessionStorage.getItem(WORKSPACE_DRAFT_KEY)
  if (serialized) {
    try {
      const parsed = JSON.parse(serialized) as WorkspaceDraft
      if (typeof parsed?.prompt !== 'string') parsed.prompt = ''
      if (parsed.prompt.trim() || parsed.skill || (parsed.attachments?.length ?? 0) > 0) {
        return {
          prompt: parsed.prompt,
          skill: parsed.skill,
          attachments: parsed.attachments?.map(serializeWorkspaceAttachment),
        }
      }
    } catch {
      // Fall back to the legacy prompt/skill keys below.
    }
  }

  const prompt = sessionStorage.getItem(WORKSPACE_PROMPT_KEY)?.trim()
  if (!prompt) return null

  const skill = sessionStorage.getItem(WORKSPACE_SKILL_KEY)?.trim() || undefined
  return { prompt, skill }
}

export function clearQueuedWorkspaceDraft() {
  sessionStorage.removeItem(WORKSPACE_DRAFT_KEY)
  sessionStorage.removeItem(WORKSPACE_PROMPT_KEY)
  sessionStorage.removeItem(WORKSPACE_SKILL_KEY)
}

/**
 * Keeps the selected Figma file across the top-level OAuth redirect. Figma
 * authorization cannot run in an iframe/webview, so sessionStorage is the
 * hand-off between the homepage and the editor after the browser returns.
 */
export function queueFigmaImport(input: QueuedFigmaImport) {
  const url = input.url.trim()
  if (!url) return

  clearQueuedWorkspaceDraft()
  sessionStorage.removeItem('design-studio-create-fresh-draft')
  sessionStorage.removeItem(WORKSPACE_FILE_ID_KEY)
  sessionStorage.removeItem(WORKSPACE_FILE_NAME_KEY)
  sessionStorage.setItem('design-studio-editor-mode', 'figma')
  sessionStorage.setItem(
    WORKSPACE_FIGMA_IMPORT_KEY,
    JSON.stringify({
      url,
      title: input.title?.trim() || undefined,
    } satisfies QueuedFigmaImport),
  )
}

export function readQueuedFigmaImport(): QueuedFigmaImport | null {
  const serialized = sessionStorage.getItem(WORKSPACE_FIGMA_IMPORT_KEY)
  if (!serialized) return null

  try {
    const value = JSON.parse(serialized) as Partial<QueuedFigmaImport>
    const url = typeof value.url === 'string' ? value.url.trim() : ''
    if (!url) return null
    const title = typeof value.title === 'string' && value.title.trim()
      ? value.title.trim()
      : undefined
    return { url, title }
  } catch {
    return null
  }
}

export function clearQueuedFigmaImport() {
  sessionStorage.removeItem(WORKSPACE_FIGMA_IMPORT_KEY)
}
