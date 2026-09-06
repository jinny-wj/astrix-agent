import { FIGMA_WORKSPACE_MESSAGE_SOURCE } from '../config/figma'

const EXTENSION_MESSAGE_SOURCE = 'design-studio-extension'
const RECENT_FILES_REQUEST = 'REQUEST_RECENT_FIGMA_FILES'
const RECENT_FILES_RESPONSE = 'RECENT_FIGMA_FILES'
const DEFAULT_EXTENSION_TIMEOUT_MS = 1600
const SAFE_FILE_KEY = /^[A-Za-z0-9_-]{6,256}$/
const LOCAL_RECENT_FILES_KEY = 'design-studio:recent-figma-files'
const LOCAL_RECENTS_API = '/api/local/figma-recents'
const MAX_RECENT_FILES = 20

export type CapturedRecentFigmaFile = {
  key: string
  url: string
  title: string
  lastOpenedAt: string
}

export type FigmaRecentFileMetadata = {
  key: string
  name?: string
  thumbnailUrl?: string
  lastModified?: string
}

export type RecentFigmaFilesResult =
  | {
      status: 'available'
      files: CapturedRecentFigmaFile[]
      source: 'extension' | 'local'
    }
  | { status: 'unavailable'; files: [] }

type RecordLike = Record<string, unknown>

function isRecord(value: unknown): value is RecordLike {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeTimestamp(value: unknown): string {
  let timestamp: number

  if (typeof value === 'number') {
    timestamp = value
  } else if (typeof value === 'string' && value.trim()) {
    const trimmed = value.trim()
    timestamp = /^\d+$/.test(trimmed) ? Number(trimmed) : Date.parse(trimmed)
  } else {
    return ''
  }

  if (!Number.isFinite(timestamp)) return ''
  const normalized = new Date(timestamp)
  return Number.isNaN(normalized.getTime()) ? '' : normalized.toISOString()
}

/**
 * Accepts only top-level Figma Design links. The returned URL keeps node-id and
 * other harmless Figma query parameters so a captured selection still opens at
 * the same location.
 */
export function parseFigmaDesignUrl(value: string): { key: string; url: string } {
  const input = value.trim()
  if (!input) throw new Error('请输入 Figma Design 文件链接。')

  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new Error('链接格式无效，请粘贴完整的 Figma Design 链接。')
  }

  const hostname = url.hostname.toLowerCase()
  if (
    url.protocol !== 'https:'
    || (hostname !== 'figma.com' && hostname !== 'www.figma.com')
  ) {
    throw new Error('请输入 https://www.figma.com/design/... 链接。')
  }

  const segments = url.pathname.split('/').filter(Boolean)
  if (segments[0]?.toLowerCase() !== 'design' || !segments[1]) {
    throw new Error('当前仅支持 Figma Design 文件链接。')
  }

  let key: string
  try {
    key = decodeURIComponent(segments[1])
  } catch {
    throw new Error('Figma 文件链接包含无效编码。')
  }

  if (!SAFE_FILE_KEY.test(key)) {
    throw new Error('Figma 文件 Key 无效。')
  }

  url.hostname = 'www.figma.com'
  return { key, url: url.toString() }
}

function normalizeCapturedFile(value: unknown): CapturedRecentFigmaFile | null {
  if (!isRecord(value) || typeof value.url !== 'string') return null

  let parsed: { key: string; url: string }
  try {
    parsed = parseFigmaDesignUrl(value.url)
  } catch {
    return null
  }

  const suppliedKey =
    typeof value.key === 'string' && SAFE_FILE_KEY.test(value.key)
      ? value.key
      : parsed.key
  if (suppliedKey !== parsed.key) return null

  return {
    key: parsed.key,
    url: parsed.url,
    title:
      typeof value.title === 'string' && value.title.trim()
        ? value.title.trim()
        : '未命名设计稿',
    lastOpenedAt: normalizeTimestamp(value.lastOpenedAt),
  }
}

function normalizeCapturedFiles(value: unknown): CapturedRecentFigmaFile[] {
  if (!Array.isArray(value)) return []

  const byKey = new Map<string, CapturedRecentFigmaFile>()
  for (const item of value) {
    const file = normalizeCapturedFile(item)
    if (!file) continue

    const previous = byKey.get(file.key)
    if (
      !previous
      || Date.parse(file.lastOpenedAt || '1970-01-01')
        > Date.parse(previous.lastOpenedAt || '1970-01-01')
    ) {
      byKey.set(file.key, file)
    }
  }

  return [...byKey.values()]
    .sort(
      (left, right) =>
        Date.parse(right.lastOpenedAt || '1970-01-01')
        - Date.parse(left.lastOpenedAt || '1970-01-01'),
    )
    .slice(0, MAX_RECENT_FILES)
}

function readLocalRecentFigmaFiles(): CapturedRecentFigmaFile[] {
  if (typeof window === 'undefined') return []

  try {
    const serialized = window.localStorage.getItem(LOCAL_RECENT_FILES_KEY)
    return serialized ? normalizeCapturedFiles(JSON.parse(serialized)) : []
  } catch {
    return []
  }
}

function writeLocalRecentFigmaFiles(files: CapturedRecentFigmaFile[]) {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(
      LOCAL_RECENT_FILES_KEY,
      JSON.stringify(normalizeCapturedFiles(files)),
    )
  } catch {
    // Local history is a convenience fallback; opening Figma must still work.
  }
}

export function rememberRecentFigmaFile(url: string, title?: string) {
  const parsed = parseFigmaDesignUrl(url)
  const current = readLocalRecentFigmaFiles()
  const previous = current.find((file) => file.key === parsed.key)

  writeLocalRecentFigmaFiles([
    {
      key: parsed.key,
      url: parsed.url,
      title: title?.trim() || previous?.title || '未命名设计稿',
      lastOpenedAt: new Date().toISOString(),
    },
    ...current.filter((file) => file.key !== parsed.key),
  ])

  void fetch(LOCAL_RECENTS_API, {
    method: 'POST',
    credentials: 'same-origin',
    keepalive: true,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url: parsed.url,
      title: title?.trim() || previous?.title || '未命名设计稿',
    }),
  }).catch(() => {
    // The synchronous browser fallback above is enough to keep opening usable.
  })

  return parsed
}

async function requestPersistedRecentFigmaFiles() {
  try {
    const response = await fetch(LOCAL_RECENTS_API, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) return []
    const body = await response.json() as { files?: unknown }
    return normalizeCapturedFiles(body.files)
  } catch {
    return []
  }
}

function requestExtensionRecentFigmaFiles(
  timeoutMs = DEFAULT_EXTENSION_TIMEOUT_MS,
): Promise<{ connected: boolean; files: CapturedRecentFigmaFile[] }> {
  if (typeof window === 'undefined') {
    return Promise.resolve({ connected: false, files: [] })
  }

  return new Promise((resolve) => {
    let settled = false

    const finish = (result: {
      connected: boolean
      files: CapturedRecentFigmaFile[]
    }) => {
      if (settled) return
      settled = true
      window.clearTimeout(timeoutId)
      window.removeEventListener('message', onMessage)
      resolve(result)
    }

    const onMessage = (event: MessageEvent<unknown>) => {
      if (event.source !== window || event.origin !== window.location.origin) return
      if (!isRecord(event.data)) return
      if (
        event.data.source !== EXTENSION_MESSAGE_SOURCE
        || event.data.type !== RECENT_FILES_RESPONSE
      ) {
        return
      }

      const payload = isRecord(event.data.payload) ? event.data.payload : {}
      const files =
        payload.files
        ?? (Array.isArray(event.data.files) ? event.data.files : undefined)
      finish({
        connected: true,
        files: normalizeCapturedFiles(files),
      })
    }

    const timeoutId = window.setTimeout(
      () => finish({ connected: false, files: [] }),
      Math.max(250, timeoutMs),
    )

    window.addEventListener('message', onMessage)
    window.postMessage(
      {
        source: FIGMA_WORKSPACE_MESSAGE_SOURCE,
        type: RECENT_FILES_REQUEST,
      },
      window.location.origin,
    )
  })
}

export async function requestRecentFigmaFiles(
  timeoutMs = DEFAULT_EXTENSION_TIMEOUT_MS,
): Promise<RecentFigmaFilesResult> {
  if (typeof window === 'undefined') {
    return { status: 'unavailable', files: [] }
  }

  const localFiles = readLocalRecentFigmaFiles()
  const [extension, persistedFiles] = await Promise.all([
    requestExtensionRecentFigmaFiles(timeoutMs),
    requestPersistedRecentFigmaFiles(),
  ])
  const mergedFiles = normalizeCapturedFiles([
    ...extension.files,
    ...persistedFiles,
    ...localFiles,
  ])

  if (mergedFiles.length > 0) {
    writeLocalRecentFigmaFiles(mergedFiles)
    return {
      status: 'available',
      files: mergedFiles,
      source: extension.connected ? 'extension' : 'local',
    }
  }

  return extension.connected
    ? { status: 'available', files: [], source: 'extension' }
    : { status: 'unavailable', files: [] }
}

function metadataValues(value: unknown): Array<[string | undefined, unknown]> {
  const container = isRecord(value) && 'files' in value ? value.files : value
  if (Array.isArray(container)) return container.map((item) => [undefined, item])
  if (!isRecord(container)) return []
  return Object.entries(container)
}

function normalizeMetadata(value: unknown): FigmaRecentFileMetadata[] {
  return metadataValues(value).flatMap(([fallbackKey, item]) => {
    if (!isRecord(item)) return []

    const key =
      typeof item.key === 'string'
        ? item.key
        : typeof fallbackKey === 'string'
          ? fallbackKey
          : ''
    if (!SAFE_FILE_KEY.test(key)) return []

    const name =
      typeof item.name === 'string'
        ? item.name
        : typeof item.title === 'string'
          ? item.title
          : undefined
    const thumbnailUrl =
      typeof item.thumbnailUrl === 'string'
        ? item.thumbnailUrl
        : typeof item.thumbnail_url === 'string'
          ? item.thumbnail_url
          : undefined
    const lastModified = normalizeTimestamp(
      item.lastModified ?? item.last_modified,
    )

    return [{
      key,
      name: name?.trim() || undefined,
      thumbnailUrl: thumbnailUrl?.trim() || undefined,
      lastModified: lastModified || undefined,
    }]
  })
}

export async function getRecentFigmaFileMetadata(
  keys: string[],
): Promise<FigmaRecentFileMetadata[]> {
  const normalizedKeys = [...new Set(keys.filter((key) => SAFE_FILE_KEY.test(key)))]
    .slice(0, 50)
  if (normalizedKeys.length === 0) return []

  const query = new URLSearchParams({ keys: normalizedKeys.join(',') })
  const response = await fetch(
    `/api/auth/figma/file-metadata?${query.toString()}`,
    {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    },
  )

  if (!response.ok) {
    throw new Error(`读取 Figma 文件信息失败（HTTP ${response.status}）。`)
  }

  return normalizeMetadata(await response.json())
}
