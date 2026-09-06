import {
  createReadStream,
  existsSync,
  readFileSync,
  statSync,
} from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { createAgentMiddleware } from '../server/agentPlugin'
import { createFigmaBridgeMiddleware } from '../server/figmaBridgePlugin'
import {
  createFigmaOAuthMiddleware,
  type FigmaOAuthPluginOptions,
} from '../server/figmaOAuthPlugin'
import { createFigmaRecentsMiddleware } from '../server/figmaRecentsPlugin'
import { createDesktopStatusMiddleware } from '../server/desktopStatusPlugin'
import { prepareAgentWorkspace } from './agentWorkspace.ts'
import { createWebCaptureMiddleware } from '../server/webCapturePlugin'

type Middleware = (
  request: IncomingMessage,
  response: ServerResponse,
  next: () => void,
) => void

export type DesktopServer = {
  origin: string
  close: () => Promise<void>
}

export type DesktopServerOptions = {
  appRoot: string
  dataDirectory: string
  agentResourcesDirectory?: string
  host?: string
  port?: number
}

const CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

function parseEnvironmentLine(line: string) {
  const normalizedLine = line.trim().replace(/^export\s+/, '')
  if (!normalizedLine || normalizedLine.startsWith('#')) return null
  const separatorIndex = normalizedLine.indexOf('=')
  if (separatorIndex <= 0) return null

  const key = normalizedLine.slice(0, separatorIndex).trim()
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return null
  let value = normalizedLine.slice(separatorIndex + 1).trim()
  if (
    value.length >= 2
    && ((value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'")))
  ) {
    value = value.slice(1, -1)
  }
  return { key, value }
}

function loadLocalEnvironment(appRoot: string) {
  for (const fileName of ['.env', '.env.local']) {
    const filePath = join(appRoot, fileName)
    if (!existsSync(filePath)) continue
    const contents = readFileSync(filePath, 'utf8')
    for (const line of contents.split(/\r?\n/)) {
      const entry = parseEnvironmentLine(line)
      if (entry && process.env[entry.key] === undefined) {
        process.env[entry.key] = entry.value
      }
    }
  }
}

function resolveAgentBackend(
  value: string | undefined,
): 'auto' | 'codex' | 'claude' | 'hermes' | 'shell' {
  const normalized = (value ?? 'auto').trim().toLowerCase()
  if (
    normalized === 'codex'
    || normalized === 'claude'
    || normalized === 'hermes'
    || normalized === 'shell'
    || normalized === 'auto'
  ) {
    return normalized
  }
  return 'auto'
}

function oauthOptions(): FigmaOAuthPluginOptions {
  return {
    clientId: process.env.FIGMA_OAUTH_CLIENT_ID?.trim() ?? '',
    clientSecret: process.env.FIGMA_OAUTH_CLIENT_SECRET?.trim() ?? '',
    redirectUri:
      process.env.FIGMA_OAUTH_REDIRECT_URI?.trim()
      || 'http://127.0.0.1:5273/api/auth/figma/callback',
    teamIds: (process.env.FIGMA_TEAM_IDS ?? '')
      .split(/[,\s]+/)
      .map((item) => item.trim())
      .filter(Boolean),
  }
}

function sendJson(response: ServerResponse, status: number, value: unknown) {
  response.statusCode = status
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.end(JSON.stringify(value))
}

function hostIsLocal(request: IncomingMessage, port: number) {
  const host = (request.headers.host ?? '').toLowerCase()
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`
}

function proxyFigmaApi(
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
) {
  const headers = { ...request.headers }
  const token = headers['x-design-studio-figma-token']
  delete headers['x-design-studio-figma-token']
  delete headers.host
  if (typeof token === 'string' && token) headers['x-figma-token'] = token

  const upstream = httpsRequest(
    {
      protocol: 'https:',
      hostname: 'api.figma.com',
      port: 443,
      method: request.method,
      path: `/v1${requestUrl.pathname.slice('/api/figma'.length)}${requestUrl.search}`,
      headers,
    },
    (upstreamResponse) => {
      response.statusCode = upstreamResponse.statusCode ?? 502
      for (const [name, value] of Object.entries(upstreamResponse.headers)) {
        if (value !== undefined && name.toLowerCase() !== 'transfer-encoding') {
          response.setHeader(name, value)
        }
      }
      upstreamResponse.pipe(response)
    },
  )

  upstream.on('error', (error) => {
    if (!response.headersSent) {
      sendJson(response, 502, {
        error: 'FIGMA_PROXY_UNAVAILABLE',
        message: error.message,
      })
    } else if (!response.writableEnded) {
      response.end()
    }
  })
  request.pipe(upstream)
}

function safeFilePath(root: string, relativePath: string) {
  const rootPath = resolve(root)
  const filePath = resolve(rootPath, normalize(relativePath).replace(/^[/\\]+/, ''))
  return filePath === rootPath || filePath.startsWith(`${rootPath}${sep}`)
    ? filePath
    : null
}

function serveFile(
  request: IncomingMessage,
  response: ServerResponse,
  filePath: string,
  immutable = true,
) {
  let stats
  try {
    stats = statSync(filePath)
  } catch {
    return false
  }
  if (!stats.isFile()) return false

  response.statusCode = 200
  response.setHeader('Content-Length', stats.size)
  response.setHeader(
    'Content-Type',
    CONTENT_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
  )
  response.setHeader(
    'Cache-Control',
    extname(filePath) === '.html' || !immutable
      ? 'no-cache'
      : 'public, max-age=31536000, immutable',
  )
  if (request.method === 'HEAD') response.end()
  else createReadStream(filePath).pipe(response)
  return true
}

function createStaticMiddleware(appRoot: string): Middleware {
  const distRoot = join(appRoot, 'dist')
  const agentRoot = join(appRoot, 'browser-extension')

  return (request, response, next) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      next()
      return
    }

    const requestUrl = new URL(request.url ?? '/', 'http://design-studio.local')
    if (requestUrl.pathname.startsWith('/desktop-agent/')) {
      const relativePath = decodeURIComponent(
        requestUrl.pathname.slice('/desktop-agent/'.length),
      ) || 'sidepanel.html'
      const filePath = safeFilePath(agentRoot, relativePath)
      if (filePath && serveFile(request, response, filePath, false)) return
      sendJson(response, 404, { error: 'AGENT_ASSET_NOT_FOUND' })
      return
    }

    const relativePath = decodeURIComponent(requestUrl.pathname).replace(/^\//, '')
    const requestedFile = relativePath
      ? safeFilePath(distRoot, relativePath)
      : safeFilePath(distRoot, 'index.html')
    if (requestedFile && serveFile(request, response, requestedFile)) return

    const acceptsHtml = (request.headers.accept ?? '').includes('text/html')
    if (!extname(requestUrl.pathname) && acceptsHtml) {
      const indexPath = safeFilePath(distRoot, 'index.html')
      if (indexPath && serveFile(request, response, indexPath)) return
    }
    next()
  }
}

function runMiddlewares(
  middlewares: Middleware[],
  request: IncomingMessage,
  response: ServerResponse,
) {
  let index = 0
  const next = () => {
    const middleware = middlewares[index]
    index += 1
    if (middleware) {
      middleware(request, response, next)
      return
    }
    if (!response.writableEnded) {
      const pathname = new URL(
        request.url ?? '/',
        'http://design-studio.local',
      ).pathname
      sendJson(
        response,
        pathname.startsWith('/api/') ? 404 : 404,
        { error: 'NOT_FOUND' },
      )
    }
  }
  next()
}

export async function startDesktopServer({
  appRoot,
  dataDirectory,
  agentResourcesDirectory = appRoot,
  host = '127.0.0.1',
  port = 5273,
}: DesktopServerOptions): Promise<DesktopServer> {
  loadLocalEnvironment(appRoot)
  process.env.DESIGN_STUDIO_DATA_DIR = dataDirectory
  const agentWorkspace = prepareAgentWorkspace(dataDirectory, agentResourcesDirectory)

  const middlewares: Middleware[] = [
    createDesktopStatusMiddleware(),
    createAgentMiddleware({
      backend: resolveAgentBackend(process.env.AGENT_BACKEND),
      model: process.env.AGENT_MODEL?.trim() || 'auto',
      allowDemoFallback: process.env.AGENT_ALLOW_DEMO_FALLBACK === '1',
      cwd: agentWorkspace,
    }),
    createFigmaBridgeMiddleware(),
    createWebCaptureMiddleware(agentWorkspace),
    createFigmaOAuthMiddleware(oauthOptions()),
    createFigmaRecentsMiddleware(),
    createStaticMiddleware(appRoot),
  ]

  let boundPort = port
  const server = createServer((request, response) => {
    if (!hostIsLocal(request, boundPort)) {
      sendJson(response, 403, { error: 'INVALID_HOST' })
      return
    }

    const requestUrl = new URL(request.url ?? '/', `http://${host}:${port}`)
    if (
      requestUrl.pathname === '/api/figma'
      || requestUrl.pathname.startsWith('/api/figma/')
    ) {
      proxyFigmaApi(request, response, requestUrl)
      return
    }
    runMiddlewares(middlewares, request, response)
  })

  await new Promise<void>((resolvePromise, reject) => {
    const onError = (error: Error) => reject(error)
    server.once('error', onError)
    server.listen(port, host, () => {
      server.off('error', onError)
      resolvePromise()
    })
  })

  const address = server.address()
  if (address && typeof address === 'object') boundPort = address.port
  return {
    origin: `http://${host}:${boundPort}`,
    close: () =>
      new Promise<void>((resolvePromise, reject) => {
        server.close((error) => {
          if (error) reject(error)
          else resolvePromise()
        })
      }),
  }
}
