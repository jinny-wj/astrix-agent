import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { saveUploadedFiles } from './agent/composer.ts'
import {
  buildWebpageCapturePrompt,
  extractWebpageBrief,
  isBlockedCaptureHost,
} from './webCapture.ts'

const CAPTURE_PATH = '/api/web-capture'
const MAX_HTML_BYTES = 800_000
const MAX_IMAGE_BYTES = 2 * 1024 * 1024
const FETCH_TIMEOUT_MS = 8_000

class RequestError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function isAllowedOrigin(origin: string | undefined) {
  if (!origin || origin === 'null') return true
  if (origin === 'http://127.0.0.1:5273') return true
  if (origin === 'http://localhost:5273') return true
  return origin.startsWith('chrome-extension://')
}

function setCorsHeaders(request: IncomingMessage, response: ServerResponse) {
  const origin = request.headers.origin
  if (origin && isAllowedOrigin(origin)) {
    response.setHeader('Access-Control-Allow-Origin', origin)
    response.setHeader('Vary', 'Origin')
  } else if (!origin) {
    response.setHeader('Access-Control-Allow-Origin', '*')
  }
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

function sendJson(
  request: IncomingMessage,
  response: ServerResponse,
  status: number,
  body: unknown,
) {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  setCorsHeaders(request, response)
  response.end(JSON.stringify(body))
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 8_000) {
        reject(new RequestError(413, '请求体过大。'))
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}

function parsePublicHttpUrl(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new RequestError(400, '请提供要捕获的网页链接。')
  }
  const withProtocol = /^https?:\/\//i.test(value.trim()) ? value.trim() : `https://${value.trim()}`
  let url: URL
  try {
    url = new URL(withProtocol)
  } catch {
    throw new RequestError(400, '链接格式无效。')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new RequestError(400, '只支持 http / https 网页。')
  }
  if (isBlockedCaptureHost(url.hostname)) {
    throw new RequestError(400, '不能捕获本机或内网地址。')
  }
  return url
}

function guessImageName(imageUrl: string, mime: string) {
  const fromUrl = imageUrl.split('/').pop()?.split('?')[0]?.trim()
  if (fromUrl && /\.(png|jpe?g|gif|webp|svg)$/i.test(fromUrl)) return fromUrl.slice(0, 80)
  if (mime.includes('jpeg')) return 'og-image.jpg'
  if (mime.includes('webp')) return 'og-image.webp'
  if (mime.includes('gif')) return 'og-image.gif'
  return 'og-image.png'
}

async function fetchText(url: URL) {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
      'User-Agent': 'DesignStudioWJ/0.1 (web-capture; static HTML extract)',
    },
  })
  const finalUrl = new URL(response.url)
  if (isBlockedCaptureHost(finalUrl.hostname)) {
    throw new RequestError(400, '不能捕获本机或内网地址。')
  }
  if (!response.ok) {
    throw new RequestError(502, `网页读取失败（${response.status}）。`)
  }
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType && !/html|xml|text\//i.test(contentType)) {
    throw new RequestError(422, '该链接不是可解析的 HTML 页面。')
  }
  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.length > MAX_HTML_BYTES) {
    return {
      html: buffer.subarray(0, MAX_HTML_BYTES).toString('utf8'),
      url: finalUrl.toString(),
    }
  }
  return {
    html: buffer.toString('utf8'),
    url: finalUrl.toString(),
  }
}

async function fetchOgImage(imageUrl: string, cwd: string) {
  let url: URL
  try {
    url = new URL(imageUrl)
  } catch {
    return undefined
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || isBlockedCaptureHost(url.hostname)) {
    return undefined
  }
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        Accept: 'image/*,*/*;q=0.8',
        'User-Agent': 'DesignStudioWJ/0.1 (web-capture; static HTML extract)',
      },
    })
    const finalUrl = new URL(response.url)
    if (!response.ok || isBlockedCaptureHost(finalUrl.hostname)) return undefined
    const mime = response.headers.get('content-type')?.split(';')[0]?.trim() || 'image/png'
    if (!mime.startsWith('image/')) return undefined
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length === 0 || buffer.length > MAX_IMAGE_BYTES) return undefined
    const [saved] = await saveUploadedFiles(cwd, [{
      name: guessImageName(finalUrl.toString(), mime),
      mime,
      contentBase64: buffer.toString('base64'),
    }])
    return saved
  } catch {
    return undefined
  }
}

export function createWebCaptureMiddleware(cwd = process.cwd()) {
  return (
    request: IncomingMessage,
    response: ServerResponse,
    next: () => void,
  ) => {
    const host = request.headers.host ?? '127.0.0.1'
    const requestUrl = new URL(request.url ?? '/', `http://${host}`)
    if (requestUrl.pathname !== CAPTURE_PATH) {
      next()
      return
    }

    if (!isAllowedOrigin(request.headers.origin)) {
      sendJson(request, response, 403, { ok: false, error: '不允许的请求来源。' })
      return
    }

    if (request.method === 'OPTIONS') {
      sendJson(request, response, 204, {})
      return
    }

    if (request.method !== 'POST') {
      sendJson(request, response, 405, { ok: false, error: '只支持 POST。' })
      return
    }

    void (async () => {
      const raw = await readBody(request)
      let payload: { url?: unknown } = {}
      try {
        payload = raw ? JSON.parse(raw) as { url?: unknown } : {}
      } catch {
        throw new RequestError(400, '请求体必须是 JSON。')
      }
      const target = parsePublicHttpUrl(payload.url)
      const fetched = await fetchText(target)
      const brief = extractWebpageBrief(fetched.html, fetched.url)
      const image = brief.imageUrl ? await fetchOgImage(brief.imageUrl, cwd) : undefined
      sendJson(request, response, 200, {
        ok: true,
        url: brief.url,
        title: brief.title,
        description: brief.description,
        headings: brief.headings,
        image: image ?? null,
        prompt: buildWebpageCapturePrompt(brief, image),
        note: '这是静态 HTML 摘要，不是整页截图，也没有还原 DOM 结构。',
      })
    })().catch((error: unknown) => {
      const status = error instanceof RequestError ? error.status : 502
      const message = error instanceof Error ? error.message : '网页捕获失败。'
      sendJson(request, response, status, { ok: false, error: message })
    })
  }
}

export function webCapturePlugin(cwd = process.cwd()): Plugin {
  const middleware = createWebCaptureMiddleware(cwd)
  return {
    name: 'design-studio-web-capture',
    configureServer(server) {
      server.middlewares.use(middleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware)
    },
  }
}
