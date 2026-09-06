import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import type {
  AgentAttachment,
  AgentAttachmentKind,
  AgentBackendKind,
  AgentContextItem,
  AgentInstruction,
} from '../../src/types/agentComposer'

export const MAX_ATTACHMENTS = 8
export const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024
export const MAX_TEXT_CHARS = 60_000

const TEXT_MIME = /^(text\/|application\/(json|xml|javascript|sql))/i
const TEXT_EXT = /\.(txt|md|markdown|json|csv|tsv|xml|svg|html|css|js|ts|tsx|jsx|yml|yaml|log)$/i
const IMAGE_MIME = /^image\//i
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg)$/i

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function attachmentsDir(cwd: string) {
  return join(cwd, '.design-studio', 'attachments')
}

export function safeFileName(name: string) {
  const base = name.split(/[/\\]/).pop()?.trim() || 'file'
  return base.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80) || 'file'
}

export function inferAttachmentKind(name: string, mime: string): AgentAttachmentKind {
  if (IMAGE_MIME.test(mime) || IMAGE_EXT.test(name)) return 'image'
  if (TEXT_MIME.test(mime) || TEXT_EXT.test(name)) return 'text'
  return 'binary'
}

export function isPathInside(root: string, target: string) {
  const resolvedRoot = resolve(root) + sep
  const resolvedTarget = resolve(target)
  return resolvedTarget === resolve(root) || resolvedTarget.startsWith(resolvedRoot)
}

export function sanitizeInstruction(value: unknown): AgentInstruction | null {
  if (!isRecord(value) || typeof value.title !== 'string' || typeof value.body !== 'string') {
    return null
  }
  const title = value.title.trim().slice(0, 80)
  const body = value.body.trim().slice(0, 4_000)
  if (!title || !body) return null
  const id = typeof value.id === 'string' && value.id.trim()
    ? value.id.trim().slice(0, 80)
    : `ins-${title}`
  return { id, title, body, preset: value.preset === true }
}

export function sanitizeContextItem(value: unknown): AgentContextItem | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.label !== 'string') {
    return null
  }
  const kind = value.kind
  if (kind !== 'layer' && kind !== 'file' && kind !== 'skill' && kind !== 'conversation') {
    return null
  }
  return {
    id: value.id.slice(0, 200),
    kind,
    label: value.label.slice(0, 200),
    detail: typeof value.detail === 'string' ? value.detail.slice(0, 400) : undefined,
    nodeId: typeof value.nodeId === 'string' ? value.nodeId.slice(0, 200) : undefined,
    fileKey: typeof value.fileKey === 'string' ? value.fileKey.slice(0, 256) : undefined,
    skill: typeof value.skill === 'string' ? value.skill.slice(0, 80) : undefined,
  }
}

export function sanitizeAttachment(
  value: unknown,
  cwd: string,
): AgentAttachment | null {
  if (!isRecord(value) || typeof value.name !== 'string') return null
  const name = safeFileName(value.name)
  const mime = typeof value.mime === 'string' && value.mime
    ? value.mime.slice(0, 120)
    : 'application/octet-stream'
  const kind = inferAttachmentKind(name, mime)
  const size = typeof value.size === 'number' && Number.isFinite(value.size)
    ? Math.max(0, Math.round(value.size))
    : 0
  const id = typeof value.id === 'string' && value.id.trim()
    ? value.id.trim().slice(0, 80)
    : `att-${name}`
  let path: string | undefined
  if (typeof value.path === 'string' && value.path.trim()) {
    const resolved = resolve(cwd, value.path.trim())
    if (isPathInside(attachmentsDir(cwd), resolved) && existsSync(resolved)) {
      path = resolved
    }
  }
  const text = typeof value.text === 'string'
    ? value.text.slice(0, MAX_TEXT_CHARS)
    : undefined
  return { id, name, mime, size, kind, path, text }
}

export function sanitizeBackend(value: unknown): AgentBackendKind | undefined {
  return value === 'codex' || value === 'claude' || value === 'hermes' || value === 'shell'
    ? value
    : undefined
}

export async function saveUploadedFiles(
  cwd: string,
  files: Array<{ name?: unknown; mime?: unknown; contentBase64?: unknown }>,
): Promise<AgentAttachment[]> {
  const slice = files.slice(0, MAX_ATTACHMENTS)
  const dir = attachmentsDir(cwd)
  await mkdir(dir, { recursive: true })
  const saved: AgentAttachment[] = []
  for (const [index, file] of slice.entries()) {
    if (!isRecord(file) || typeof file.contentBase64 !== 'string') continue
    const name = safeFileName(typeof file.name === 'string' ? file.name : `file-${index}`)
    const mime = typeof file.mime === 'string' && file.mime
      ? file.mime.slice(0, 120)
      : 'application/octet-stream'
    let buffer: Buffer
    try {
      buffer = Buffer.from(file.contentBase64.replace(/\s+/g, ''), 'base64')
    } catch {
      continue
    }
    if (buffer.length === 0 || buffer.length > MAX_ATTACHMENT_BYTES) continue
    const id = `att-${Date.now().toString(36)}-${index}`
    const dest = join(dir, `${id}-${name}`)
    await writeFile(dest, buffer)
    const kind = inferAttachmentKind(name, mime)
    saved.push({
      id,
      name,
      mime,
      size: buffer.length,
      kind,
      path: dest,
      text: kind === 'text' ? buffer.toString('utf8').slice(0, MAX_TEXT_CHARS) : undefined,
    })
  }
  return saved
}

export function relativeAttachmentPath(cwd: string, filePath: string) {
  const root = resolve(cwd)
  const target = resolve(filePath)
  if (target === root) return '.'
  if (target.startsWith(root + sep)) return target.slice(root.length + 1)
  return target
}

export function composerPromptBlock(input: {
  instructions?: AgentInstruction[]
  contextRefs?: AgentContextItem[]
  attachments?: AgentAttachment[]
  cwd?: string
}) {
  const parts: string[] = []
  const instructions = input.instructions?.filter((item) => item.body.trim()) ?? []
  if (instructions.length > 0) {
    parts.push(
      `用户附加指令：\n${instructions.map((item, index) => `${index + 1}. ${item.title}：${item.body}`).join('\n')}`,
    )
  }

  const refs = input.contextRefs ?? []
  if (refs.length > 0) {
    parts.push(
      `引用上下文：\n${refs.map((item) => {
        const extra = [item.detail, item.nodeId, item.fileKey, item.skill]
          .filter(Boolean)
          .join('，')
        return `- [${item.kind}] ${item.label}${extra ? `（${extra}）` : ''}`
      }).join('\n')}`,
    )
  }

  const attachments = input.attachments ?? []
  if (attachments.length > 0) {
    const lines = attachments.map((item) => {
      const shownPath = item.path && input.cwd
        ? relativeAttachmentPath(input.cwd, item.path)
        : item.path
      if (item.kind === 'text' && item.text?.trim()) {
        return `- ${item.name}（${item.mime}）内容：\n${item.text.trim()}`
      }
      if (shownPath) {
        return `- ${item.name}（${item.mime}，本地路径 ${shownPath}）。请用 Read 查看该文件。`
      }
      return `- ${item.name}（${item.mime}，${item.kind}）`
    })
    parts.push(`用户上传的文件：\n${lines.join('\n')}`)
  }

  return parts.join('\n\n')
}

export function parseCodexMcpServers(toml: string) {
  const found = new Map<string, { id: string; command?: string }>()
  const heading = /\[(?:mcp_servers|mcp\.servers)\.([^\]]+)\]/g
  let match: RegExpExecArray | null
  while ((match = heading.exec(toml))) {
    const id = match[1].replace(/["']/g, '').trim()
    if (!id) continue
    const nextHeading = toml.indexOf('\n[', match.index + match[0].length)
    const block = toml.slice(
      match.index,
      nextHeading === -1 ? toml.length : nextHeading,
    )
    const command = block.match(/command\s*=\s*"([^"]+)"/)?.[1]
    found.set(id, { id, command })
  }
  return [...found.values()]
}

export function readCodexMcpServers() {
  const configPath = join(homedir(), '.codex', 'config.toml')
  if (!existsSync(configPath)) return []
  try {
    return parseCodexMcpServers(readFileSync(configPath, 'utf8'))
  } catch {
    return []
  }
}
