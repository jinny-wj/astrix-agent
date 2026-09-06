import type {
  AgentAttachment,
  AgentInstruction,
} from '../types/agentComposer'

const INSTRUCTION_KEY = 'design-studio:agent-instructions'
const INSTRUCTION_ACTIVE_KEY = 'design-studio:agent-instruction-active'
const BACKEND_KEY = 'design-studio:agent-backend'

export const INSTRUCTION_PRESETS: AgentInstruction[] = [
  {
    id: 'layer-only',
    title: '只改当前图层',
    body: '只针对当前对准的图层给方案或修改，不要扩散到整页或其他文件。',
    preset: true,
  },
  {
    id: 'zh-brief',
    title: '用中文回复',
    body: '全程使用简洁中文，先结论后步骤。',
    preset: true,
  },
  {
    id: 'no-repo',
    title: '不要改仓库',
    body: '不要修改仓库文件，不要安装依赖，不要泄露内部 URL 或 token。',
    preset: true,
  },
]

const EMOJIS = [
  '😀', '😁', '😂', '🥲', '😊', '😍', '🤔', '😎',
  '👍', '👎', '🙏', '🔥', '✨', '🎉', '✅', '❌',
  '💡', '📎', '🖼️', '🎯', '📝', '⚡', '❤️', '⭐',
]

export function emojiPalette() {
  return EMOJIS
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function readSavedInstructions(): AgentInstruction[] {
  const custom = readJson<AgentInstruction[]>(INSTRUCTION_KEY, [])
    .filter((item) => item && typeof item.id === 'string' && item.body?.trim())
    .map((item) => ({
      id: item.id,
      title: item.title?.trim() || '自定义指令',
      body: item.body.trim(),
      preset: false,
    }))
  const customIds = new Set(custom.map((item) => item.id))
  return [
    ...INSTRUCTION_PRESETS.filter((item) => !customIds.has(item.id)),
    ...custom,
  ]
}

export function writeSavedInstructions(items: AgentInstruction[]) {
  const custom = items.filter((item) => !item.preset)
  localStorage.setItem(INSTRUCTION_KEY, JSON.stringify(custom))
}

export function readActiveInstructionIds(): string[] {
  const saved = readJson<string[]>(INSTRUCTION_ACTIVE_KEY, ['layer-only', 'zh-brief'])
  return Array.isArray(saved) ? saved.filter((id) => typeof id === 'string') : []
}

export function writeActiveInstructionIds(ids: string[]) {
  localStorage.setItem(INSTRUCTION_ACTIVE_KEY, JSON.stringify(ids))
}

export function readPreferredBackend() {
  try {
    const value = sessionStorage.getItem(BACKEND_KEY)
    if (value === 'codex' || value === 'claude' || value === 'hermes' || value === 'shell') {
      return value
    }
  } catch {
    // ignore
  }
  return undefined
}

export function writePreferredBackend(id: string | undefined) {
  try {
    if (!id) sessionStorage.removeItem(BACKEND_KEY)
    else sessionStorage.setItem(BACKEND_KEY, id)
  } catch {
    // ignore
  }
}

export function makeId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

export async function readLocalFiles(fileList: FileList | File[]): Promise<AgentAttachment[]> {
  const files = [...fileList].slice(0, 8)
  const attachments: AgentAttachment[] = []
  for (const file of files) {
    const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined
    const text = await readTextIfPossible(file)
    attachments.push({
      id: makeId('local'),
      name: file.name,
      mime: file.type || 'application/octet-stream',
      size: file.size,
      kind: file.type.startsWith('image/')
        ? 'image'
        : text !== undefined
          ? 'text'
          : 'binary',
      text,
      previewUrl,
    })
  }
  return attachments
}

async function readTextIfPossible(file: File) {
  if (file.size > 60_000) return undefined
  if (file.type.startsWith('image/')) return undefined
  const looksText = file.type.startsWith('text/')
    || file.type === 'application/json'
    || /\.(txt|md|json|csv|svg|html|css|js|ts)$/i.test(file.name)
  if (!looksText) return undefined
  try {
    return (await file.text()).slice(0, 60_000)
  } catch {
    return undefined
  }
}

export function filesToUploadPayload(files: FileList | File[]) {
  return Promise.all([...files].slice(0, 8).map((file) => readAsBase64(file)))
}

function readAsBase64(file: File) {
  return new Promise<{ name: string; mime: string; contentBase64: string }>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = String(reader.result ?? '')
      const comma = dataUrl.indexOf(',')
      resolve({
        name: file.name,
        mime: file.type || 'application/octet-stream',
        contentBase64: comma >= 0 ? dataUrl.slice(comma + 1) : '',
      })
    }
    reader.onerror = () => reject(reader.error ?? new Error('读取文件失败'))
    reader.readAsDataURL(file)
  })
}

export function revokeAttachmentPreview(item: AgentAttachment) {
  if (item.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(item.previewUrl)
}
