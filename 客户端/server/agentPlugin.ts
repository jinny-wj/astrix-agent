import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import type { Plugin } from 'vite'
import { createClaudeRuntime } from './agent/claudeRuntime'
import { createCodexRuntime } from './agent/codexRuntime'
import { createHermesRuntime } from './agent/hermesRuntime'
import { createShellRuntime } from './agent/shellRuntime'
import { createModelApiRuntime } from './agent/modelApiRuntime'
import type { ModelApiSettings } from '../src/types/modelApi'
import type { AgentRuntime, AgentRunInput, AgentUiMessage } from './agent/types'
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
import { createConversationStore, executionInput, parseAssessment, requiredQuestions } from './agent/conversation'
import type { ClarificationQuestion } from './agent/conversation'
import { confirmedFigmaInstruction } from './agent/clarificationInstructions'
import {
  getBridgeCommandResult,
  tryEnqueueNaturalLanguageInstruction,
} from './figmaBridgePlugin'
import type { FigmaSelectedNode, FigmaSelectionSnapshot } from '../src/types/figmaWrite'

const AGENT_PREFIX = '/api/agent'

function isAllowedOrigin(origin: string | undefined) {
  if (!origin) return true
  if (origin === 'http://127.0.0.1:5273') return true
  if (origin === 'http://localhost:5273') return true
  return /^chrome-extension:\/\/[a-p]{32}$/.test(origin)
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
  conversationDirectory?: string
  bridge?: { enqueue: typeof tryEnqueueNaturalLanguageInstruction; wait: (commandId: string) => Promise<Awaited<ReturnType<typeof waitForBridgeCommand>>> }
  /** Injectable adapter for isolated local tests; never accepted from HTTP input. */
  getRuntimes?: (input: AgentRunInput) => AgentRuntime[] | Promise<AgentRuntime[]>
  /** Desktop main-process configuration; never accept credentials from chat requests. */
  getModelApiSettings?: () => ModelApiSettings | null
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

function createUnavailableRuntime(message = '没有可用的真实 Agent。请在设置中配置 AI 模型 API，或登录本机 Agent。'): AgentRuntime {
  return {
    meta: {
      mode: 'local',
      model: 'unavailable',
      shell: false,
      backend: 'unavailable',
    },
    async *run() {
      throw new Error(message)
    },
  }
}

function runtimeChain(
  options: AgentPluginOptions,
  model?: string,
  preferred?: AgentRunInput['backend'],
): AgentRuntime[] {
  const api = options.getModelApiSettings?.()
  const useApi = preferred === 'model-api' || (
    !preferred && options.backend === 'auto' && (!model || model === api?.model)
    && api?.enabled
  )
  if (useApi) {
    return api?.enabled && api.baseUrl && api.model && api.apiKey
      ? [createModelApiRuntime(api)]
      : [createUnavailableRuntime('请先在设置中填写并启用 AI 模型 API。')]
  }
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
  if (chain[0]?.meta.backend === 'model-api') return chain
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
  conversations: ReturnType<typeof createConversationStore>,
) {
  if (request.method !== 'POST') {
    sendJson(request, response, 405, { error: 'Method Not Allowed' })
    return
  }
  let body: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(await readBody(request) || '{}')
    if (!isRecord(parsed)) throw new Error('object required')
    body = parsed
  } catch {
    sendJson(request, response, 400, { error: '请求体必须是 JSON 对象' })
    return
  }
  const cwd = options.cwd ?? process.cwd()
  const attachments = Array.isArray(body.attachments)
    ? body.attachments.slice(0, 8).map(item => sanitizeAttachment(item, cwd)).filter((item): item is NonNullable<typeof item> => item !== null) : []
  const contextRefs = Array.isArray(body.contextRefs)
    ? body.contextRefs.slice(0, 20).map(sanitizeContextItem).filter((item): item is NonNullable<typeof item> => item !== null) : []
  const instructions = Array.isArray(body.instructions)
    ? body.instructions.slice(0, 12).map(sanitizeInstruction).filter((item): item is NonNullable<typeof item> => item !== null) : []
  const message = typeof body.message === 'string' && body.message.trim()
    ? body.message.trim().slice(0, 40_000)
    : body.clarificationAnswer ? '已补充澄清问题' : attachments.length ? `请查看我上传的 ${attachments.length} 个文件` : ''
  if (!message) {
    sendJson(request, response, 400, { error: 'message 不能为空' })
    return
  }
  const controller = new AbortController()
  const input: AgentRunInput = {
    message,
    skill: typeof body.skill === 'string' ? body.skill.slice(0, 100) : undefined,
    model: typeof body.model === 'string' && body.model.trim() && body.model !== 'auto' ? body.model.trim().slice(0, 80) : undefined,
    source: body.source === 'figma-workspace' || body.source === 'figma-sidepanel' ? body.source : 'studio',
    selection: sanitizeSelection(body.selection), attachments, contextRefs, instructions,
    backend: sanitizeBackend(body.backend), cwd, signal: controller.signal,
  }
  let turn: ReturnType<typeof conversations.begin>
  try { turn = conversations.begin(body, input, controller) } catch (error) {
    sendJson(request, response, (error as { status?: number }).status || 409, { error: error instanceof Error ? error.message : '会话无法继续' })
    return
  }
  response.statusCode = 200
  setCorsHeaders(request, response)
  response.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  response.setHeader('Cache-Control', 'no-cache, no-transform')
  response.setHeader('Connection', 'keep-alive')
  response.write(': connected\n\n')
  request.on('aborted', () => controller.abort())
  response.on('close', () => { if (!response.writableEnded) controller.abort() })
  const state = () => writeSse(response, 'conversation', conversations.snapshot(turn.record))
  const emit = (item: AgentUiMessage) => {
    if (item.kind === 'user') return
    if (controller.signal.aborted) throw new Error('任务已停止，上下文已保留。')
    conversations.remember(turn, item)
    if (!response.writableEnded) writeSse(response, 'message', item)
  }
  const pause = (questions: ClarificationQuestion[]) => {
    const item = conversations.pause(turn, questions)
    writeSse(response, 'message', item)
    state()
    writeSse(response, 'done', { ok: true, status: 'awaiting_user', conversationId: turn.record.conversationId })
  }
  state()
  if (turn.replay) {
    writeSse(response, 'done', { ok: true, status: turn.record.status, replayed: true })
    response.end()
    return
  }
  try {
    const needed = requiredQuestions(turn)
    if (needed.length) { pause(needed); return }
    const runInput = executionInput(turn.record, controller.signal)
    const exactInstruction = confirmedFigmaInstruction(turn)
    const explicitlySelected = runInput.backend && runInput.backend !== 'shell'
    const apiEnabled = Boolean(options.getModelApiSettings?.()?.enabled)
    if (!exactInstruction && !options.getRuntimes && !apiEnabled && options.backend === 'auto' && !explicitlySelected) {
      conversations.ready(turn)
      state()
      writeSse(response, 'done', { ok: true, status: 'ready', conversationId: turn.record.conversationId })
      return
    }
    let chain: AgentRuntime[] | undefined
    const runtimes = async () => chain ??= options.getRuntimes
      ? await options.getRuntimes(runInput)
      : await readyRuntimeChain(options, runInput.model, runInput.backend)
    // Only an explicitly confirmed, parser-validated instruction bypasses model assessment.
    if (!exactInstruction) {
      let assessment: ReturnType<typeof parseAssessment> | undefined
      let assessmentError: unknown
      for (const runtime of await runtimes()) {
        try {
          const texts: string[] = []
          for await (const item of runtime.run({ ...runInput, phase: 'assess', emitRequestContext: false })) {
            controller.signal.throwIfAborted()
            if (item.kind === 'tool' || item.kind === 'artifact' || item.kind === 'figma-write') throw new Error('需求检查阶段禁止执行工具，任务未继续。')
            if (item.kind === 'text') texts.push(item.text)
          }
          for (const text of texts.reverse()) {
            try { assessment = parseAssessment(text); break } catch (error) { assessmentError = error }
          }
          if (assessment) break
          throw assessmentError || new Error('需求检查未返回结果，任务未执行。')
        } catch (error) {
          if (controller.signal.aborted) throw error
          assessmentError = error
        }
      }
      if (!assessment) throw assessmentError || new Error('没有可用的需求检查后端，请先配置模型。')
      if (!assessment.ready) { pause(assessment.questions); return }
    }
    controller.signal.throwIfAborted()
    conversations.running(turn)
    state()
    const selection = runInput.selection
    let figmaWrite: ReturnType<typeof tryEnqueueNaturalLanguageInstruction> = null
    let figmaWriteError = ''
    if (exactInstruction && selection?.sessionId) {
      try { figmaWrite = (options.bridge?.enqueue ?? tryEnqueueNaturalLanguageInstruction)(exactInstruction, selection) } catch (error) {
        figmaWriteError = error instanceof Error ? error.message : 'Figma 写入队列创建失败。'
      }
    }
    if (figmaWrite || figmaWriteError) {
      writeSse(response, 'meta', { mode: 'local', model: 'figma-bridge', shell: false, backend: 'figma-bridge' })
      emit({ id: `skill-${turn.requestId}`, kind: 'skill', name: 'layer-edit', body: skillBody('layer-edit') })
      if (figmaWriteError) {
        emit({ id: `figma-error-${turn.requestId}`, kind: 'figma-write', commandIds: [], summary: 'Figma 写入未执行', status: 'error', detail: figmaWriteError })
        throw new Error(figmaWriteError)
      }
      if (figmaWrite) {
        emit({ id: `figma-write-${figmaWrite.commandId}`, kind: 'figma-write', commandIds: [figmaWrite.commandId], summary: figmaWrite.summary, status: 'queued' })
        const result = await (options.bridge?.wait ?? waitForBridgeCommand)(figmaWrite.commandId)
        controller.signal.throwIfAborted()
        if (!result) throw new Error('尚未收到插件执行回执，请核对实际设计稿后再重试。')
        emit({ id: `figma-write-${figmaWrite.commandId}`, kind: 'figma-write', commandIds: [figmaWrite.commandId], summary: result.summary ?? figmaWrite.summary, status: result.ok ? 'success' : 'error', ...(result.message ? { detail: result.message } : {}) })
        if (!result.ok) throw new Error(result.message || 'Figma 插件执行失败')
      }
    } else {
      let lastError: unknown
      let completed = false
      let anyTool = false
      for (const runtime of await runtimes()) {
        try {
          writeSse(response, 'meta', runtime.meta)
          for await (const item of runtime.run({ ...runInput, phase: 'execute', emitRequestContext: false })) {
            if (item.kind === 'tool' || item.kind === 'artifact' || item.kind === 'figma-write') anyTool = true
            emit(item)
          }
          controller.signal.throwIfAborted()
          completed = true
          break
        } catch (error) {
          lastError = error
          // An execution may already have caused effects; switching runtimes
          // would run the same task twice.
          if (anyTool || controller.signal.aborted) throw error
        }
      }
      if (!completed) throw lastError || new Error('没有可用的真实 Agent')
    }
    conversations.finish(turn, 'completed')
    state()
    writeSse(response, 'done', { ok: true, status: 'completed', conversationId: turn.record.conversationId })
  } catch (error) {
    const cancelled = turn.record.status === 'cancelled'
    const message = cancelled ? '任务已取消。' : controller.signal.aborted ? '运行连接已中断，上下文已保留；请核对实际结果后重试。' : publicRuntimeError(error)
    conversations.finish(turn, cancelled ? 'cancelled' : 'failed', message)
    if (!response.writableEnded && !response.destroyed) {
      state()
      writeSse(response, 'error', { message })
      writeSse(response, 'done', { ok: false, status: turn.record.status })
    }
  } finally {
    turn.release()
    if (!response.writableEnded) response.end()
  }
}

export function createAgentMiddleware(options: AgentPluginOptions) {
  const conversations = createConversationStore(options.conversationDirectory ?? join(options.cwd ?? process.cwd(), 'workbench', '.local-data', 'agent-conversations'))
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

    // CORS headers alone do not stop cross-site requests from executing locally.
    if (!isAllowedOrigin(request.headers.origin)) {
      sendJson(request, response, 403, { error: '不允许此来源访问本机 Agent' })
      return
    }

    if (request.method === 'OPTIONS') {
      sendJson(request, response, 204, {})
      return
    }

    if (request.method === 'POST'
      && request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      sendJson(request, response, 415, { error: '请求必须使用 application/json' })
      return
    }

    const conversationRoute = requestUrl.pathname.match(/^\/api\/agent\/conversations\/([^/]+)(\/cancel)?$/)
    if (conversationRoute) {
      try {
        if (request.method === 'GET' && !conversationRoute[2]) sendJson(request, response, 200, conversations.get(conversationRoute[1]))
        else if (request.method === 'POST' && conversationRoute[2]) sendJson(request, response, 200, conversations.cancel(conversationRoute[1]))
        else sendJson(request, response, 405, { error: 'Method Not Allowed' })
      } catch (error) {
        sendJson(request, response, (error as { status?: number }).status || 500, { error: error instanceof Error ? error.message : '无法读取会话' })
      }
      return
    }

    const runtime = resolveRuntime(options)

    if (
      request.method === 'GET'
      && requestUrl.pathname === `${AGENT_PREFIX}/status`
    ) {
      void collectStatusSnapshot(runtime.meta, options.cwd, options.getModelApiSettings?.()).then((snapshot) => {
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
      void handleChatRequest(request, response, options, conversations).catch(
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
