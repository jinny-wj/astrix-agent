import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { resolveDesignStudioDataPath } from './storage'

const API_PATH = '/api/local/figma-recents'
const MAX_FILES = 20
const MAX_BODY_BYTES = 32 * 1024
const SAFE_FILE_KEY = /^[A-Za-z0-9_-]{6,256}$/
type RecentFigmaFile = {
  key: string
  url: string
  title: string
  lastOpenedAt: string
}

function sendJson(response: ServerResponse, status: number, value: unknown) {
  response.statusCode = status
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.end(JSON.stringify(value))
}

function parseFigmaDesignUrl(value: unknown) {
  if (typeof value !== 'string') throw new Error('INVALID_URL')

  const url = new URL(value.trim())
  const hostname = url.hostname.toLowerCase()
  const segments = url.pathname.split('/').filter(Boolean)
  const key = segments[0]?.toLowerCase() === 'design' ? segments[1] : ''

  if (
    url.protocol !== 'https:'
    || (hostname !== 'figma.com' && hostname !== 'www.figma.com')
    || !key
    || !SAFE_FILE_KEY.test(key)
  ) {
    throw new Error('INVALID_URL')
  }

  url.hostname = 'www.figma.com'
  return { key, url: url.toString() }
}

function normalizeFile(value: unknown): RecentFigmaFile | null {
  if (!value || typeof value !== 'object') return null

  const record = value as Partial<RecentFigmaFile>
  try {
    const parsed = parseFigmaDesignUrl(record.url)
    const timestamp = Date.parse(record.lastOpenedAt ?? '')
    return {
      key: parsed.key,
      url: parsed.url,
      title:
        typeof record.title === 'string' && record.title.trim()
          ? record.title.trim().slice(0, 160)
          : '未命名设计稿',
      lastOpenedAt: Number.isFinite(timestamp)
        ? new Date(timestamp).toISOString()
        : new Date(0).toISOString(),
    }
  } catch {
    return null
  }
}

function normalizeFiles(value: unknown): RecentFigmaFile[] {
  if (!Array.isArray(value)) return []

  const filesByKey = new Map<string, RecentFigmaFile>()
  for (const item of value) {
    const file = normalizeFile(item)
    if (!file) continue
    const previous = filesByKey.get(file.key)
    if (
      !previous
      || Date.parse(file.lastOpenedAt) > Date.parse(previous.lastOpenedAt)
    ) {
      filesByKey.set(file.key, file)
    }
  }

  return [...filesByKey.values()]
    .sort(
      (left, right) =>
        Date.parse(right.lastOpenedAt) - Date.parse(left.lastOpenedAt),
    )
    .slice(0, MAX_FILES)
}

async function loadFiles() {
  try {
    const storagePath = resolveDesignStudioDataPath('figma-recents.json')
    return normalizeFiles(JSON.parse(await readFile(storagePath, 'utf8')))
  } catch {
    return []
  }
}

async function saveFiles(files: RecentFigmaFile[]) {
  const storagePath = resolveDesignStudioDataPath('figma-recents.json')
  await mkdir(dirname(storagePath), { recursive: true })
  await writeFile(storagePath, `${JSON.stringify(files, null, 2)}\n`, {
    mode: 0o600,
  })
}

function readJsonBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0

    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('BODY_TOO_LARGE'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new Error('INVALID_JSON'))
      }
    })
    request.on('error', reject)
  })
}

export function createFigmaRecentsMiddleware() {
  let updateQueue = Promise.resolve()

  return (
    request: IncomingMessage,
    response: ServerResponse,
    next: () => void,
  ) => {
    if (!request.url) {
      next()
      return
    }

    const requestUrl = new URL(request.url, 'http://design-studio.local')
    if (requestUrl.pathname !== API_PATH) {
      next()
      return
    }

    if (request.method === 'GET') {
      void loadFiles()
        .then((files) => sendJson(response, 200, { files }))
        .catch(() =>
          sendJson(response, 500, {
            error: 'RECENT_FILES_READ_FAILED',
            message: '暂时无法读取最近 Figma 文件。',
          }),
        )
      return
    }

    if (request.method === 'POST') {
      void readJsonBody(request)
        .then((body) => {
          const record =
            body && typeof body === 'object'
              ? (body as { url?: unknown; title?: unknown })
              : {}
          const parsed = parseFigmaDesignUrl(record.url)
          const title =
            typeof record.title === 'string' && record.title.trim()
              ? record.title.trim().slice(0, 160)
              : '未命名设计稿'

          updateQueue = updateQueue.then(async () => {
            const current = await loadFiles()
            const nextFiles = normalizeFiles([
              {
                key: parsed.key,
                url: parsed.url,
                title,
                lastOpenedAt: new Date().toISOString(),
              },
              ...current.filter((file) => file.key !== parsed.key),
            ])
            await saveFiles(nextFiles)
          })

          return updateQueue.then(() => {
            response.statusCode = 204
            response.setHeader('Cache-Control', 'no-store')
            response.end()
          })
        })
        .catch((error: unknown) => {
          const code = error instanceof Error ? error.message : ''
          sendJson(
            response,
            code === 'INVALID_URL' || code === 'INVALID_JSON' ? 400 : 500,
            {
              error:
                code === 'INVALID_URL'
                  ? 'INVALID_FIGMA_URL'
                  : code === 'INVALID_JSON'
                    ? 'INVALID_JSON'
                    : 'RECENT_FILES_WRITE_FAILED',
              message:
                code === 'INVALID_URL'
                  ? '请输入有效的 Figma Design 文件链接。'
                  : '暂时无法保存最近 Figma 文件。',
            },
          )
        })
      return
    }

    response.statusCode = 405
    response.setHeader('Allow', 'GET, POST')
    response.end()
  }
}

export function figmaRecentsPlugin(): Plugin {
  const middleware = createFigmaRecentsMiddleware()

  return {
    name: 'design-studio-figma-recents',
    configureServer(server) {
      server.middlewares.use(middleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware)
    },
  }
}
