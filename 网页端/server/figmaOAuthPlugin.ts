import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'
import {
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { dirname } from 'node:path'
import type { Plugin } from 'vite'
import { resolveDesignStudioDataPath } from './storage.ts'

const AUTH_PREFIX = '/api/auth/figma'
const FLOW_COOKIE = 'design_studio_figma_flow'
const HANDOFF_COOKIE = 'design_studio_figma_handoff'
const SESSION_COOKIE = 'design_studio_figma_session'
const FIGMA_API_ORIGIN = 'https://api.figma.com'
const LOCAL_REDIRECT_ORIGIN = 'http://design-studio.local'
const FLOW_TTL_MS = 10 * 60 * 1000
const SESSION_TTL_MS = 365 * 24 * 60 * 60 * 1000
const TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000
const MAX_METADATA_KEYS = 20
const MAX_IDS_LENGTH = 4_000
const MAX_NODE_IDS = 100
const SAFE_FILE_KEY = /^[A-Za-z0-9_-]{6,256}$/
const SAFE_NODE_ID = /^[A-Za-z0-9:_;.-]{1,160}$/
const SAFE_SESSION_ID = /^[A-Za-z0-9_-]{32,128}$/
const SAFE_TEAM_ID = /^\d{5,32}$/
const SAFE_PROJECT_ID = /^\d{5,32}$/
const MAX_SYNC_FILES = 60
const SYNC_METADATA_BATCH = 10
const SESSION_STORAGE_AAD = Buffer.from(
  'design-studio:figma-oauth-sessions:v1',
)
const CORE_OAUTH_SCOPES = [
  'current_user:read',
  'file_content:read',
  'file_metadata:read',
]

function oauthScopes() {
  return CORE_OAUTH_SCOPES
}

export type FigmaOAuthPluginOptions = {
  clientId: string
  clientSecret: string
  redirectUri: string
  /** Initial team_id list; the saved product setting takes precedence. */
  teamIds?: string[]
}

type SyncedFigmaFile = {
  key: string
  name: string
  url: string
  thumbnailUrl?: string
  lastModified?: string
  projectId: string
  projectName: string
  teamId: string
}

type PendingFlow = {
  state: string
  verifier: string
  returnTo: string
  createdAt: number
  handoffId?: string
}

type FigmaUser = {
  id: string
  handle: string
  email: string
  img_url: string
}

type OAuthSession = {
  accessToken: string
  refreshToken?: string
  expiresAt: number
  sessionExpiresAt: number
  user: FigmaUser
}

type TokenResponse = {
  accessToken: string
  refreshToken?: string
  expiresIn: number
}

type PublicFileMetadata = {
  key: string
  name: string
  thumbnailUrl: string | null
  lastModified: string | null
  editorType: string | null
  url: string
}

type Middleware = (
  request: IncomingMessage,
  response: ServerResponse,
  next: () => void,
) => void

function teamIdFromValue(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return null
  if (SAFE_TEAM_ID.test(trimmed)) return trimmed
  const fromPath = trimmed.match(/\/(?:files\/)?team\/(\d{5,32})(?=[/?#]|$)/i)
  if (fromPath) return fromPath[1]
  const fromQuery = trimmed.match(/[?&]team[_-]?id=(\d{5,32})(?=&|$)/i)
  return fromQuery?.[1] ?? null
}

function normalizeTeamIds(values: unknown): string[] {
  const items = Array.isArray(values)
    ? values
    : typeof values === 'string'
      ? values.split(/[\n,]+/)
      : []
  const ids: string[] = []
  const invalid: string[] = []
  for (const item of items) {
    const raw = String(item).trim()
    if (!raw) continue
    const teamId = teamIdFromValue(raw)
    if (teamId) ids.push(teamId)
    else invalid.push(raw)
  }
  if (invalid.length > 0) {
    throw new ApiError({
      status: 400,
      code: 'INVALID_TEAM_ID',
      message: `无效的 team_id：${invalid.join(', ')}`,
    })
  }
  return [...new Set(ids)]
}

function readConfiguredTeamIds(options: FigmaOAuthPluginOptions): string[] {
  try {
    const value = JSON.parse(
      readFileSync(resolveDesignStudioDataPath('figma-library-config.json'), 'utf8'),
    ) as { teamIds?: unknown }
    return normalizeTeamIds(value.teamIds)
  } catch {
    return normalizeTeamIds(options.teamIds ?? [])
  }
}

function persistConfiguredTeamIds(teamIds: string[]) {
  const configPath = resolveDesignStudioDataPath('figma-library-config.json')
  const temporaryPath = `${configPath}.${process.pid}.${randomUrlSafe(6)}.tmp`
  mkdirSync(dirname(configPath), { recursive: true, mode: 0o700 })
  writeFileSync(temporaryPath, JSON.stringify({ version: 1, teamIds }, null, 2), {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  })
  renameSync(temporaryPath, configPath)
}

function readJsonBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 64 * 1024) {
        reject(new ApiError({
          status: 413,
          code: 'BODY_TOO_LARGE',
          message: '请求体过大。',
        }))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8')
        resolve(raw ? JSON.parse(raw) : {})
      } catch {
        reject(new ApiError({
          status: 400,
          code: 'INVALID_JSON',
          message: '请求体必须是 JSON。',
        }))
      }
    })
    request.on('error', reject)
  })
}

class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly retryAfterSeconds?: number
  readonly invalidatesSession: boolean

  constructor({
    status,
    code,
    message,
    retryAfterSeconds,
    invalidatesSession = false,
  }: {
    status: number
    code: string
    message: string
    retryAfterSeconds?: number
    invalidatesSession?: boolean
  }) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.retryAfterSeconds = retryAfterSeconds
    this.invalidatesSession = invalidatesSession
  }
}

const pendingFlows = new Map<string, PendingFlow>()
const handoffs = new Map<string, {
  createdAt: number
  returnTo: string
  result?: string
  sessionId?: string
}>()
const sessions = new Map<string, OAuthSession>()
const refreshes = new Map<string, Promise<OAuthSession>>()

function randomUrlSafe(bytes = 32) {
  return randomBytes(bytes).toString('base64url')
}

function hashForPkce(value: string) {
  return createHash('sha256').update(value).digest('base64url')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sessionEncryptionKey(options: FigmaOAuthPluginOptions) {
  return createHash('sha256')
    .update('design-studio:figma-oauth-key:v1\0')
    .update(options.clientId)
    .update('\0')
    .update(options.clientSecret)
    .digest()
}

function normalizeStoredSession(value: unknown): OAuthSession | null {
  if (!isRecord(value) || !isRecord(value.user)) return null

  const {
    accessToken,
    refreshToken,
    expiresAt,
    sessionExpiresAt,
    user,
  } = value
  if (
    typeof accessToken !== 'string'
    || accessToken.length === 0
    || (
      refreshToken !== undefined
      && (typeof refreshToken !== 'string' || refreshToken.length === 0)
    )
    || typeof expiresAt !== 'number'
    || !Number.isFinite(expiresAt)
    || typeof sessionExpiresAt !== 'number'
    || !Number.isFinite(sessionExpiresAt)
    || sessionExpiresAt <= Date.now()
    || typeof user.id !== 'string'
    || typeof user.handle !== 'string'
    || typeof user.email !== 'string'
    || typeof user.img_url !== 'string'
  ) {
    return null
  }

  return {
    accessToken,
    ...(typeof refreshToken === 'string' ? { refreshToken } : {}),
    expiresAt,
    sessionExpiresAt,
    user: {
      id: user.id,
      handle: user.handle,
      email: user.email,
      img_url: user.img_url,
    },
  }
}

function persistPendingFlows() {
  try {
    const pendingPath = resolveDesignStudioDataPath('figma-oauth-pending.json')
    const payload = JSON.stringify({
      version: 1,
      flows: [...pendingFlows.entries()],
    })
    const temporaryPath = `${pendingPath}.${process.pid}.${randomUrlSafe(6)}.tmp`
    mkdirSync(dirname(pendingPath), { recursive: true, mode: 0o700 })
    writeFileSync(temporaryPath, payload, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    })
    renameSync(temporaryPath, pendingPath)
  } catch (error) {
    console.warn('Could not persist the Figma OAuth login flow.', error)
  }
}

function restorePendingFlows() {
  try {
    const pendingPath = resolveDesignStudioDataPath('figma-oauth-pending.json')
    const payload = JSON.parse(readFileSync(pendingPath, 'utf8')) as unknown
    if (!isRecord(payload) || payload.version !== 1 || !Array.isArray(payload.flows)) {
      return
    }
    const now = Date.now()
    for (const entry of payload.flows) {
      if (!Array.isArray(entry) || entry.length !== 2) continue
      const [id, flow] = entry
      if (typeof id !== 'string' || !isRecord(flow)) continue
      if (
        typeof flow.state !== 'string'
        || typeof flow.verifier !== 'string'
        || typeof flow.returnTo !== 'string'
        || typeof flow.createdAt !== 'number'
        || !Number.isFinite(flow.createdAt)
        || now - flow.createdAt > FLOW_TTL_MS
      ) {
        continue
      }
      pendingFlows.set(id, {
        state: flow.state,
        verifier: flow.verifier,
        returnTo: flow.returnTo,
        createdAt: flow.createdAt,
        ...(typeof flow.handoffId === 'string' ? { handoffId: flow.handoffId } : {}),
      })
      if (typeof flow.handoffId === 'string') {
        handoffs.set(flow.handoffId, { createdAt: flow.createdAt, returnTo: flow.returnTo })
      }
    }
  } catch {
    // First run, or the pending-flow file is missing/corrupt.
  }
}

function persistSessions(options: FigmaOAuthPluginOptions) {
  if (!configured(options)) return

  try {
    const sessionStoragePath = resolveDesignStudioDataPath(
      'figma-oauth-sessions.enc',
    )
    const plaintext = Buffer.from(JSON.stringify({
      version: 1,
      sessions: [...sessions.entries()],
    }))
    const iv = randomBytes(12)
    const cipher = createCipheriv(
      'aes-256-gcm',
      sessionEncryptionKey(options),
      iv,
    )
    cipher.setAAD(SESSION_STORAGE_AAD)
    const ciphertext = Buffer.concat([
      cipher.update(plaintext),
      cipher.final(),
    ])
    const envelope = JSON.stringify({
      version: 1,
      iv: iv.toString('base64url'),
      tag: cipher.getAuthTag().toString('base64url'),
      ciphertext: ciphertext.toString('base64url'),
    })
    const temporaryPath =
      `${sessionStoragePath}.${process.pid}.${randomUrlSafe(6)}.tmp`

    mkdirSync(dirname(sessionStoragePath), {
      recursive: true,
      mode: 0o700,
    })
    writeFileSync(temporaryPath, envelope, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    })
    renameSync(temporaryPath, sessionStoragePath)
  } catch (error) {
    console.warn('Could not persist the local Figma OAuth session.', error)
  }
}

function restoreSessions(options: FigmaOAuthPluginOptions) {
  if (!configured(options)) return

  try {
    const sessionStoragePath = resolveDesignStudioDataPath(
      'figma-oauth-sessions.enc',
    )
    const envelope = JSON.parse(
      readFileSync(sessionStoragePath, 'utf8'),
    ) as unknown
    if (
      !isRecord(envelope)
      || envelope.version !== 1
      || typeof envelope.iv !== 'string'
      || typeof envelope.tag !== 'string'
      || typeof envelope.ciphertext !== 'string'
    ) {
      return
    }

    const iv = Buffer.from(envelope.iv, 'base64url')
    const tag = Buffer.from(envelope.tag, 'base64url')
    if (iv.length !== 12 || tag.length !== 16) return

    const decipher = createDecipheriv(
      'aes-256-gcm',
      sessionEncryptionKey(options),
      iv,
    )
    decipher.setAAD(SESSION_STORAGE_AAD)
    decipher.setAuthTag(tag)
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64url')),
      decipher.final(),
    ])
    const stored = JSON.parse(plaintext.toString('utf8')) as unknown
    if (
      !isRecord(stored)
      || stored.version !== 1
      || !Array.isArray(stored.sessions)
    ) {
      return
    }

    for (const item of stored.sessions) {
      if (
        !Array.isArray(item)
        || item.length !== 2
        || typeof item[0] !== 'string'
        || !SAFE_SESSION_ID.test(item[0])
      ) {
        continue
      }
      const session = normalizeStoredSession(item[1])
      if (session) sessions.set(item[0], session)
    }
  } catch (error) {
    const code =
      isRecord(error) && typeof error.code === 'string'
        ? error.code
        : ''
    if (code !== 'ENOENT') {
      console.warn('Could not restore the local Figma OAuth session.', error)
    }
  }
}

function parseCookies(request: IncomingMessage) {
  const header = request.headers.cookie
  if (!header) return new Map<string, string>()

  return new Map(
    header.split(';').flatMap((part) => {
      const separator = part.indexOf('=')
      if (separator < 0) return []
      const key = part.slice(0, separator).trim()
      const rawValue = part.slice(separator + 1).trim()
      try {
        return [[key, decodeURIComponent(rawValue)]]
      } catch {
        return []
      }
    }),
  )
}

function serializeCookie(
  name: string,
  value: string,
  {
    maxAge,
    secure,
  }: {
    maxAge: number
    secure: boolean
  },
) {
  return [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.max(0, Math.floor(maxAge))}`,
    secure ? 'Secure' : '',
  ]
    .filter(Boolean)
    .join('; ')
}

function setNoStore(response: ServerResponse) {
  response.setHeader('Cache-Control', 'no-store')
}

function sendJson(response: ServerResponse, status: number, value: unknown) {
  setNoStore(response)
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.end(JSON.stringify(value))
}

function redirect(response: ServerResponse, location: string) {
  setNoStore(response)
  response.statusCode = 302
  response.setHeader('Location', location)
  response.end()
}

function sendApiError(response: ServerResponse, error: unknown) {
  if (error instanceof ApiError) {
    if (error.retryAfterSeconds !== undefined) {
      response.setHeader('Retry-After', String(error.retryAfterSeconds))
    }
    sendJson(response, error.status, {
      error: error.code,
      message: error.message,
      ...(error.retryAfterSeconds === undefined
        ? {}
        : { retryAfterSeconds: error.retryAfterSeconds }),
    })
    return
  }

  console.error('Unexpected Figma OAuth middleware error.', error)
  sendJson(response, 500, {
    error: 'INTERNAL_ERROR',
    message: 'Figma OAuth 服务发生了未预期的错误。',
  })
}

function valuesMatch(left: string, right: string) {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  )
}

function configurationIssue(options: FigmaOAuthPluginOptions) {
  if (!options.clientId || !options.clientSecret || !options.redirectUri) {
    return '缺少 FIGMA_OAUTH_CLIENT_ID、FIGMA_OAUTH_CLIENT_SECRET 或 FIGMA_OAUTH_REDIRECT_URI。'
  }

  try {
    const redirectUri = new URL(options.redirectUri)
    if (redirectUri.protocol !== 'http:' && redirectUri.protocol !== 'https:') {
      return 'FIGMA_OAUTH_REDIRECT_URI 必须是 http 或 https URL。'
    }
  } catch {
    return 'FIGMA_OAUTH_REDIRECT_URI 不是有效 URL。'
  }

  return null
}

function configured(options: FigmaOAuthPluginOptions) {
  return configurationIssue(options) === null
}

function assertConfigured(options: FigmaOAuthPluginOptions) {
  const issue = configurationIssue(options)
  if (issue) {
    throw new ApiError({
      status: 503,
      code: 'FIGMA_OAUTH_NOT_CONFIGURED',
      message: issue,
    })
  }
}

function normalizeUser(value: unknown): FigmaUser {
  if (!isRecord(value)) {
    throw new ApiError({
      status: 502,
      code: 'FIGMA_PROFILE_INVALID',
      message: 'Figma 返回了无法识别的账号信息。',
    })
  }

  const { id, handle, email, img_url: imageUrl } = value
  if (typeof id !== 'string' || typeof handle !== 'string') {
    throw new ApiError({
      status: 502,
      code: 'FIGMA_PROFILE_INVALID',
      message: 'Figma 返回的账号信息不完整。',
    })
  }

  return {
    id,
    handle,
    email: typeof email === 'string' ? email : '',
    img_url: typeof imageUrl === 'string' ? imageUrl : '',
  }
}

function publicUser(user: FigmaUser) {
  return {
    id: user.id,
    name: user.handle,
    email: user.email,
    avatarUrl: user.img_url,
  }
}

function removeExpiredState(options: FigmaOAuthPluginOptions) {
  const now = Date.now()
  for (const [id, handoff] of handoffs) {
    if (now - handoff.createdAt > FLOW_TTL_MS) handoffs.delete(id)
  }
  let sessionsChanged = false
  let flowsChanged = false
  for (const [flowId, flow] of pendingFlows) {
    if (now - flow.createdAt > FLOW_TTL_MS) {
      pendingFlows.delete(flowId)
      flowsChanged = true
    }
  }
  if (flowsChanged) persistPendingFlows()
  for (const [sessionId, session] of sessions) {
    if (session.sessionExpiresAt <= now) {
      sessions.delete(sessionId)
      refreshes.delete(sessionId)
      sessionsChanged = true
    }
  }
  if (sessionsChanged) persistSessions(options)
}

function normalizeReturnTo(value: string | null) {
  if (!value) return '/'
  if (
    value.length > 2_048
    || !value.startsWith('/')
    || value.startsWith('//')
    || value.includes('\\')
    || /[\u0000-\u001F\u007F]/.test(value)
  ) {
    throw new ApiError({
      status: 400,
      code: 'INVALID_RETURN_TO',
      message: 'returnTo 必须是本站内以单个 / 开头的相对路径。',
    })
  }

  let inspected = value
  try {
    for (let index = 0; index < 3; index += 1) {
      const decoded = decodeURIComponent(inspected)
      if (decoded === inspected) break
      inspected = decoded
    }
  } catch {
    throw new ApiError({
      status: 400,
      code: 'INVALID_RETURN_TO',
      message: 'returnTo 包含无效的 URL 编码。',
    })
  }

  if (
    inspected.startsWith('//')
    || inspected.startsWith('/\\')
    || inspected.includes('\\')
    || /[\u0000-\u001F\u007F]/.test(inspected)
  ) {
    throw new ApiError({
      status: 400,
      code: 'INVALID_RETURN_TO',
      message: 'returnTo 必须指向本站内的相对路径。',
    })
  }

  const parsed = new URL(value, LOCAL_REDIRECT_ORIGIN)
  if (parsed.origin !== LOCAL_REDIRECT_ORIGIN) {
    throw new ApiError({
      status: 400,
      code: 'INVALID_RETURN_TO',
      message: 'returnTo 不能跳转到站外地址。',
    })
  }

  if (parsed.pathname === AUTH_PREFIX || parsed.pathname.startsWith(`${AUTH_PREFIX}/`)) {
    return '/'
  }

  parsed.searchParams.delete('figma_auth')
  return `${parsed.pathname}${parsed.search}${parsed.hash}`
}

function returnToWithResult(returnTo: string, result: string) {
  const parsed = new URL(returnTo, LOCAL_REDIRECT_ORIGIN)
  parsed.searchParams.set('figma_auth', result)
  return `${parsed.pathname}${parsed.search}${parsed.hash}`
}

function basicAuthorization(options: FigmaOAuthPluginOptions) {
  return `Basic ${Buffer.from(
    `${options.clientId}:${options.clientSecret}`,
  ).toString('base64')}`
}

async function readResponseBody(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

function responseMessage(value: unknown) {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (!isRecord(value)) return null
  for (const key of ['message', 'error_description', 'error']) {
    const message = value[key]
    if (typeof message === 'string' && message.trim()) return message.trim()
  }
  return null
}

function responseRetryAfterSeconds(response: Response) {
  const raw = response.headers.get('Retry-After')
  if (!raw) return undefined
  const seconds = Number(raw)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds)
  const date = Date.parse(raw)
  if (Number.isNaN(date)) return undefined
  return Math.max(0, Math.ceil((date - Date.now()) / 1000))
}

function normalizeTokenResponse(value: unknown): TokenResponse {
  if (!isRecord(value)) {
    throw new ApiError({
      status: 502,
      code: 'FIGMA_TOKEN_RESPONSE_INVALID',
      message: 'Figma 返回了无法识别的 OAuth token 响应。',
    })
  }

  const accessToken = value.access_token
  const expiresInValue = value.expires_in
  const expiresIn =
    typeof expiresInValue === 'number'
      ? expiresInValue
      : typeof expiresInValue === 'string'
        ? Number(expiresInValue)
        : Number.NaN

  if (
    typeof accessToken !== 'string'
    || !accessToken
    || !Number.isFinite(expiresIn)
    || expiresIn <= 0
  ) {
    throw new ApiError({
      status: 502,
      code: 'FIGMA_TOKEN_RESPONSE_INVALID',
      message: 'Figma 返回的 OAuth token 响应不完整。',
    })
  }

  return {
    accessToken,
    refreshToken:
      typeof value.refresh_token === 'string' && value.refresh_token
        ? value.refresh_token
        : undefined,
    expiresIn,
  }
}

async function exchangeCode(
  options: FigmaOAuthPluginOptions,
  code: string,
  verifier: string,
) {
  const body = new URLSearchParams({
    redirect_uri: options.redirectUri,
    code,
    grant_type: 'authorization_code',
    code_verifier: verifier,
  })

  let tokenResponse: Response
  try {
    tokenResponse = await fetch(`${FIGMA_API_ORIGIN}/v1/oauth/token`, {
      method: 'POST',
      headers: {
        Authorization: basicAuthorization(options),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    })
  } catch {
    throw new ApiError({
      status: 502,
      code: 'FIGMA_TOKEN_EXCHANGE_UNAVAILABLE',
      message: '暂时无法连接 Figma OAuth token 服务。',
    })
  }

  const responseBody = await readResponseBody(tokenResponse)
  if (!tokenResponse.ok) {
    throw new ApiError({
      status: 502,
      code: 'FIGMA_TOKEN_EXCHANGE_FAILED',
      message:
        responseMessage(responseBody)
        ?? `Figma OAuth code 交换失败（HTTP ${tokenResponse.status}）。`,
    })
  }

  return normalizeTokenResponse(responseBody)
}

async function requestRefreshedToken(
  options: FigmaOAuthPluginOptions,
  refreshToken: string,
) {
  let refreshResponse: Response
  try {
    refreshResponse = await fetch(`${FIGMA_API_ORIGIN}/v1/oauth/token`, {
      method: 'POST',
      headers: {
        Authorization: basicAuthorization(options),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    })
  } catch {
    throw new ApiError({
      status: 502,
      code: 'FIGMA_TOKEN_REFRESH_UNAVAILABLE',
      message: '暂时无法连接 Figma OAuth refresh 服务。',
    })
  }

  const responseBody = await readResponseBody(refreshResponse)
  if (!refreshResponse.ok) {
    const retryAfterSeconds = responseRetryAfterSeconds(refreshResponse)
    if (
      refreshResponse.status === 400
      || refreshResponse.status === 401
      || refreshResponse.status === 403
    ) {
      throw new ApiError({
        status: 401,
        code: 'FIGMA_SESSION_EXPIRED',
        message: 'Figma 授权已失效，请重新连接账号。',
        invalidatesSession: true,
      })
    }
    if (refreshResponse.status === 429) {
      throw new ApiError({
        status: 429,
        code: 'FIGMA_RATE_LIMITED',
        message: 'Figma OAuth 刷新请求过于频繁，请稍后重试。',
        retryAfterSeconds,
      })
    }
    throw new ApiError({
      status: 502,
      code: 'FIGMA_TOKEN_REFRESH_FAILED',
      message:
        responseMessage(responseBody)
        ?? `Figma OAuth token 刷新失败（HTTP ${refreshResponse.status}）。`,
    })
  }

  return normalizeTokenResponse(responseBody)
}

async function refreshSession(
  options: FigmaOAuthPluginOptions,
  sessionId: string,
  {
    force = false,
    tokenUsed,
  }: {
    force?: boolean
    tokenUsed?: string
  } = {},
) {
  const current = sessions.get(sessionId)
  if (!current || current.sessionExpiresAt <= Date.now()) {
    throw new ApiError({
      status: 401,
      code: 'FIGMA_AUTH_REQUIRED',
      message: '请先授权 Figma 账号。',
      invalidatesSession: true,
    })
  }

  if (force && tokenUsed && current.accessToken !== tokenUsed) {
    return current
  }
  if (!force && current.expiresAt - Date.now() > TOKEN_REFRESH_SKEW_MS) {
    return current
  }
  if (!current.refreshToken) {
    throw new ApiError({
      status: 401,
      code: 'FIGMA_SESSION_EXPIRED',
      message: 'Figma OAuth 会话缺少 refresh token，请重新授权。',
      invalidatesSession: true,
    })
  }

  const activeRefresh = refreshes.get(sessionId)
  if (activeRefresh) return activeRefresh

  const refreshPromise = requestRefreshedToken(
    options,
    current.refreshToken,
  ).then((token) => {
    const latest = sessions.get(sessionId)
    if (!latest) {
      throw new ApiError({
        status: 401,
        code: 'FIGMA_AUTH_REQUIRED',
        message: 'Figma 会话已结束，请重新授权。',
        invalidatesSession: true,
      })
    }

    const refreshed: OAuthSession = {
      ...latest,
      accessToken: token.accessToken,
      refreshToken: token.refreshToken ?? latest.refreshToken,
      expiresAt: Date.now() + token.expiresIn * 1000,
    }
    sessions.set(sessionId, refreshed)
    persistSessions(options)
    return refreshed
  })

  refreshes.set(sessionId, refreshPromise)
  try {
    return await refreshPromise
  } finally {
    if (refreshes.get(sessionId) === refreshPromise) {
      refreshes.delete(sessionId)
    }
  }
}

async function fetchCurrentUser(accessToken: string) {
  let userResponse: Response
  try {
    userResponse = await fetch(`${FIGMA_API_ORIGIN}/v1/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
  } catch {
    throw new ApiError({
      status: 502,
      code: 'FIGMA_PROFILE_UNAVAILABLE',
      message: '暂时无法读取 Figma 账号信息。',
    })
  }

  const responseBody = await readResponseBody(userResponse)
  if (!userResponse.ok) {
    throw new ApiError({
      status: userResponse.status === 429 ? 429 : 502,
      code:
        userResponse.status === 429
          ? 'FIGMA_RATE_LIMITED'
          : 'FIGMA_PROFILE_FAILED',
      message:
        responseMessage(responseBody)
        ?? `读取 Figma 账号信息失败（HTTP ${userResponse.status}）。`,
      retryAfterSeconds: responseRetryAfterSeconds(userResponse),
    })
  }

  return normalizeUser(responseBody)
}

function isInvalidTokenResponse(status: number, body: unknown) {
  if (status === 401) return true
  if (status !== 403) return false
  const message = responseMessage(body)
  return Boolean(
    message && /(invalid|expired|revoked).{0,24}token|token.{0,24}(invalid|expired|revoked)/i.test(message),
  )
}

function upstreamError(
  response: Response,
  body: unknown,
  fallbackContext: string,
) {
  const upstreamMessage = responseMessage(body)
  const retryAfterSeconds = responseRetryAfterSeconds(response)
  switch (response.status) {
    case 400:
      return new ApiError({
        status: 400,
        code: 'FIGMA_UPSTREAM_BAD_REQUEST',
        message: upstreamMessage ?? `${fallbackContext}的请求参数无效。`,
      })
    case 401:
      return new ApiError({
        status: 401,
        code: 'FIGMA_SESSION_EXPIRED',
        message: 'Figma 授权已失效，请重新连接账号。',
        invalidatesSession: true,
      })
    case 403:
      return new ApiError({
        status: 403,
        code: 'FIGMA_ACCESS_DENIED',
        message:
          upstreamMessage
          ?? `当前 Figma 账号无权读取${fallbackContext}，或 OAuth scope 不足。`,
      })
    case 404:
      return new ApiError({
        status: 404,
        code: 'FIGMA_FILE_NOT_FOUND',
        message: `${fallbackContext}不存在，或当前账号无法访问。`,
      })
    case 429:
      return new ApiError({
        status: 429,
        code: 'FIGMA_RATE_LIMITED',
        message: 'Figma API 请求过于频繁，请稍后重试。',
        retryAfterSeconds,
      })
    default:
      return new ApiError({
        status: 502,
        code: 'FIGMA_UPSTREAM_ERROR',
        message:
          upstreamMessage
          ?? `${fallbackContext}读取失败（Figma HTTP ${response.status}）。`,
      })
  }
}

async function fetchFigmaJson(
  options: FigmaOAuthPluginOptions,
  sessionId: string,
  upstreamUrl: URL,
  fallbackContext: string,
) {
  let session = await refreshSession(options, sessionId)
  let tokenUsed = session.accessToken

  const request = async (accessToken: string) => {
    try {
      const response = await fetch(upstreamUrl, {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
      })
      return {
        response,
        body: await readResponseBody(response),
      }
    } catch {
      throw new ApiError({
        status: 502,
        code: 'FIGMA_UPSTREAM_UNAVAILABLE',
        message: `暂时无法连接 Figma API 读取${fallbackContext}。`,
      })
    }
  }

  let result = await request(tokenUsed)
  if (
    !result.response.ok
    && isInvalidTokenResponse(result.response.status, result.body)
  ) {
    session = await refreshSession(options, sessionId, {
      force: true,
      tokenUsed,
    })
    tokenUsed = session.accessToken
    result = await request(tokenUsed)
  }

  if (!result.response.ok) {
    throw upstreamError(result.response, result.body, fallbackContext)
  }
  if (result.body === undefined) {
    throw new ApiError({
      status: 502,
      code: 'FIGMA_UPSTREAM_RESPONSE_INVALID',
      message: `Figma 返回的${fallbackContext}响应为空。`,
    })
  }

  return result.body
}

function validateFileKey(value: string) {
  if (!SAFE_FILE_KEY.test(value)) {
    throw new ApiError({
      status: 400,
      code: 'INVALID_FIGMA_FILE_KEY',
      message: 'Figma 文件 key 格式无效。',
    })
  }
  return value
}

function fileKeyFromPath(pathname: string) {
  const prefix = `${AUTH_PREFIX}/files/`
  const encodedKey = pathname.slice(prefix.length)
  if (!encodedKey || encodedKey.includes('/')) {
    throw new ApiError({
      status: 400,
      code: 'INVALID_FIGMA_FILE_KEY',
      message: '请求路径中缺少有效的 Figma 文件 key。',
    })
  }

  try {
    return validateFileKey(decodeURIComponent(encodedKey))
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw new ApiError({
      status: 400,
      code: 'INVALID_FIGMA_FILE_KEY',
      message: 'Figma 文件 key 包含无效的 URL 编码。',
    })
  }
}

function fileKeyFromFileSubpath(pathname: string, suffix: string) {
  const prefix = `${AUTH_PREFIX}/files/`
  if (!pathname.startsWith(prefix) || !pathname.endsWith(suffix)) {
    throw new ApiError({
      status: 400,
      code: 'INVALID_FIGMA_FILE_KEY',
      message: '请求路径中缺少有效的 Figma 文件 key。',
    })
  }

  const encodedKey = pathname.slice(prefix.length, -suffix.length)
  if (!encodedKey || encodedKey.includes('/')) {
    throw new ApiError({
      status: 400,
      code: 'INVALID_FIGMA_FILE_KEY',
      message: '请求路径中缺少有效的 Figma 文件 key。',
    })
  }

  try {
    return validateFileKey(decodeURIComponent(encodedKey))
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw new ApiError({
      status: 400,
      code: 'INVALID_FIGMA_FILE_KEY',
      message: 'Figma 文件 key 包含无效的 URL 编码。',
    })
  }
}

function fileKeyFromImagesPath(pathname: string) {
  return fileKeyFromFileSubpath(pathname, '/images')
}

function singleQueryValue(
  searchParams: URLSearchParams,
  name: string,
) {
  const values = searchParams.getAll(name)
  if (values.length > 1) {
    throw new ApiError({
      status: 400,
      code: 'INVALID_FIGMA_QUERY',
      message: `查询参数 ${name} 不能重复。`,
    })
  }
  return values[0]
}

function safeFileQuery(searchParams: URLSearchParams) {
  const allowed = new Set(['depth', 'ids', 'geometry'])
  for (const name of searchParams.keys()) {
    if (!allowed.has(name)) {
      throw new ApiError({
        status: 400,
        code: 'UNSUPPORTED_FIGMA_QUERY',
        message: `不允许透传查询参数 ${name}。`,
      })
    }
  }

  const upstream = new URLSearchParams()
  const depth = singleQueryValue(searchParams, 'depth')
  if (depth !== undefined) {
    if (!/^[1-9]\d{0,2}$/.test(depth)) {
      throw new ApiError({
        status: 400,
        code: 'INVALID_FIGMA_DEPTH',
        message: 'depth 必须是 1 到 999 的正整数。',
      })
    }
    upstream.set('depth', depth)
  }

  const ids = singleQueryValue(searchParams, 'ids')
  if (ids !== undefined) {
    const nodeIds = ids.split(',')
    if (
      !ids
      || ids.length > MAX_IDS_LENGTH
      || nodeIds.length > MAX_NODE_IDS
      || nodeIds.some((id) => !SAFE_NODE_ID.test(id))
    ) {
      throw new ApiError({
        status: 400,
        code: 'INVALID_FIGMA_IDS',
        message: `ids 必须是最多 ${MAX_NODE_IDS} 个合法 Figma node id 的逗号分隔列表。`,
      })
    }
    upstream.set('ids', ids)
  }

  const geometry = singleQueryValue(searchParams, 'geometry')
  if (geometry !== undefined) {
    if (geometry !== 'paths') {
      throw new ApiError({
        status: 400,
        code: 'INVALID_FIGMA_GEOMETRY',
        message: 'geometry 仅允许设置为 paths。',
      })
    }
    upstream.set('geometry', geometry)
  }

  return upstream
}

function parseNodeIdsQuery(searchParams: URLSearchParams, required: boolean) {
  const ids = singleQueryValue(searchParams, 'ids')
  if (ids === undefined) {
    if (!required) return undefined
    throw new ApiError({
      status: 400,
      code: 'MISSING_FIGMA_IDS',
      message: '请通过 ids 提供至少一个 Figma node id。',
    })
  }

  const nodeIds = ids.split(',')
  if (
    !ids
    || ids.length > MAX_IDS_LENGTH
    || nodeIds.length > MAX_NODE_IDS
    || nodeIds.some((id) => !SAFE_NODE_ID.test(id))
  ) {
    throw new ApiError({
      status: 400,
      code: 'INVALID_FIGMA_IDS',
      message: `ids 必须是最多 ${MAX_NODE_IDS} 个合法 Figma node id 的逗号分隔列表。`,
    })
  }
  return ids
}

function metadataKeys(searchParams: URLSearchParams) {
  for (const name of searchParams.keys()) {
    if (name !== 'keys') {
      throw new ApiError({
        status: 400,
        code: 'UNSUPPORTED_METADATA_QUERY',
        message: `file-metadata 不支持查询参数 ${name}。`,
      })
    }
  }

  const raw = singleQueryValue(searchParams, 'keys')
  if (!raw) {
    throw new ApiError({
      status: 400,
      code: 'MISSING_FIGMA_FILE_KEYS',
      message: '请通过 keys=a,b 提供至少一个已知 Figma 文件 key。',
    })
  }

  const keys = [...new Set(raw.split(',').map((key) => key.trim()))]
  if (keys.length > MAX_METADATA_KEYS) {
    throw new ApiError({
      status: 400,
      code: 'TOO_MANY_FIGMA_FILE_KEYS',
      message: `一次最多读取 ${MAX_METADATA_KEYS} 个 Figma 文件的 metadata。`,
    })
  }
  for (const key of keys) validateFileKey(key)
  return keys
}

function normalizeFileMetadata(
  key: string,
  value: unknown,
): PublicFileMetadata {
  if (!isRecord(value) || !isRecord(value.file)) {
    throw new ApiError({
      status: 502,
      code: 'FIGMA_METADATA_RESPONSE_INVALID',
      message: `Figma 文件 ${key} 的 metadata 响应格式无效。`,
    })
  }

  const file = value.file
  if (typeof file.name !== 'string' || !file.name) {
    throw new ApiError({
      status: 502,
      code: 'FIGMA_METADATA_RESPONSE_INVALID',
      message: `Figma 文件 ${key} 的 metadata 缺少名称。`,
    })
  }

  return {
    key,
    name: file.name,
    thumbnailUrl:
      typeof file.thumbnail_url === 'string' ? file.thumbnail_url : null,
    lastModified:
      typeof file.last_touched_at === 'string' ? file.last_touched_at : null,
    editorType:
      typeof file.editorType === 'string' ? file.editorType : null,
    url:
      typeof file.url === 'string' && file.url
        ? file.url
        : `https://www.figma.com/design/${encodeURIComponent(key)}`,
  }
}

function sessionCookie(
  sessionId: string,
  secureCookies: boolean,
) {
  return serializeCookie(SESSION_COOKIE, sessionId, {
    maxAge: SESSION_TTL_MS / 1000,
    secure: secureCookies,
  })
}

function clearedSessionCookie(secureCookies: boolean) {
  return serializeCookie(SESSION_COOKIE, '', {
    maxAge: 0,
    secure: secureCookies,
  })
}

function clearedFlowCookie(secureCookies: boolean) {
  return serializeCookie(FLOW_COOKIE, '', {
    maxAge: 0,
    secure: secureCookies,
  })
}

function sessionFromRequest(request: IncomingMessage) {
  const sessionId = parseCookies(request).get(SESSION_COOKIE)
  return {
    sessionId,
    session: sessionId ? sessions.get(sessionId) : undefined,
  }
}

function invalidateSessionForError(
  error: unknown,
  sessionId: string,
  response: ServerResponse,
  secureCookies: boolean,
  options: FigmaOAuthPluginOptions,
) {
  if (!(error instanceof ApiError) || !error.invalidatesSession) return
  sessions.delete(sessionId)
  refreshes.delete(sessionId)
  persistSessions(options)
  response.setHeader('Set-Cookie', clearedSessionCookie(secureCookies))
}

async function authenticatedSession(
  request: IncomingMessage,
  response: ServerResponse,
  options: FigmaOAuthPluginOptions,
  secureCookies: boolean,
) {
  assertConfigured(options)
  const { sessionId, session } = sessionFromRequest(request)
  if (!sessionId || !session) {
    if (sessionId) {
      response.setHeader('Set-Cookie', clearedSessionCookie(secureCookies))
    }
    throw new ApiError({
      status: 401,
      code: 'FIGMA_AUTH_REQUIRED',
      message: '请先授权 Figma 账号。',
    })
  }

  try {
    return {
      sessionId,
      session: await refreshSession(options, sessionId),
    }
  } catch (error) {
    invalidateSessionForError(
      error,
      sessionId,
      response,
      secureCookies,
      options,
    )
    throw error
  }
}

async function handleSessionRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: FigmaOAuthPluginOptions,
  secureCookies: boolean,
) {
  const { sessionId, session } = sessionFromRequest(request)
  if (!sessionId || !session) {
    if (sessionId) {
      response.setHeader('Set-Cookie', clearedSessionCookie(secureCookies))
    }
    sendJson(response, 200, {
      configured: configured(options),
      authenticated: false,
      user: null,
    })
    return
  }

  try {
    const freshSession = await refreshSession(options, sessionId)
    sendJson(response, 200, {
      configured: configured(options),
      authenticated: true,
      user: publicUser(freshSession.user),
    })
  } catch (error) {
    invalidateSessionForError(
      error,
      sessionId,
      response,
      secureCookies,
      options,
    )
    throw error
  }
}

function takePendingFlow(state: string | null, cookieState: string | undefined) {
  if (state) {
    const byState = pendingFlows.get(state)
    if (byState) {
      pendingFlows.delete(state)
      return byState
    }
  }
  if (cookieState) {
    const byCookie = pendingFlows.get(cookieState)
    if (byCookie && (!state || valuesMatch(byCookie.state, state))) {
      pendingFlows.delete(cookieState)
      return byCookie
    }
  }
  return undefined
}

function figmaAuthorizeUrl(
  options: FigmaOAuthPluginOptions,
  state: string,
  verifier: string,
) {
  const authorizeUrl = new URL('https://www.figma.com/oauth')
  authorizeUrl.searchParams.set('client_id', options.clientId)
  authorizeUrl.searchParams.set('redirect_uri', options.redirectUri)
  authorizeUrl.searchParams.set('scope', oauthScopes().join(' '))
  authorizeUrl.searchParams.set('state', state)
  authorizeUrl.searchParams.set('response_type', 'code')
  authorizeUrl.searchParams.set('code_challenge', hashForPkce(verifier))
  authorizeUrl.searchParams.set('code_challenge_method', 'S256')
  return authorizeUrl
}

function figmaAccountPickerUrl(authorizeUrl: URL) {
  const picker = new URL('https://www.figma.com/switch_user')
  picker.searchParams.set(
    'cont',
    `${authorizeUrl.pathname}${authorizeUrl.search}`,
  )
  return picker
}

async function handleStartRequest(
  response: ServerResponse,
  requestUrl: URL,
  options: FigmaOAuthPluginOptions,
  secureCookies: boolean,
) {
  assertConfigured(options)
  const returnTo = normalizeReturnTo(requestUrl.searchParams.get('returnTo'))
  const state = randomUrlSafe(32)
  const verifier = randomUrlSafe(48)
  const handoffId = requestUrl.searchParams.get('handoff') === '1' ? randomUrlSafe(32) : undefined
  pendingFlows.set(state, {
    state,
    verifier,
    returnTo,
    createdAt: Date.now(),
    ...(handoffId ? { handoffId } : {}),
  })
  persistPendingFlows()

  const authorizeUrl = figmaAuthorizeUrl(options, state, verifier)

  if (handoffId) {
    handoffs.set(handoffId, { createdAt: Date.now(), returnTo })
    response.setHeader('Set-Cookie', serializeCookie(HANDOFF_COOKIE, handoffId, {
      maxAge: FLOW_TTL_MS / 1000, secure: secureCookies,
    }))
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('Referrer-Policy', 'no-referrer')
    const nonce = randomUrlSafe(24)
    response.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'`)
    const target = JSON.stringify(authorizeUrl.toString()).replace(/</g, '\\u003c')
    response.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>连接 Figma</title>
      <style>body{font:16px system-ui;padding:48px;color:#20242d}a{color:#2164ed}p{line-height:1.8}</style>
      <h2>请在浏览器中授权 Figma</h2><p id="status">授权页已打开。完成后，此窗口会自动关闭，应用将显示已连接。</p>
      <a id="authorize" target="_blank" rel="noreferrer">重新打开授权页</a>
      <script nonce="${nonce}">
        const link = document.getElementById('authorize'); link.href = ${target};
        window.open(link.href, '_blank');
        async function poll() {
          try {
            const response = await fetch('/api/auth/figma/handoff', {credentials:'same-origin',cache:'no-store'});
            const data = await response.json();
            if (data.redirect) { location.replace(data.redirect); return; }
            if (!response.ok) { document.getElementById('status').textContent = '授权已过期，请关闭此窗口并重新连接。'; return; }
          } catch {}
          setTimeout(poll, 1000);
        }
        poll();
      </script></html>`)
    return
  }

  response.setHeader(
    'Set-Cookie',
    serializeCookie(FLOW_COOKIE, state, {
      maxAge: FLOW_TTL_MS / 1000,
      secure: secureCookies,
    }),
  )
  redirect(response, (requestUrl.searchParams.get('direct') === '1'
    ? authorizeUrl : figmaAccountPickerUrl(authorizeUrl)).toString())
}

async function handleCallbackRequest(
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
  options: FigmaOAuthPluginOptions,
  secureCookies: boolean,
) {
  assertConfigured(options)
  const cookieState = parseCookies(request).get(FLOW_COOKIE)
  const code = requestUrl.searchParams.get('code')
  const state = requestUrl.searchParams.get('state')
  const oauthError = requestUrl.searchParams.get('error')
  const flow = takePendingFlow(state, cookieState)
  persistPendingFlows()
  const returnTo = flow?.returnTo ?? '/'
  const finishHandoff = (result: string, sessionId?: string) => {
    const handoff = flow?.handoffId ? handoffs.get(flow.handoffId) : undefined
    if (handoff) Object.assign(handoff, { result, sessionId })
  }

  response.setHeader('Set-Cookie', clearedFlowCookie(secureCookies))

  if (oauthError) {
    finishHandoff('access_denied')
    redirect(response, returnToWithResult(returnTo, 'access_denied'))
    return
  }

  if (!flow || !code || !state || !valuesMatch(flow.state, state)) {
    finishHandoff('invalid_state')
    redirect(response, returnToWithResult(returnTo, 'invalid_state'))
    return
  }

  try {
    const token = await exchangeCode(options, code, flow.verifier)
    const user = await fetchCurrentUser(token.accessToken)
    const previousSessionId = parseCookies(request).get(SESSION_COOKIE)
    if (previousSessionId) {
      sessions.delete(previousSessionId)
      refreshes.delete(previousSessionId)
    }
    const sessionId = randomUrlSafe(32)
    sessions.set(sessionId, {
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      expiresAt: Date.now() + token.expiresIn * 1000,
      sessionExpiresAt: Date.now() + SESSION_TTL_MS,
      user,
    })
    persistSessions(options)

    finishHandoff('connected', sessionId)
    response.setHeader('Set-Cookie', [
      clearedFlowCookie(secureCookies),
      sessionCookie(sessionId, secureCookies),
    ])
    redirect(response, returnToWithResult(flow.returnTo, 'connected'))
  } catch (error) {
    finishHandoff('exchange_failed')
    console.error('Figma OAuth callback failed', error)
    redirect(response, returnToWithResult(flow.returnTo, 'exchange_failed'))
  }
}

async function handleFileRequest(
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
  options: FigmaOAuthPluginOptions,
  secureCookies: boolean,
) {
  const key = fileKeyFromPath(requestUrl.pathname)
  const query = safeFileQuery(requestUrl.searchParams)
  const { sessionId } = await authenticatedSession(
    request,
    response,
    options,
    secureCookies,
  )
  const upstreamUrl = new URL(
    `/v1/files/${encodeURIComponent(key)}`,
    FIGMA_API_ORIGIN,
  )
  upstreamUrl.search = query.toString()
  let file: unknown
  try {
    file = await fetchFigmaJson(
      options,
      sessionId,
      upstreamUrl,
      `Figma 文件 ${key}`,
    )
  } catch (error) {
    invalidateSessionForError(
      error,
      sessionId,
      response,
      secureCookies,
      options,
    )
    throw error
  }
  if (!isRecord(file)) {
    throw new ApiError({
      status: 502,
      code: 'FIGMA_FILE_RESPONSE_INVALID',
      message: `Figma 文件 ${key} 的响应格式无效。`,
    })
  }
  sendJson(response, 200, file)
}

async function handleFileImagesRequest(
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
  options: FigmaOAuthPluginOptions,
  secureCookies: boolean,
) {
  if ([...requestUrl.searchParams.keys()].length > 0) {
    throw new ApiError({
      status: 400,
      code: 'UNSUPPORTED_FIGMA_QUERY',
      message: 'Figma 图片引用接口不接受查询参数。',
    })
  }

  const key = fileKeyFromImagesPath(requestUrl.pathname)
  const { sessionId } = await authenticatedSession(
    request,
    response,
    options,
    secureCookies,
  )
  let images: unknown
  try {
    images = await fetchFigmaJson(
      options,
      sessionId,
      new URL(
        `/v1/files/${encodeURIComponent(key)}/images`,
        FIGMA_API_ORIGIN,
      ),
      `Figma 文件 ${key} 的图片引用`,
    )
  } catch (error) {
    invalidateSessionForError(
      error,
      sessionId,
      response,
      secureCookies,
      options,
    )
    throw error
  }
  const directImages =
    isRecord(images) && isRecord(images.images)
      ? images.images
      : null
  const nestedImages =
    isRecord(images)
    && isRecord(images.meta)
    && isRecord(images.meta.images)
      ? images.meta.images
      : null
  const hasEmptyImageMap =
    isRecord(images)
    && (
      images.images === null
      || (isRecord(images.meta) && images.meta.images === null)
    )
  const imageMap = directImages ?? nestedImages ?? (hasEmptyImageMap ? {} : null)

  if (!imageMap) {
    throw new ApiError({
      status: 502,
      code: 'FIGMA_IMAGES_RESPONSE_INVALID',
      message: `Figma 文件 ${key} 的图片引用响应格式无效。`,
    })
  }
  sendJson(response, 200, { images: imageMap })
}

function safeNodesQuery(searchParams: URLSearchParams) {
  const allowed = new Set(['ids', 'depth', 'geometry'])
  for (const name of searchParams.keys()) {
    if (!allowed.has(name)) {
      throw new ApiError({
        status: 400,
        code: 'UNSUPPORTED_FIGMA_QUERY',
        message: `不允许透传查询参数 ${name}。`,
      })
    }
  }

  const upstream = new URLSearchParams()
  upstream.set('ids', parseNodeIdsQuery(searchParams, true) ?? '')

  const depth = singleQueryValue(searchParams, 'depth')
  if (depth !== undefined) {
    if (!/^[1-9]\d{0,2}$/.test(depth)) {
      throw new ApiError({
        status: 400,
        code: 'INVALID_FIGMA_DEPTH',
        message: 'depth 必须是 1 到 999 的正整数。',
      })
    }
    upstream.set('depth', depth)
  }

  const geometry = singleQueryValue(searchParams, 'geometry')
  if (geometry !== undefined) {
    if (geometry !== 'paths') {
      throw new ApiError({
        status: 400,
        code: 'INVALID_FIGMA_GEOMETRY',
        message: 'geometry 仅允许设置为 paths。',
      })
    }
    upstream.set('geometry', geometry)
  }

  return upstream
}

function safeRendersQuery(searchParams: URLSearchParams) {
  const allowed = new Set(['ids', 'format', 'scale'])
  for (const name of searchParams.keys()) {
    if (!allowed.has(name)) {
      throw new ApiError({
        status: 400,
        code: 'UNSUPPORTED_FIGMA_QUERY',
        message: `不允许透传查询参数 ${name}。`,
      })
    }
  }

  const upstream = new URLSearchParams()
  upstream.set('ids', parseNodeIdsQuery(searchParams, true) ?? '')

  const format = singleQueryValue(searchParams, 'format') ?? 'png'
  if (format !== 'png' && format !== 'jpg') {
    throw new ApiError({
      status: 400,
      code: 'INVALID_FIGMA_RENDER_FORMAT',
      message: '图层预览仅支持 png 或 jpg。',
    })
  }
  upstream.set('format', format)

  const scale = singleQueryValue(searchParams, 'scale')
  if (scale !== undefined) {
    const numeric = Number(scale)
    if (!Number.isFinite(numeric) || numeric < 0.01 || numeric > 4) {
      throw new ApiError({
        status: 400,
        code: 'INVALID_FIGMA_RENDER_SCALE',
        message: 'scale 必须是 0.01 到 4 之间的数字。',
      })
    }
    upstream.set('scale', String(numeric))
  }

  return upstream
}

async function handleFileNodesRequest(
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
  options: FigmaOAuthPluginOptions,
  secureCookies: boolean,
) {
  const key = fileKeyFromFileSubpath(requestUrl.pathname, '/nodes')
  const query = safeNodesQuery(requestUrl.searchParams)
  const { sessionId } = await authenticatedSession(
    request,
    response,
    options,
    secureCookies,
  )
  const upstreamUrl = new URL(
    `/v1/files/${encodeURIComponent(key)}/nodes`,
    FIGMA_API_ORIGIN,
  )
  upstreamUrl.search = query.toString()
  let payload: unknown
  try {
    payload = await fetchFigmaJson(
      options,
      sessionId,
      upstreamUrl,
      `Figma 文件 ${key} 的图层`,
    )
  } catch (error) {
    invalidateSessionForError(
      error,
      sessionId,
      response,
      secureCookies,
      options,
    )
    throw error
  }
  if (!isRecord(payload) || !isRecord(payload.nodes)) {
    throw new ApiError({
      status: 502,
      code: 'FIGMA_NODES_RESPONSE_INVALID',
      message: `Figma 文件 ${key} 的图层响应格式无效。`,
    })
  }

  const nodes: Record<string, unknown> = {}
  for (const [nodeId, entry] of Object.entries(payload.nodes)) {
    if (isRecord(entry) && isRecord(entry.document)) {
      nodes[nodeId] = { document: entry.document }
    }
  }

  sendJson(response, 200, {
    name: typeof payload.name === 'string' ? payload.name : '',
    nodes,
  })
}

async function handleFileRendersRequest(
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
  options: FigmaOAuthPluginOptions,
  secureCookies: boolean,
) {
  const key = fileKeyFromFileSubpath(requestUrl.pathname, '/renders')
  const query = safeRendersQuery(requestUrl.searchParams)
  const { sessionId } = await authenticatedSession(
    request,
    response,
    options,
    secureCookies,
  )
  const upstreamUrl = new URL(
    `/v1/images/${encodeURIComponent(key)}`,
    FIGMA_API_ORIGIN,
  )
  upstreamUrl.search = query.toString()
  let payload: unknown
  try {
    payload = await fetchFigmaJson(
      options,
      sessionId,
      upstreamUrl,
      `Figma 文件 ${key} 的图层预览`,
    )
  } catch (error) {
    invalidateSessionForError(
      error,
      sessionId,
      response,
      secureCookies,
      options,
    )
    throw error
  }
  if (!isRecord(payload) || !isRecord(payload.images)) {
    throw new ApiError({
      status: 502,
      code: 'FIGMA_RENDER_RESPONSE_INVALID',
      message: `Figma 文件 ${key} 的图层预览响应格式无效。`,
    })
  }
  sendJson(response, 200, { images: payload.images })
}

async function handleMetadataRequest(
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
  options: FigmaOAuthPluginOptions,
  secureCookies: boolean,
) {
  const keys = metadataKeys(requestUrl.searchParams)
  const { sessionId } = await authenticatedSession(
    request,
    response,
    options,
    secureCookies,
  )

  const results = await Promise.all(
    keys.map(async (key) => {
      try {
        const metadata = await fetchFigmaJson(
          options,
          sessionId,
          new URL(
            `/v1/files/${encodeURIComponent(key)}/meta`,
            FIGMA_API_ORIGIN,
          ),
          `Figma 文件 ${key} 的 metadata`,
        )
        return {
          ok: true as const,
          file: normalizeFileMetadata(key, metadata),
        }
      } catch (error) {
        if (error instanceof ApiError && error.invalidatesSession) {
          invalidateSessionForError(
            error,
            sessionId,
            response,
            secureCookies,
            options,
          )
          throw error
        }
        const apiError =
          error instanceof ApiError
            ? error
            : new ApiError({
              status: 500,
              code: 'INTERNAL_ERROR',
              message: '读取 metadata 时发生了未预期的错误。',
            })
        return {
          ok: false as const,
          error: {
            key,
            status: apiError.status,
            error: apiError.code,
            message: apiError.message,
            ...(apiError.retryAfterSeconds === undefined
              ? {}
              : { retryAfterSeconds: apiError.retryAfterSeconds }),
          },
        }
      }
    }),
  )

  const files = results.flatMap((result) =>
    result.ok ? [result.file] : [],
  )
  const errors = results.flatMap((result) =>
    result.ok ? [] : [result.error],
  )
  sendJson(response, errors.length > 0 ? 207 : 200, {
    files,
    errors,
  })
}

function teamIdFromProjectsPath(pathname: string) {
  const match = pathname.match(
    new RegExp(`^${AUTH_PREFIX}/teams/([^/]+)/projects$`),
  )
  const teamId = match?.[1] ?? ''
  if (!SAFE_TEAM_ID.test(teamId)) {
    throw new ApiError({
      status: 400,
      code: 'INVALID_TEAM_ID',
      message: 'team_id 格式无效。请从 Figma team URL 复制纯数字 ID。',
    })
  }
  return teamId
}

function projectIdFromFilesPath(pathname: string) {
  const match = pathname.match(
    new RegExp(`^${AUTH_PREFIX}/projects/([^/]+)/files$`),
  )
  const projectId = match?.[1] ?? ''
  if (!SAFE_PROJECT_ID.test(projectId)) {
    throw new ApiError({
      status: 400,
      code: 'INVALID_PROJECT_ID',
      message: 'project_id 格式无效。',
    })
  }
  return projectId
}

async function handleTeamProjectsRequest(
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
  options: FigmaOAuthPluginOptions,
  secureCookies: boolean,
) {
  const teamId = teamIdFromProjectsPath(requestUrl.pathname)
  const { sessionId } = await authenticatedSession(
    request,
    response,
    options,
    secureCookies,
  )
  let payload: unknown
  try {
    payload = await fetchFigmaJson(
      options,
      sessionId,
      new URL(
        `/v1/teams/${encodeURIComponent(teamId)}/projects`,
        FIGMA_API_ORIGIN,
      ),
      `Team ${teamId} 的项目列表`,
    )
  } catch (error) {
    invalidateSessionForError(
      error,
      sessionId,
      response,
      secureCookies,
      options,
    )
    throw error
  }
  sendJson(response, 200, payload)
}

async function handleProjectFilesRequest(
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
  options: FigmaOAuthPluginOptions,
  secureCookies: boolean,
) {
  const projectId = projectIdFromFilesPath(requestUrl.pathname)
  const { sessionId } = await authenticatedSession(
    request,
    response,
    options,
    secureCookies,
  )
  let payload: unknown
  try {
    payload = await fetchFigmaJson(
      options,
      sessionId,
      new URL(
        `/v1/projects/${encodeURIComponent(projectId)}/files`,
        FIGMA_API_ORIGIN,
      ),
      `Project ${projectId} 的文件列表`,
    )
  } catch (error) {
    invalidateSessionForError(
      error,
      sessionId,
      response,
      secureCookies,
      options,
    )
    throw error
  }
  sendJson(response, 200, payload)
}

function teamIdsForRequest(options: FigmaOAuthPluginOptions, requestUrl: URL) {
  const fromQuery = requestUrl.searchParams.get('teamIds')
  const raw = fromQuery?.trim()
    ? fromQuery
    : readConfiguredTeamIds(options).join(',')
  return normalizeTeamIds(raw)
}

async function handleLibrarySyncRequest(
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
  options: FigmaOAuthPluginOptions,
  secureCookies: boolean,
) {
  const teamIds = teamIdsForRequest(options, requestUrl)
  if (teamIds.length === 0) {
    throw new ApiError({
      status: 400,
      code: 'TEAM_IDS_REQUIRED',
      message:
        '请先在首页「团队设置」中填写 Team ID 或 Figma 团队链接。team_id 无法通过 API 自动获取。',
    })
  }

  const { sessionId } = await authenticatedSession(
    request,
    response,
    options,
    secureCookies,
  )

  const files: SyncedFigmaFile[] = []
  const errors: Array<{
    scope: string
    message: string
    code?: string
  }> = []

  for (const teamId of teamIds) {
    let projectsPayload: unknown
    try {
      projectsPayload = await fetchFigmaJson(
        options,
        sessionId,
        new URL(
          `/v1/teams/${encodeURIComponent(teamId)}/projects`,
          FIGMA_API_ORIGIN,
        ),
        `Team ${teamId} 的项目列表`,
      )
    } catch (error) {
      if (error instanceof ApiError && error.invalidatesSession) {
        invalidateSessionForError(
          error,
          sessionId,
          response,
          secureCookies,
          options,
        )
        throw error
      }
      errors.push({
        scope: `team:${teamId}`,
        message:
          error instanceof Error ? error.message : '读取项目列表失败',
        code: error instanceof ApiError ? error.code : undefined,
      })
      continue
    }

    const projects =
      isRecord(projectsPayload) && Array.isArray(projectsPayload.projects)
        ? projectsPayload.projects
        : []

    for (const project of projects) {
      if (!isRecord(project)) continue
      const projectId = String(project.id ?? '')
      const projectName = String(project.name ?? '未命名项目')
      if (!SAFE_PROJECT_ID.test(projectId)) continue

      let filesPayload: unknown
      try {
        filesPayload = await fetchFigmaJson(
          options,
          sessionId,
          new URL(
            `/v1/projects/${encodeURIComponent(projectId)}/files`,
            FIGMA_API_ORIGIN,
          ),
          `Project ${projectId} 的文件列表`,
        )
      } catch (error) {
        if (error instanceof ApiError && error.invalidatesSession) {
          invalidateSessionForError(
            error,
            sessionId,
            response,
            secureCookies,
            options,
          )
          throw error
        }
        errors.push({
          scope: `project:${projectId}`,
          message:
            error instanceof Error ? error.message : '读取文件列表失败',
          code: error instanceof ApiError ? error.code : undefined,
        })
        continue
      }

      const projectFiles =
        isRecord(filesPayload) && Array.isArray(filesPayload.files)
          ? filesPayload.files
          : []

      for (const file of projectFiles) {
        if (!isRecord(file)) continue
        const key = String(file.key ?? '')
        if (!SAFE_FILE_KEY.test(key)) continue
        files.push({
          key,
          name: String(file.name ?? key),
          url: `https://www.figma.com/design/${encodeURIComponent(key)}`,
          thumbnailUrl:
            typeof file.thumbnail_url === 'string'
              ? file.thumbnail_url
              : undefined,
          lastModified:
            typeof file.last_modified === 'string'
              ? file.last_modified
              : undefined,
          projectId,
          projectName,
          teamId,
        })
        if (files.length >= MAX_SYNC_FILES) break
      }
      if (files.length >= MAX_SYNC_FILES) break
    }
    if (files.length >= MAX_SYNC_FILES) break
  }

  // Enrich missing thumbnails via /meta in small batches.
  const missing = files.filter((file) => !file.thumbnailUrl).slice(0, 20)
  for (let i = 0; i < missing.length; i += SYNC_METADATA_BATCH) {
    const batch = missing.slice(i, i + SYNC_METADATA_BATCH)
    await Promise.all(
      batch.map(async (file) => {
        try {
          const metadata = await fetchFigmaJson(
            options,
            sessionId,
            new URL(
              `/v1/files/${encodeURIComponent(file.key)}/meta`,
              FIGMA_API_ORIGIN,
            ),
            `Figma 文件 ${file.key} 的 metadata`,
          )
          const normalized = normalizeFileMetadata(file.key, metadata)
          if (normalized.thumbnailUrl) file.thumbnailUrl = normalized.thumbnailUrl
          if (normalized.lastModified) file.lastModified = normalized.lastModified
          if (normalized.name) file.name = normalized.name
        } catch {
          // thumbnail enrichment is best-effort
        }
      }),
    )
  }

  sendJson(response, errors.length > 0 ? 207 : 200, {
    teamIds,
    files,
    truncated: files.length >= MAX_SYNC_FILES,
    errors,
  })
}

function handleLibraryConfigRequest(
  response: ServerResponse,
  options: FigmaOAuthPluginOptions,
) {
  const teamIds = readConfiguredTeamIds(options)
  sendJson(response, 200, {
    teamIds,
    configured: teamIds.length > 0,
    maxFiles: MAX_SYNC_FILES,
  })
}

async function handleLibraryConfigUpdate(
  request: IncomingMessage,
  response: ServerResponse,
  options: FigmaOAuthPluginOptions,
  _secureCookies: boolean,
) {
  const payload = await readJsonBody(request)
  if (!isRecord(payload)) {
    throw new ApiError({
      status: 400,
      code: 'INVALID_CONFIG',
      message: '团队同步配置格式不正确。',
    })
  }
  const incoming = normalizeTeamIds(payload.teamIds)
  const previous = readConfiguredTeamIds(options)
  const teamIds = payload.merge === true
    ? [...new Set([...previous, ...incoming])]
    : incoming
  persistConfiguredTeamIds(teamIds)

  sendJson(response, 200, {
    teamIds,
    configured: teamIds.length > 0,
    maxFiles: MAX_SYNC_FILES,
    reauthorize: false,
  })
}

async function handleOAuthRequest(
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
  options: FigmaOAuthPluginOptions,
  secureCookies: boolean,
) {
  removeExpiredState(options)
  const { pathname } = requestUrl

  if (request.method === 'GET' && pathname === `${AUTH_PREFIX}/handoff`) {
    // The claim cookie stays in the initiating app; it is never in the browser URL.
    const id = parseCookies(request).get(HANDOFF_COOKIE)
    const handoff = id ? handoffs.get(id) : undefined
    if (!handoff) {
      sendJson(response, 410, { error: 'AUTH_HANDOFF_EXPIRED' })
      return
    }
    if (!handoff.result) {
      sendJson(response, 200, { pending: true })
      return
    }
    const result = handoff.sessionId && !sessions.has(handoff.sessionId) ? 'expired' : handoff.result
    response.setHeader('Set-Cookie', [
      serializeCookie(HANDOFF_COOKIE, '', { maxAge: 0, secure: secureCookies }),
      ...(result === 'connected' && handoff.sessionId ? [sessionCookie(handoff.sessionId, secureCookies)] : []),
    ])
    handoffs.delete(id!)
    sendJson(response, 200, { redirect: returnToWithResult(handoff.returnTo, result) })
    return
  }

  if (
    request.method === 'GET'
    && pathname === `${AUTH_PREFIX}/session`
  ) {
    await handleSessionRequest(
      request,
      response,
      options,
      secureCookies,
    )
    return
  }

  if (
    request.method === 'GET'
    && pathname === `${AUTH_PREFIX}/start`
  ) {
    await handleStartRequest(
      response,
      requestUrl,
      options,
      secureCookies,
    )
    return
  }

  if (
    request.method === 'GET'
    && pathname === `${AUTH_PREFIX}/callback`
  ) {
    await handleCallbackRequest(
      request,
      response,
      requestUrl,
      options,
      secureCookies,
    )
    return
  }

  if (
    request.method === 'DELETE'
    && pathname === `${AUTH_PREFIX}/session`
  ) {
    const sessionId = parseCookies(request).get(SESSION_COOKIE)
    if (sessionId) {
      sessions.delete(sessionId)
      refreshes.delete(sessionId)
      persistSessions(options)
    }
    response.setHeader('Set-Cookie', clearedSessionCookie(secureCookies))
    setNoStore(response)
    response.statusCode = 204
    response.end()
    return
  }

  if (
    request.method === 'GET'
    && pathname.startsWith(`${AUTH_PREFIX}/files/`)
    && pathname.endsWith('/images')
  ) {
    await handleFileImagesRequest(
      request,
      response,
      requestUrl,
      options,
      secureCookies,
    )
    return
  }

  if (
    request.method === 'GET'
    && pathname.startsWith(`${AUTH_PREFIX}/files/`)
    && pathname.endsWith('/nodes')
  ) {
    await handleFileNodesRequest(
      request,
      response,
      requestUrl,
      options,
      secureCookies,
    )
    return
  }

  if (
    request.method === 'GET'
    && pathname.startsWith(`${AUTH_PREFIX}/files/`)
    && pathname.endsWith('/renders')
  ) {
    await handleFileRendersRequest(
      request,
      response,
      requestUrl,
      options,
      secureCookies,
    )
    return
  }

  if (
    request.method === 'GET'
    && pathname.startsWith(`${AUTH_PREFIX}/files/`)
  ) {
    await handleFileRequest(
      request,
      response,
      requestUrl,
      options,
      secureCookies,
    )
    return
  }

  if (
    request.method === 'GET'
    && pathname === `${AUTH_PREFIX}/file-metadata`
  ) {
    await handleMetadataRequest(
      request,
      response,
      requestUrl,
      options,
      secureCookies,
    )
    return
  }

  if (
    request.method === 'GET'
    && pathname === `${AUTH_PREFIX}/library/config`
  ) {
    handleLibraryConfigRequest(response, options)
    return
  }

  if (
    request.method === 'POST'
    && pathname === `${AUTH_PREFIX}/library/config`
  ) {
    await handleLibraryConfigUpdate(
      request,
      response,
      options,
      secureCookies,
    )
    return
  }

  if (
    request.method === 'GET'
    && pathname === `${AUTH_PREFIX}/library/sync`
  ) {
    await handleLibrarySyncRequest(
      request,
      response,
      requestUrl,
      options,
      secureCookies,
    )
    return
  }

  if (
    request.method === 'GET'
    && /^\/api\/auth\/figma\/teams\/[^/]+\/projects$/.test(pathname)
  ) {
    await handleTeamProjectsRequest(
      request,
      response,
      requestUrl,
      options,
      secureCookies,
    )
    return
  }

  if (
    request.method === 'GET'
    && /^\/api\/auth\/figma\/projects\/[^/]+\/files$/.test(pathname)
  ) {
    await handleProjectFilesRequest(
      request,
      response,
      requestUrl,
      options,
      secureCookies,
    )
    return
  }

  const knownPath =
    pathname === `${AUTH_PREFIX}/session`
    || pathname === `${AUTH_PREFIX}/start`
    || pathname === `${AUTH_PREFIX}/callback`
    || pathname === `${AUTH_PREFIX}/file-metadata`
    || pathname === `${AUTH_PREFIX}/library/config`
    || pathname.startsWith(`${AUTH_PREFIX}/files/`)
  if (knownPath) {
    response.setHeader('Allow', 'GET, DELETE')
    throw new ApiError({
      status: 405,
      code: 'METHOD_NOT_ALLOWED',
      message: '该 Figma OAuth API 不支持此 HTTP 方法。',
    })
  }

  throw new ApiError({
    status: 404,
    code: 'NOT_FOUND',
    message: '未找到对应的 Figma OAuth API。',
  })
}

export function createFigmaOAuthMiddleware(
  options: FigmaOAuthPluginOptions,
): Middleware {
  restorePendingFlows()
  restoreSessions(options)
  const secureCookies = options.redirectUri.startsWith('https://')

  return (request, response, next) => {
    if (!request.url) {
      next()
      return
    }

    let requestUrl: URL
    try {
      requestUrl = new URL(request.url, LOCAL_REDIRECT_ORIGIN)
    } catch {
      next()
      return
    }

    if (
      requestUrl.pathname !== AUTH_PREFIX
      && !requestUrl.pathname.startsWith(`${AUTH_PREFIX}/`)
    ) {
      next()
      return
    }

    void handleOAuthRequest(
      request,
      response,
      requestUrl,
      options,
      secureCookies,
    ).catch((error: unknown) => {
      if (!response.writableEnded) sendApiError(response, error)
    })
  }
}

export function figmaOAuthPlugin(
  options: FigmaOAuthPluginOptions,
): Plugin {
  const middleware = createFigmaOAuthMiddleware(options)

  return {
    name: 'design-studio-figma-oauth',
    configureServer(server) {
      server.middlewares.use(middleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware)
    },
  }
}
