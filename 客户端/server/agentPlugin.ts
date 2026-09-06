import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import type { Plugin } from 'vite'
import { createClaudeRuntime } from './agent/claudeRuntime'
import { createCodexRuntime } from './agent/codexRuntime'
import { createHermesRuntime } from './agent/hermesRuntime'
import { createShellRuntime } from './agent/shellRuntime'
import type { AgentRuntime, AgentRunInput } from './agent/types'
import { whichBin } from './agent/whichBin'
import {
  sanitizeAttachment,
  sanitizeBackend,
  sanitizeContextItem,
  sanitizeInstruction,
  saveUploadedFiles,
} from './agent/composer'
import { collectStatusSnapshot, getBackendProbes } from './agent/statusSnapshot'
import { publicRuntimeError } from './agent/runtimeErrors'
import { skillBody } from './agent/skills'
import {
  getBridgeCommandResult,
  tryEnqueueNaturalLanguageInstruction,
} from './figmaBridgePlugin'
import type { FigmaSelectedNode, FigmaSelectionSnapshot } from '../src/types/figmaWrite'

const AGENT_PREFIX = '/api/agent'

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

export type AgentPluginOptions = {
  /** auto | codex | claude | hermes | shell */
  backend: 'auto' | 'codex' | 'claude' | 'hermes' | 'shell'
  model: string
  cwd?: string
  allowDemoFallback?: boolean
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
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sanitizeSelectedNode(value: unknown): FigmaSelectedNode | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string') {
    return null
  }
  const type = typeof value.type === 'string' && value.type ? value.type : 'NODE'
  return {
    id: value.id.slice(0, 200),
    name: value.name.slice(0, 200),
    type: type.slice(0, 80),
    visible: value.visible !== false,
    locked: Boolean(value.locked),
    opacity: typeof value.opacity === 'number' ? value.opacity : undefined,
    x: typeof value.x === 'number' ? value.x : undefined,
    y: typeof value.y === 'number' ? value.y : undefined,
    width: typeof value.width === 'number' ? value.width : undefined,
    height: typeof value.height === 'number' ? value.height : undefined,
    characters: typeof value.characters === 'string'
      ? value.characters.slice(0, 4_000)
      : undefined,
    supports: {
      text: type === 'TEXT',
      fill: true,
      opacity: true,
      resize: true,
      move: true,
      visibility: true,
      rename: true,
    },
  }
}

function sanitizeSelection(value: unknown): FigmaSelectionSnapshot | undefined {
  if (!isRecord(value) || !Array.isArray(value.nodes)) return undefined
  const nodes = value.nodes
    .slice(0, 20)
    .map(sanitizeSelectedNode)
    .filter((node): node is FigmaSelectedNode => node !== null)
  if (nodes.length === 0 && (
    value.nodes.length > 0
    || typeof value.sessionId !== 'string'
    || !value.sessionId.trim()
  )) return undefined
  return {
    sessionId: typeof value.sessionId === 'string' && value.sessionId
      ? value.sessionId.slice(0, 200)
      : 'oauth',
    fileKey: typeof value.fileKey === 'string' ? value.fileKey.slice(0, 256) : undefined,
    documentName: typeof value.documentName === 'string'
      ? value.documentName.slice(0, 200)
      : undefined,
    pageId: typeof value.pageId === 'string' ? value.pageId.slice(0, 200) : 'current',
    pageName: typeof value.pageName === 'string' ? value.pageName.slice(0, 200) : '当前页面',
    revision: typeof value.revision === 'number' && Number.isFinite(value.revision)
      ? value.revision
      : Date.now(),
    updatedAt: typeof value.updatedAt === 'number' && Number.isFinite(value.updatedAt)
      ? value.updatedAt
      : Date.now(),
    nodes,
  }
}

function writeSse(
  response: ServerResponse,
  event: string,
  data: unknown,
) {
  response.write(`event: ${event}\n`)
  response.write(`data: ${JSON.stringify(data)}\n\n`)
}

function prefersHermesModel(model: string | undefined) {
  const value = (model ?? '').toLowerCase()
  return value.includes('gemini') || value.includes('qwen')
}

function createRuntime(
  kind: 'codex' | 'claude' | 'hermes' | 'shell',
  options: AgentPluginOptions,
  model?: string,
): AgentRuntime | null {
  const cwd = options.cwd ?? process.cwd()
  const resolvedModel = model || options.model
  if (kind === 'shell') return createShellRuntime()
  if (kind === 'codex') {
    const bin = whichBin('codex')
    if (!bin) return null
    return createCodexRuntime({ bin, model: resolvedModel, cwd })
  }
  if (kind === 'hermes') {
    const bin = whichBin('hermes')
    if (!bin) return null
    return createHermesRuntime({ bin, model: resolvedModel, cwd })
  }
  try {
    return createClaudeRuntime({
      model: resolvedModel || 'haiku',
      cwd,
    })
  } catch {
    return null
  }
}

function createUnavailableRuntime(): AgentRuntime {
  return {
    meta: {
      mode: 'local',
      model: 'unavailable',
      shell: false,
      backend: 'unavailable',
    },
    async *run() {
      throw new Error('没有可用的真实 Agent。请先登录 Codex、Claude 或 Hermes。')
    },
  }
}

function runtimeChain(
  options: AgentPluginOptions,
  model?: string,
  preferred?: AgentRunInput['backend'],
): AgentRuntime[] {
  if (process.env.AGENT_SHELL_ONLY === '1' || options.backend === 'shell' || preferred === 'shell') {
    return [createShellRuntime()]
  }
  let order: Array<'codex' | 'claude' | 'hermes' | 'shell'> =
    options.backend === 'codex'
      ? ['codex', 'claude', 'hermes']
      : options.backend === 'claude'
        ? ['claude', 'codex', 'hermes']
        : options.backend === 'hermes'
          ? ['hermes', 'codex', 'claude']
          : prefersHermesModel(model)
            ? ['hermes', 'codex', 'claude']
            : ['codex', 'claude', 'hermes']
  if (options.allowDemoFallback) order.push('shell')
  if (preferred) {
    order = [preferred, ...order.filter((item) => item !== preferred)]
  }

  const seen = new Set<string>()
  const runtimes: AgentRuntime[] = []
  for (const kind of order) {
    const runtime = createRuntime(kind, options, model)
    if (!runtime || seen.has(runtime.meta.backend)) continue
    seen.add(runtime.meta.backend)
    runtimes.push(runtime)
  }
  return runtimes.length > 0 ? runtimes : [createUnavailableRuntime()]
}

function resolveRuntime(options: AgentPluginOptions, model?: string): AgentRuntime {
  return runtimeChain(options, model)[0]
}

function backendKindOf(runtime: AgentRuntime): 'codex' | 'claude' | 'hermes' | 'shell' | 'other' {
  if (runtime.meta.backend === 'codex-cli') return 'codex'
  if (runtime.meta.backend === 'claude-agent-sdk') return 'claude'
  if (runtime.meta.backend === 'hermes-agent') return 'hermes'
  if (runtime.meta.backend === 'local-shell') return 'shell'
  return 'other'
}

async function readyRuntimeChain(
  options: AgentPluginOptions,
  model?: string,
  preferred?: AgentRunInput['backend'],
): Promise<AgentRuntime[]> {
  const chain = runtimeChain(options, model, preferred)
  const probes = await getBackendProbes()
  const usable = chain.filter((runtime) => {
    const kind = backendKindOf(runtime)
    if (kind === 'codex') return probes.codex.installed
    if (kind === 'claude') return probes.claude.installed
    if (kind === 'hermes') return probes.hermes.installed
    if (kind === 'shell') {
      return options.allowDemoFallback === true || preferred === 'shell' || options.backend === 'shell'
    }
    return true
  })
  const authenticated = usable.filter((runtime) => {
    const kind = backendKindOf(runtime)
    if (kind === 'codex') return probes.codex.authenticated
    if (kind === 'claude') return probes.claude.authenticated
    if (kind === 'hermes') return probes.hermes.authenticated
    return kind === 'shell' || kind === 'other'
  })
  const chosen = authenticated.length > 0 ? authenticated : usable
  return chosen.length > 0 ? chosen : [createUnavailableRuntime()]
}

async function waitForBridgeCommand(commandId: string) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const current = getBridgeCommandResult(commandId)
    if (current && !current.pending) return current.result
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  return undefined
}

async function handleChatRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: AgentPluginOptions,
) {
  if (request.method === 'OPTIONS') {
    response.statusCode = 204
    setCorsHeaders(request, response)
    response.end()
    return
  }

  if (request.method !== 'POST') {
    sendJson(request, response, 405, { error: 'Method Not Allowed' })
    return
  }

  let body: {
    message?: string
    skill?: string
    model?: string
    source?: AgentRunInput['source']
    selection?: unknown
    attachments?: unknown
    contextRefs?: unknown
    instructions?: unknown
    backend?: unknown
  } = {}
  try {
    const raw = await readBody(request)
    body = raw ? JSON.parse(raw) as typeof body : {}
  } catch {
    sendJson(request, response, 400, { error: '请求体必须是 JSON' })
    return
  }

  const selection = sanitizeSelection(body.selection)
  const cwd = options.cwd ?? process.cwd()
  const attachments = Array.isArray(body.attachments)
    ? body.attachments
      .slice(0, 8)
      .map((item) => sanitizeAttachment(item, cwd))
      .filter((item): item is NonNullable<typeof item> => item !== null)
    : []
  const contextRefs = Array.isArray(body.contextRefs)
    ? body.contextRefs
      .slice(0, 20)
      .map(sanitizeContextItem)
      .filter((item): item is NonNullable<typeof item> => item !== null)
    : []
  const instructions = Array.isArray(body.instructions)
    ? body.instructions
      .slice(0, 12)
      .map(sanitizeInstruction)
      .filter((item): item is NonNullable<typeof item> => item !== null)
    : []
  const preferredBackend = sanitizeBackend(body.backend)
  const source =
    body.source === 'figma-workspace' || body.source === 'figma-sidepanel'
      ? body.source
      : 'studio'

  const rawMessage = typeof body.message === 'string' ? body.message.trim() : ''
  const message = rawMessage
    || (attachments.length > 0
      ? `请查看我上传的 ${attachments.length} 个文件`
      : '')
  if (!message) {
    sendJson(request, response, 400, { error: 'message 不能为空' })
    return
  }

  response.statusCode = 200
  setCorsHeaders(request, response)
  response.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  response.setHeader('Cache-Control', 'no-cache, no-transform')
  response.setHeader('Connection', 'keep-alive')
  response.write(': connected\n\n')

  const requestedModel =
    typeof body.model === 'string' && body.model.trim() && body.model.trim() !== 'auto'
      ? body.model.trim().slice(0, 80)
      : undefined

  const controller = new AbortController()
  request.on('aborted', () => controller.abort())
  response.on('close', () => {
    if (!response.writableEnded) controller.abort()
  })

  const runInput: AgentRunInput = {
    message,
    skill: body.skill,
    model: requestedModel,
    source,
    selection,
    attachments,
    contextRefs,
    instructions,
    backend: preferredBackend,
    cwd,
    signal: controller.signal,
    emitRequestContext: true,
  }

  let figmaWrite: ReturnType<typeof tryEnqueueNaturalLanguageInstruction> = null
  let figmaWriteError = ''
  if (selection?.sessionId) {
    try {
      figmaWrite = tryEnqueueNaturalLanguageInstruction(message, selection)
    } catch (error) {
      figmaWriteError = error instanceof Error
        ? error.message
        : 'Figma 写入队列创建失败。'
    }
  }

  if (figmaWrite || figmaWriteError) {
    writeSse(response, 'meta', {
      mode: 'local',
      model: 'figma-bridge',
      shell: false,
      backend: 'figma-bridge',
    })
    writeSse(response, 'message', {
      id: `user-${Date.now()}`,
      kind: 'user',
      text: message,
      refs: selection?.nodes.map((node) => ({
        name: node.name,
        size: node.width && node.height
          ? `${Math.round(node.width)}*${Math.round(node.height)}`
          : node.type,
        output: node.type,
      })),
    })
    writeSse(response, 'message', {
      id: `skill-${Date.now()}`,
      kind: 'skill',
      name: 'layer-edit',
      body: skillBody('layer-edit'),
    })
    if (figmaWriteError) {
      writeSse(response, 'message', {
        id: `figma-write-error-${Date.now()}`,
        kind: 'figma-write',
        commandIds: [],
        summary: 'Figma 写入未执行',
        status: 'error',
        detail: figmaWriteError,
      })
    } else if (figmaWrite) {
      writeSse(response, 'message', {
        id: `figma-write-${figmaWrite.commandId}`,
        kind: 'figma-write',
        commandIds: [figmaWrite.commandId],
        summary: figmaWrite.summary,
        status: 'queued',
      })
      const result = await waitForBridgeCommand(figmaWrite.commandId)
      if (result) {
        writeSse(response, 'message', {
          id: `figma-write-${figmaWrite.commandId}`,
          kind: 'figma-write',
          commandIds: [figmaWrite.commandId],
          summary: result.summary ?? figmaWrite.summary,
          status: result.ok ? 'success' : 'error',
          ...(result.message ? { detail: result.message } : {}),
        })
      }
    }
    writeSse(response, 'done', { ok: !figmaWriteError })
    response.end()
    return
  }

  try {
    const chain = await readyRuntimeChain(options, requestedModel, preferredBackend)
    writeSse(response, 'meta', chain[0].meta)
    let lastError: unknown
    for (let index = 0; index < chain.length; index += 1) {
      const running = chain[index]
      try {
        if (index > 0) {
          writeSse(response, 'message', {
            id: `fallback-${Date.now()}`,
            kind: 'text',
            text: `${chain[index - 1].meta.backend} 不可用：${publicRuntimeError(lastError)}。已切换到 ${running.meta.backend}。`,
          })
          writeSse(response, 'meta', {
            ...running.meta,
            fallbackFrom: chain[index - 1].meta.backend,
          })
        }
        for await (const item of running.run({
          ...runInput,
          emitRequestContext: index === 0,
        })) {
          if (response.writableEnded || controller.signal.aborted) return
          writeSse(response, 'message', item)
        }
        lastError = undefined
        break
      } catch (error) {
        lastError = error
        if (index === chain.length - 1) throw error
      }
    }
    if (lastError) throw lastError
    writeSse(response, 'done', { ok: true })
  } catch (error) {
    writeSse(response, 'error', { message: publicRuntimeError(error) })
  } finally {
    if (!response.writableEnded) response.end()
  }
}

export function createAgentMiddleware(options: AgentPluginOptions) {
  return (
    request: IncomingMessage,
    response: ServerResponse,
    next: () => void,
  ) => {
    const host = request.headers.host ?? '127.0.0.1'
    const requestUrl = new URL(request.url ?? '/', `http://${host}`)

    if (!requestUrl.pathname.startsWith(AGENT_PREFIX)) {
      next()
      return
    }

    if (request.method === 'OPTIONS') {
      sendJson(request, response, 204, {})
      return
    }

    const runtime = resolveRuntime(options)

    if (
      request.method === 'GET'
      && requestUrl.pathname === `${AGENT_PREFIX}/status`
    ) {
      void collectStatusSnapshot(runtime.meta).then((snapshot) => {
        sendJson(request, response, 200, snapshot)
      }).catch((error: unknown) => {
        sendJson(request, response, 500, {
          error: error instanceof Error ? error.message : '无法检查 Agent 状态',
        })
      })
      return
    }

    if (
      request.method === 'POST'
      && requestUrl.pathname === `${AGENT_PREFIX}/attachments`
    ) {
      void (async () => {
        let payload: { files?: unknown } = {}
        try {
          const raw = await readBody(request)
          payload = raw ? JSON.parse(raw) as typeof payload : {}
        } catch {
          sendJson(request, response, 400, { error: '请求体必须是 JSON' })
          return
        }
        if (!Array.isArray(payload.files)) {
          sendJson(request, response, 400, { error: 'files 必须是数组' })
          return
        }
        const files = await saveUploadedFiles(options.cwd ?? process.cwd(), payload.files)
        sendJson(request, response, 200, { files })
      })().catch((error: unknown) => {
        sendJson(request, response, 500, {
          error: error instanceof Error ? error.message : '上传失败',
        })
      })
      return
    }

    if (requestUrl.pathname === `${AGENT_PREFIX}/chat`) {
      void handleChatRequest(request, response, options).catch(
        (error: unknown) => {
          if (!response.headersSent) {
            sendJson(request, response, 500, {
              error:
                error instanceof Error ? error.message : 'Agent 服务异常',
            })
          } else if (!response.writableEnded) {
            writeSse(response, 'error', {
              message:
                error instanceof Error ? error.message : 'Agent 服务异常',
            })
            response.end()
          }
        },
      )
      return
    }

    sendJson(request, response, 404, { error: 'Not Found' })
  }
}

export function agentPlugin(options: AgentPluginOptions): Plugin {
  const middleware = createAgentMiddleware({
    ...options,
    cwd: options.cwd ?? join(process.cwd()),
  })
  return {
    name: 'design-studio-agent',
    configureServer(server) {
      server.middlewares.use(middleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware)
    },
  }
}
