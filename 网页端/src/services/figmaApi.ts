import type {
  FigmaFileImagesResponse,
  FigmaFileReference,
  FigmaFileResponse,
  FigmaNode,
  ImportedFigmaFile,
} from '../types/figma'

/**
 * Browser-to-local-proxy authentication contract:
 *
 * - Requests default to `/api/figma/files/:key`.
 * - The personal access token is sent as `X-Design-Studio-Figma-Token`.
 * - The local proxy must remove that private header and set `X-Figma-Token`
 *   only on the upstream `https://api.figma.com/v1/...` request.
 * - A proxy that explicitly accepts the upstream header can opt into
 *   `tokenHeaderName: 'X-Figma-Token'`.
 *
 * Keeping this configurable supports production serverless proxies while
 * avoiding tokens in URLs, logs, and browser bundles.
 */
export const DEFAULT_FIGMA_PROXY_BASE_URL = '/api/figma'
export const DEFAULT_FIGMA_PROXY_TOKEN_HEADER = 'X-Design-Studio-Figma-Token'
export const FIGMA_UPSTREAM_TOKEN_HEADER = 'X-Figma-Token'

export interface ImportFigmaFileInput {
  urlOrKey: string
  token: string
  /** Proxy root mapped to `https://api.figma.com/v1`. */
  baseUrl?: string
  /** Defaults to the private browser-to-proxy header documented above. */
  tokenHeaderName?: string
  signal?: AbortSignal
  fetchImpl?: typeof fetch
}

export interface ImportFigmaFileWithOAuthInput {
  urlOrKey: string
  signal?: AbortSignal
  fetchImpl?: typeof fetch
}

export interface FigmaApiClientConfig {
  token: string
  baseUrl?: string
  tokenHeaderName?: string
  fetchImpl?: typeof fetch
}

export interface FigmaRequestOptions {
  signal?: AbortSignal
}

export class FigmaReferenceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FigmaReferenceError'
  }
}

export class FigmaApiError extends Error {
  readonly status: number
  readonly endpoint: string
  readonly retryAfterSeconds?: number
  readonly responseBody?: unknown

  constructor(options: {
    message: string
    status: number
    endpoint: string
    retryAfterSeconds?: number
    responseBody?: unknown
  }) {
    super(options.message)
    this.name = 'FigmaApiError'
    this.status = options.status
    this.endpoint = options.endpoint
    this.retryAfterSeconds = options.retryAfterSeconds
    this.responseBody = options.responseBody
  }
}

const FILE_ROUTE_NAMES = new Set(['file', 'design', 'proto', 'board', 'slides'])
const SAFE_FILE_KEY = /^[A-Za-z0-9_-]{6,256}$/
const SAFE_HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/

function safelyDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    throw new FigmaReferenceError('Figma 链接包含无效的 URL 编码。')
  }
}

export function normalizeFigmaNodeId(value: string | null | undefined): string | undefined {
  if (!value) return undefined
  const decoded = safelyDecode(value).trim()
  if (!decoded) return undefined

  // Figma share URLs encode the API node id `123:456` as `123-456`.
  const urlForm = decoded.match(/^(\d+)-(\d+)$/)
  return urlForm ? `${urlForm[1]}:${urlForm[2]}` : decoded
}

function validateFileKey(key: string): string {
  const trimmed = key.trim()
  if (!SAFE_FILE_KEY.test(trimmed)) {
    throw new FigmaReferenceError('Figma 文件 key 无效，请粘贴完整的 Figma 文件链接或文件 key。')
  }
  return trimmed
}

function getNodeIdFromUrl(url: URL): string | undefined {
  const fromQuery = url.searchParams.get('node-id') ?? url.searchParams.get('node_id')
  if (fromQuery) return normalizeFigmaNodeId(fromQuery)

  const hash = url.hash.slice(1)
  if (!hash) return undefined
  const hashQuery = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : hash
  const hashParams = new URLSearchParams(hashQuery)
  return normalizeFigmaNodeId(hashParams.get('node-id') ?? hashParams.get('node_id'))
}

/**
 * Parses current and legacy Figma URLs (`/design`, `/file`, `/proto`,
 * `/board`, `/slides`) or a bare file key. A URL node id is normalized from
 * `123-456` to the REST representation `123:456`.
 */
export function parseFigmaReference(urlOrKey: string): FigmaFileReference {
  const input = urlOrKey.trim()
  if (!input) {
    throw new FigmaReferenceError('请输入 Figma 文件链接或文件 key。')
  }

  if (/^https?:\/\//i.test(input)) {
    let url: URL
    try {
      url = new URL(input)
    } catch {
      throw new FigmaReferenceError('Figma 文件链接格式无效。')
    }

    const hostname = url.hostname.toLowerCase()
    if (hostname !== 'figma.com' && !hostname.endsWith('.figma.com')) {
      throw new FigmaReferenceError('链接不是 figma.com 的文件链接。')
    }

    const segments = url.pathname.split('/').filter(Boolean)
    const routeIndex = segments.findIndex((segment) => FILE_ROUTE_NAMES.has(segment.toLowerCase()))
    const key = routeIndex >= 0 ? segments[routeIndex + 1] : undefined
    if (!key) {
      throw new FigmaReferenceError('链接中没有找到 Figma 文件 key。')
    }

    return {
      key: validateFileKey(safelyDecode(key)),
      nodeId: getNodeIdFromUrl(url),
    }
  }

  // Also accept a copied `key?node-id=123-456` without the Figma origin.
  const queryIndex = input.indexOf('?')
  const rawKey = queryIndex === -1 ? input : input.slice(0, queryIndex)
  const params = queryIndex === -1 ? undefined : new URLSearchParams(input.slice(queryIndex + 1))
  return {
    key: validateFileKey(rawKey),
    nodeId: normalizeFigmaNodeId(params?.get('node-id') ?? params?.get('node_id')),
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '')
  if (!normalized) throw new Error('Figma proxy baseUrl 不能为空。')
  return normalized
}

function validateTokenHeaderName(name: string): string {
  const trimmed = name.trim()
  if (!SAFE_HEADER_NAME.test(trimmed)) {
    throw new Error('Figma token header 名称无效。')
  }
  return trimmed
}

function statusMessage(status: number, retryAfterSeconds?: number): string {
  switch (status) {
    case 401:
      return 'Figma 令牌无效或已过期，请更新 Personal Access Token。'
    case 403:
      return '当前 Figma 令牌没有读取该文件的权限。'
    case 404:
      return '未找到 Figma 文件，请检查链接、文件 key 或访问权限。'
    case 429:
      return retryAfterSeconds === undefined
        ? 'Figma API 请求过于频繁，请稍后重试。'
        : `Figma API 请求过于频繁，请在 ${retryAfterSeconds} 秒后重试。`
    default:
      return `读取 Figma 文件失败（HTTP ${status}）。`
  }
}

function retryAfterSeconds(response: Response): number | undefined {
  const raw = response.headers.get('Retry-After')
  if (!raw) return undefined
  const seconds = Number(raw)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds)

  const date = Date.parse(raw)
  if (Number.isNaN(date)) return undefined
  return Math.max(0, Math.ceil((date - Date.now()) / 1000))
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertFileResponse(value: unknown, endpoint: string): asserts value is FigmaFileResponse {
  if (
    !isRecord(value)
    || typeof value.name !== 'string'
    || !isRecord(value.document)
    || typeof value.document.id !== 'string'
    || typeof value.document.type !== 'string'
  ) {
    throw new FigmaApiError({
      message: 'Figma 文件接口返回了无法识别的数据。',
      status: 502,
      endpoint,
      responseBody: value,
    })
  }
}

function normalizeImagesResponse(
  value: unknown,
  endpoint: string,
): FigmaFileImagesResponse {
  const directImages =
    isRecord(value) && isRecord(value.images)
      ? value.images
      : null
  const nestedImages =
    isRecord(value)
    && isRecord(value.meta)
    && isRecord(value.meta.images)
      ? value.meta.images
      : null
  const hasEmptyImageMap =
    isRecord(value)
    && (
      value.images === null
      || (isRecord(value.meta) && value.meta.images === null)
    )
  const images = directImages ?? nestedImages ?? (hasEmptyImageMap ? {} : null)

  if (images) {
    return { images: images as Record<string, string | null> }
  }

  throw new FigmaApiError({
    message: 'Figma 图片接口返回了无法识别的数据。',
    status: 502,
    endpoint,
    responseBody: value,
  })
}

function nonNullImages(images: Record<string, string | null>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(images).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  )
}

export class FigmaApiClient {
  private readonly baseUrl: string
  private readonly token: string
  private readonly tokenHeaderName: string
  private readonly fetchImpl: typeof fetch

  constructor(config: FigmaApiClientConfig) {
    this.baseUrl = normalizeBaseUrl(config.baseUrl ?? DEFAULT_FIGMA_PROXY_BASE_URL)
    this.token = config.token.trim()
    if (!this.token) throw new Error('Figma Personal Access Token 不能为空。')
    this.tokenHeaderName = validateTokenHeaderName(
      config.tokenHeaderName ?? DEFAULT_FIGMA_PROXY_TOKEN_HEADER,
    )
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch.bind(globalThis)
  }

  private async getJson(route: string, options: FigmaRequestOptions = {}): Promise<unknown> {
    const endpoint = `${this.baseUrl}${route}`
    let response: Response
    try {
      response = await this.fetchImpl(endpoint, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          [this.tokenHeaderName]: this.token,
        },
        credentials: 'same-origin',
        signal: options.signal,
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error
      throw new FigmaApiError({
        message: '无法连接 Figma 代理服务，请确认本地服务正在运行。',
        status: 0,
        endpoint,
        responseBody: error,
      })
    }

    const body = await readResponseBody(response)
    if (!response.ok) {
      const retryAfter = retryAfterSeconds(response)
      throw new FigmaApiError({
        message: statusMessage(response.status, retryAfter),
        status: response.status,
        endpoint,
        retryAfterSeconds: retryAfter,
        responseBody: body,
      })
    }
    return body
  }

  async getFile(key: string, options: FigmaRequestOptions = {}): Promise<FigmaFileResponse> {
    const safeKey = validateFileKey(key)
    const endpoint = `${this.baseUrl}/files/${encodeURIComponent(safeKey)}?geometry=paths`
    const value = await this.getJson(
      `/files/${encodeURIComponent(safeKey)}?geometry=paths`,
      options,
    )
    assertFileResponse(value, endpoint)
    return value
  }

  async getFileImages(
    key: string,
    options: FigmaRequestOptions = {},
  ): Promise<Record<string, string>> {
    const safeKey = validateFileKey(key)
    const endpoint = `${this.baseUrl}/files/${encodeURIComponent(safeKey)}/images`
    const value = await this.getJson(`/files/${encodeURIComponent(safeKey)}/images`, options)
    return nonNullImages(normalizeImagesResponse(value, endpoint).images)
  }

  async importFile(
    urlOrKey: string,
    options: FigmaRequestOptions = {},
  ): Promise<ImportedFigmaFile> {
    const reference = parseFigmaReference(urlOrKey)
    const [file, images] = await Promise.all([
      this.getFile(reference.key, options),
      this.getFileImages(reference.key, options),
    ])
    return { ...reference, file, images }
  }
}

/**
 * One-shot import contract used by the UI.
 *
 * It loads the full node tree with `geometry=paths` and resolves every Figma
 * image reference in parallel through `GET /v1/files/:key/images`.
 */
export async function importFigmaFile(
  input: ImportFigmaFileInput,
): Promise<ImportedFigmaFile> {
  const client = new FigmaApiClient(input)
  return client.importFile(input.urlOrKey, { signal: input.signal })
}

async function getOAuthFigmaJson(
  endpoint: string,
  signal: AbortSignal | undefined,
  fetchImpl: typeof fetch,
) {
  let response: Response
  try {
    response = await fetchImpl(endpoint, {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new FigmaApiError({
      message: '无法连接 Figma OAuth 服务，请确认本地服务正在运行。',
      status: 0,
      endpoint,
      responseBody: error,
    })
  }

  const body = await readResponseBody(response)
  if (!response.ok) {
    const serverMessage =
      body && typeof body === 'object' && 'message' in body
        && typeof body.message === 'string'
        ? body.message
        : undefined
    const retryAfter = retryAfterSeconds(response)
    throw new FigmaApiError({
      message: serverMessage ?? statusMessage(response.status, retryAfter),
      status: response.status,
      endpoint,
      retryAfterSeconds: retryAfter,
      responseBody: body,
    })
  }
  return body
}

/**
 * Imports a file through the server-side OAuth session. No access token is
 * exposed to the browser; the HttpOnly session cookie authenticates both
 * requests.
 */
export async function importFigmaFileWithOAuth(
  input: ImportFigmaFileWithOAuthInput,
): Promise<ImportedFigmaFile> {
  const reference = parseFigmaReference(input.urlOrKey)
  const fetchImpl = input.fetchImpl ?? globalThis.fetch.bind(globalThis)
  const encodedKey = encodeURIComponent(reference.key)
  const fileEndpoint =
    `/api/auth/figma/files/${encodedKey}?geometry=paths`
  const imagesEndpoint = `/api/auth/figma/files/${encodedKey}/images`

  const [fileValue, imagesValue] = await Promise.all([
    getOAuthFigmaJson(fileEndpoint, input.signal, fetchImpl),
    getOAuthFigmaJson(imagesEndpoint, input.signal, fetchImpl),
  ])
  assertFileResponse(fileValue, fileEndpoint)
  const images = normalizeImagesResponse(imagesValue, imagesEndpoint)

  return {
    ...reference,
    file: fileValue,
    images: nonNullImages(images.images),
  }
}

/** Depth-first lookup useful when a pasted URL includes `node-id`. */
export function findFigmaNode(root: FigmaNode, nodeId: string): FigmaNode | undefined {
  if (root.id === nodeId) return root
  for (const child of root.children ?? []) {
    const match = findFigmaNode(child, nodeId)
    if (match) return match
  }
  return undefined
}

export type FigmaNodesResponse = {
  name: string
  nodes: Record<string, { document: FigmaNode }>
}

/**
 * Reads specific nodes through the OAuth session. Used to turn a Figma URL
 * `node-id` into a named layer chip without any plugin.
 */
export async function fetchFigmaNodesWithOAuth(input: {
  fileKey: string
  nodeIds: string[]
  signal?: AbortSignal
  fetchImpl?: typeof fetch
}): Promise<FigmaNodesResponse> {
  const fetchImpl = input.fetchImpl ?? globalThis.fetch.bind(globalThis)
  const ids = input.nodeIds
    .map((id) => normalizeFigmaNodeId(id))
    .filter((id): id is string => Boolean(id))
  if (ids.length === 0) {
    throw new FigmaReferenceError('缺少有效的 Figma 图层 id。')
  }

  const endpoint =
    `/api/auth/figma/files/${encodeURIComponent(input.fileKey)}/nodes`
    + `?ids=${encodeURIComponent(ids.join(','))}`
  const value = await getOAuthFigmaJson(endpoint, input.signal, fetchImpl)
  if (
    !isRecord(value)
    || !isRecord(value.nodes)
  ) {
    throw new FigmaApiError({
      message: 'Figma 图层接口返回了无法识别的数据。',
      status: 502,
      endpoint,
      responseBody: value,
    })
  }

  const nodes: Record<string, { document: FigmaNode }> = {}
  for (const [nodeId, entry] of Object.entries(value.nodes)) {
    if (isRecord(entry) && isRecord(entry.document) && typeof entry.document.id === 'string') {
      nodes[nodeId] = { document: entry.document as unknown as FigmaNode }
    }
  }

  return {
    name: typeof value.name === 'string' ? value.name : '',
    nodes,
  }
}

export async function fetchFigmaNodeRendersWithOAuth(input: {
  fileKey: string
  nodeIds: string[]
  signal?: AbortSignal
  fetchImpl?: typeof fetch
}): Promise<Record<string, string>> {
  const fetchImpl = input.fetchImpl ?? globalThis.fetch.bind(globalThis)
  const ids = input.nodeIds
    .map((id) => normalizeFigmaNodeId(id))
    .filter((id): id is string => Boolean(id))
  if (ids.length === 0) return {}

  const endpoint =
    `/api/auth/figma/files/${encodeURIComponent(input.fileKey)}/renders`
    + `?ids=${encodeURIComponent(ids.join(','))}&format=png&scale=2`
  const value = await getOAuthFigmaJson(endpoint, input.signal, fetchImpl)
  return nonNullImages(normalizeImagesResponse(value, endpoint).images)
}
