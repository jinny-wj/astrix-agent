import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import type {
  BridgeQueueSnapshot,
  FigmaEditIntent,
  FigmaInstructionScope,
  FigmaInstructionTarget,
  FigmaNodeWriteResult,
  FigmaSelectedNode,
  FigmaSelectionSnapshot,
  FigmaSolidColor,
  FigmaWriteCommand,
  FigmaWriteCommandResult,
} from '../src/types/figmaWrite'
import {
  parseFigmaCreateInstruction,
  parseFigmaInstruction,
  type FigmaCreateDraft,
} from './figmaInstruction.ts'

const BRIDGE_PREFIX = '/api/figma-bridge'
const MAX_QUEUE = 100
const MAX_RECENT = 60
const MAX_SESSIONS = 20
const MAX_BODY_BYTES = 256 * 1024
const MAX_SELECTION_NODES = 100
const COMMAND_LEASE_MS = 8_000
const SELECTION_STALE_MS = 15_000

const pending: FigmaWriteCommand[] = []
const leasedUntil = new Map<string, number>()
const recent: FigmaWriteCommandResult[] = []
const selections = new Map<string, FigmaSelectionSnapshot>()
const selectionReceivedAt = new Map<string, number>()
let latestSessionId: string | null = null
let pluginConnectedAt: string | null = null

class RequestError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

const editIntentKinds = new Set<FigmaEditIntent['kind']>([
  'replace-text',
  'set-fill-color',
  'set-opacity',
  'resize',
  'move',
  'scale',
  'set-visible',
  'rename',
])

function isEditIntentKind(value: unknown): value is FigmaEditIntent['kind'] {
  return typeof value === 'string'
    && editIntentKinds.has(value as FigmaEditIntent['kind'])
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
  response.setHeader('Cache-Control', 'no-store')
  setCorsHeaders(request, response)
  response.end(status === 204 ? undefined : JSON.stringify(body))
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let rejected = false
    request.on('data', (chunk: Buffer) => {
      if (rejected) return
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        rejected = true
        reject(new RequestError(413, '请求体过大。'))
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      if (!rejected) resolve(Buffer.concat(chunks).toString('utf8'))
    })
    request.on('error', reject)
  })
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const raw = await readBody(request)
  if (!raw) return null
  try {
    return JSON.parse(raw) as unknown
  } catch {
    throw new RequestError(400, '请求 JSON 格式不正确。')
  }
}

function requiredString(
  value: unknown,
  field: string,
  maxLength = 500,
) {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new RequestError(400, `${field} 格式不正确。`)
  }
  return value.trim()
}

function parseFileKey(value: unknown, field = 'fileKey') {
  const fileKey = requiredString(value, field, 256)
  if (!/^[A-Za-z0-9_-]{6,256}$/.test(fileKey)) {
    throw new RequestError(400, `${field} 格式不正确。`)
  }
  return fileKey
}

function optionalNumber(
  value: unknown,
  field: string,
  options: { min?: number; max?: number } = {},
) {
  if (value === undefined) return undefined
  if (!isFiniteNumber(value)) {
    throw new RequestError(400, `${field} 必须是有效数字。`)
  }
  if (options.min !== undefined && value < options.min) {
    throw new RequestError(400, `${field} 不能小于 ${options.min}。`)
  }
  if (options.max !== undefined && value > options.max) {
    throw new RequestError(400, `${field} 不能大于 ${options.max}。`)
  }
  return value
}

function parseColor(value: unknown): FigmaSolidColor {
  if (!isRecord(value)) throw new RequestError(400, '颜色格式不正确。')
  const r = optionalNumber(value.r, '颜色 r', { min: 0, max: 1 })
  const g = optionalNumber(value.g, '颜色 g', { min: 0, max: 1 })
  const b = optionalNumber(value.b, '颜色 b', { min: 0, max: 1 })
  if (r === undefined || g === undefined || b === undefined) {
    throw new RequestError(400, '颜色缺少 r、g 或 b。')
  }
  const a = optionalNumber(value.a, '颜色 a', { min: 0, max: 1 })
  return a === undefined ? { r, g, b } : { r, g, b, a }
}

function parseSupports(value: unknown): FigmaSelectedNode['supports'] {
  if (!isRecord(value)) throw new RequestError(400, '图层能力字段不正确。')
  const keys: Array<keyof FigmaSelectedNode['supports']> = [
    'text',
    'fill',
    'opacity',
    'resize',
    'move',
    'visibility',
    'rename',
  ]
  const result = {} as FigmaSelectedNode['supports']
  for (const key of keys) {
    if (typeof value[key] !== 'boolean') {
      throw new RequestError(400, `图层能力 ${key} 格式不正确。`)
    }
    result[key] = value[key]
  }
  return result
}

function parseSelectedNode(value: unknown): FigmaSelectedNode {
  if (!isRecord(value)) throw new RequestError(400, '选区图层格式不正确。')
  if (typeof value.visible !== 'boolean' || typeof value.locked !== 'boolean') {
    throw new RequestError(400, '图层 visible 或 locked 格式不正确。')
  }
  const characters = value.characters === undefined
    ? undefined
    : typeof value.characters === 'string' && value.characters.length <= 20_000
      ? value.characters
      : (() => { throw new RequestError(400, '图层文字格式不正确。') })()
  let fills: FigmaSelectedNode['fills']
  if (value.fills === 'MIXED') fills = 'MIXED'
  else if (value.fills === undefined) fills = undefined
  else if (Array.isArray(value.fills) && value.fills.length <= 20) {
    fills = value.fills.map(parseColor)
  } else {
    throw new RequestError(400, '图层填充格式不正确。')
  }
  const parentId = value.parentId === undefined
    ? undefined
    : requiredString(value.parentId, 'parentId', 200)
  return {
    id: requiredString(value.id, 'node.id', 200),
    name: requiredString(value.name, 'node.name', 500),
    type: requiredString(value.type, 'node.type', 100),
    ...(parentId === undefined ? {} : { parentId }),
    visible: value.visible,
    locked: value.locked,
    opacity: optionalNumber(value.opacity, 'node.opacity', { min: 0, max: 1 }),
    x: optionalNumber(value.x, 'node.x', { min: -1_000_000, max: 1_000_000 }),
    y: optionalNumber(value.y, 'node.y', { min: -1_000_000, max: 1_000_000 }),
    width: optionalNumber(value.width, 'node.width', { min: 0, max: 100_000 }),
    height: optionalNumber(value.height, 'node.height', { min: 0, max: 100_000 }),
    ...(characters === undefined ? {} : { characters }),
    ...(fills === undefined ? {} : { fills }),
    supports: parseSupports(value.supports),
  }
}

function parseSelection(value: unknown): FigmaSelectionSnapshot {
  if (!isRecord(value)) throw new RequestError(400, '选区快照格式不正确。')
  if (!Array.isArray(value.nodes) || value.nodes.length > MAX_SELECTION_NODES) {
    throw new RequestError(400, `单次最多同步 ${MAX_SELECTION_NODES} 个图层。`)
  }
  const revision = optionalNumber(value.revision, 'revision', {
    min: 0,
    max: Number.MAX_SAFE_INTEGER,
  })
  const updatedAt = optionalNumber(value.updatedAt, 'updatedAt', {
    min: 0,
    max: Number.MAX_SAFE_INTEGER,
  })
  if (revision === undefined || !Number.isInteger(revision)) {
    throw new RequestError(400, 'revision 必须是非负整数。')
  }
  if (updatedAt === undefined) {
    throw new RequestError(400, 'updatedAt 格式不正确。')
  }
  const nodes = value.nodes.map(parseSelectedNode)
  if (new Set(nodes.map((node) => node.id)).size !== nodes.length) {
    throw new RequestError(400, '选区包含重复图层。')
  }
  const fileKey = value.fileKey === undefined
    ? undefined
    : parseFileKey(value.fileKey)
  const documentName = value.documentName === undefined
    ? undefined
    : requiredString(value.documentName, 'documentName', 500)
  return {
    sessionId: requiredString(value.sessionId, 'sessionId', 200),
    ...(fileKey ? { fileKey } : {}),
    ...(documentName ? { documentName } : {}),
    pageId: requiredString(value.pageId, 'pageId', 200),
    pageName: requiredString(value.pageName, 'pageName', 500),
    revision,
    updatedAt,
    nodes,
  }
}

function parseAdjustment(value: unknown) {
  if (!isRecord(value)) throw new RequestError(400, '调整值格式不正确。')
  if (value.mode !== 'set' && value.mode !== 'delta') {
    throw new RequestError(400, '调整模式不正确。')
  }
  const amount = optionalNumber(value.value, '调整值', {
    min: -1_000_000,
    max: 1_000_000,
  })
  if (amount === undefined) throw new RequestError(400, '缺少调整值。')
  return { mode: value.mode, value: amount } as const
}

function parseEditIntent(value: unknown): FigmaEditIntent {
  if (!isRecord(value) || typeof value.kind !== 'string') {
    throw new RequestError(400, '图层修改格式不正确。')
  }
  switch (value.kind) {
    case 'replace-text':
      return { kind: value.kind, value: requiredString(value.value, '文字', 20_000) }
    case 'set-fill-color':
      return { kind: value.kind, color: parseColor(value.color) }
    case 'set-opacity': {
      const opacity = optionalNumber(value.value, '透明度', { min: 0, max: 1 })
      if (opacity === undefined) throw new RequestError(400, '缺少透明度。')
      return { kind: value.kind, value: opacity }
    }
    case 'resize': {
      const width = value.width === undefined ? undefined : parseAdjustment(value.width)
      const height = value.height === undefined ? undefined : parseAdjustment(value.height)
      if (!width && !height) throw new RequestError(400, '尺寸命令没有修改内容。')
      return { kind: value.kind, ...(width ? { width } : {}), ...(height ? { height } : {}) }
    }
    case 'move': {
      const x = value.x === undefined ? undefined : parseAdjustment(value.x)
      const y = value.y === undefined ? undefined : parseAdjustment(value.y)
      if (!x && !y) throw new RequestError(400, '移动命令没有修改内容。')
      return { kind: value.kind, ...(x ? { x } : {}), ...(y ? { y } : {}) }
    }
    case 'scale': {
      const factor = optionalNumber(value.factor, '缩放倍数', { min: 0.05, max: 20 })
      if (factor === undefined) throw new RequestError(400, '缺少缩放倍数。')
      return { kind: value.kind, factor }
    }
    case 'set-visible':
      if (typeof value.value !== 'boolean') {
        throw new RequestError(400, '显隐值格式不正确。')
      }
      return { kind: value.kind, value: value.value }
    case 'rename':
      return { kind: value.kind, value: requiredString(value.value, '图层名称', 300) }
    default:
      throw new RequestError(400, `不支持的图层修改：${value.kind}`)
  }
}

function parseCommand(value: unknown): FigmaWriteCommand {
  if (!isRecord(value)) throw new RequestError(400, '命令格式不正确。')
  const id = requiredString(value.id, 'command.id', 300)
  const sessionId = value.sessionId === undefined
    ? undefined
    : requiredString(value.sessionId, 'command.sessionId', 200)
  const selectionRevision = value.selectionRevision === undefined
    ? undefined
    : optionalNumber(value.selectionRevision, 'command.selectionRevision', {
      min: 0,
      max: Number.MAX_SAFE_INTEGER,
    })
  const fileKey = value.fileKey === undefined
    ? undefined
    : parseFileKey(value.fileKey, 'command.fileKey')
  const meta = {
    id,
    ...(sessionId ? { sessionId } : {}),
    ...(selectionRevision === undefined ? {} : { selectionRevision }),
    ...(fileKey ? { fileKey } : {}),
  }
  switch (value.type) {
    case 'ping': return { ...meta, type: value.type }
    case 'notify':
      return { ...meta, type: value.type, message: requiredString(value.message, 'message', 2_000) }
    case 'set-characters':
      return {
        ...meta,
        type: value.type,
        nodeId: requiredString(value.nodeId, 'nodeId', 200),
        characters: requiredString(value.characters, 'characters', 20_000),
      }
    case 'set-fills':
      if (!Array.isArray(value.fills) || value.fills.length > 20) {
        throw new RequestError(400, 'fills 格式不正确。')
      }
      return {
        ...meta,
        type: value.type,
        nodeId: requiredString(value.nodeId, 'nodeId', 200),
        fills: value.fills.map(parseColor),
      }
    case 'create-frame': {
      if (!Array.isArray(value.fills) && value.fills !== undefined) {
        throw new RequestError(400, 'fills 格式不正确。')
      }
      return {
        ...meta,
        type: value.type,
        name: requiredString(value.name, 'name', 500),
        x: optionalNumber(value.x, 'x') ?? 0,
        y: optionalNumber(value.y, 'y') ?? 0,
        width: optionalNumber(value.width, 'width', { min: 0.01, max: 100_000 }) ?? 100,
        height: optionalNumber(value.height, 'height', { min: 0.01, max: 100_000 }) ?? 100,
        ...(typeof value.parentId === 'string' ? { parentId: value.parentId } : {}),
        ...(Array.isArray(value.fills) ? { fills: value.fills.map(parseColor) } : {}),
      }
    }
    case 'create-text': {
      if (!Array.isArray(value.fills) && value.fills !== undefined) {
        throw new RequestError(400, 'fills 格式不正确。')
      }
      return {
        ...meta,
        type: value.type,
        characters: requiredString(value.characters, 'characters', 20_000),
        x: optionalNumber(value.x, 'x') ?? 0,
        y: optionalNumber(value.y, 'y') ?? 0,
        ...(typeof value.name === 'string' ? { name: value.name.slice(0, 500) } : {}),
        ...(value.fontSize === undefined
          ? {}
          : { fontSize: optionalNumber(value.fontSize, 'fontSize', { min: 1, max: 1_000 }) }),
        ...(typeof value.parentId === 'string' ? { parentId: value.parentId } : {}),
        ...(Array.isArray(value.fills) ? { fills: value.fills.map(parseColor) } : {}),
      }
    }
    case 'patch-nodes': {
      if (!Array.isArray(value.targets) || value.targets.length === 0 || value.targets.length > MAX_SELECTION_NODES) {
        throw new RequestError(400, 'patch-nodes targets 格式不正确。')
      }
      const targets = value.targets.map((target) => {
        if (!isRecord(target) || !Array.isArray(target.patches) || target.patches.length === 0) {
          throw new RequestError(400, 'patch-nodes target 格式不正确。')
        }
        return {
          nodeId: requiredString(target.nodeId, 'target.nodeId', 200),
          expectedType: requiredString(target.expectedType, 'target.expectedType', 100),
          patches: target.patches.map(parseEditIntent),
          ...(target.summary === undefined
            ? {}
            : { summary: requiredString(target.summary, 'target.summary', 2_000) }),
        }
      })
      if (new Set(targets.map((target) => target.nodeId)).size !== targets.length) {
        throw new RequestError(400, 'patch-nodes targets 包含重复图层。')
      }
      const executionMode = value.executionMode === undefined
        ? undefined
        : value.executionMode === 'atomic' || value.executionMode === 'best-effort'
          ? value.executionMode
          : (() => { throw new RequestError(400, 'executionMode 格式不正确。') })()
      const lock = value.lock === 'nodes' || value.lock === 'selection'
        ? value.lock
        : undefined
      return {
        ...meta,
        type: value.type,
        targets,
        ...(executionMode ? { executionMode } : {}),
        ...(lock ? { lock } : {}),
        summary: requiredString(value.summary, 'summary', 2_000),
      }
    }
    case 'clone-into-frame': {
      const sourceNodeIds = value.sourceNodeIds === undefined
        ? []
        : Array.isArray(value.sourceNodeIds) && value.sourceNodeIds.length <= MAX_SELECTION_NODES
          ? value.sourceNodeIds.map((nodeId) => requiredString(nodeId, 'sourceNodeId', 200))
          : (() => { throw new RequestError(400, 'sourceNodeIds 格式不正确。') })()
      if (new Set(sourceNodeIds).size !== sourceNodeIds.length) {
        throw new RequestError(400, 'sourceNodeIds 包含重复图层。')
      }
      const labels = value.labels === undefined
        ? undefined
        : Array.isArray(value.labels) && value.labels.length <= 12
          ? value.labels.map((label) => {
            if (!isRecord(label)) throw new RequestError(400, 'label 格式不正确。')
            if (!Array.isArray(label.fills) && label.fills !== undefined) {
              throw new RequestError(400, 'label.fills 格式不正确。')
            }
            return {
              characters: requiredString(label.characters, 'label.characters', 500),
              x: optionalNumber(label.x, 'label.x') ?? 0,
              y: optionalNumber(label.y, 'label.y') ?? 0,
              ...(label.fontSize === undefined
                ? {}
                : { fontSize: optionalNumber(label.fontSize, 'label.fontSize', { min: 1, max: 1_000 }) }),
              ...(typeof label.name === 'string' ? { name: label.name.slice(0, 500) } : {}),
              ...(Array.isArray(label.fills) ? { fills: label.fills.map(parseColor) } : {}),
            }
          })
          : (() => { throw new RequestError(400, 'labels 格式不正确。') })()
      if (!Array.isArray(value.fills) && value.fills !== undefined) {
        throw new RequestError(400, 'fills 格式不正确。')
      }
      return {
        ...meta,
        type: value.type,
        name: requiredString(value.name, 'name', 500),
        x: optionalNumber(value.x, 'x') ?? 0,
        y: optionalNumber(value.y, 'y') ?? 0,
        width: optionalNumber(value.width, 'width', { min: 0.01, max: 100_000 }) ?? 100,
        height: optionalNumber(value.height, 'height', { min: 0.01, max: 100_000 }) ?? 100,
        ...(sourceNodeIds.length > 0 ? { sourceNodeIds } : {}),
        ...(Array.isArray(value.fills) ? { fills: value.fills.map(parseColor) } : {}),
        ...(labels ? { labels } : {}),
      }
    }
    default:
      throw new RequestError(400, '不支持的命令类型。')
  }
}

type ResolvedInstructionTarget = {
  node: FigmaSelectedNode
  message: string
}

function parseInstructionScope(value: unknown): FigmaInstructionScope {
  if (value === undefined || value === 'all') return 'all'
  if (value === 'individual') return value
  throw new RequestError(400, 'scope 必须是 all 或 individual。')
}

function parseInstructionTarget(value: unknown): FigmaInstructionTarget {
  if (!isRecord(value)) throw new RequestError(400, 'targets 图层格式不正确。')
  const instruction = value.instruction === undefined
    ? undefined
    : typeof value.instruction === 'string' && value.instruction.length <= 2_000
      ? value.instruction.trim()
      : (() => { throw new RequestError(400, 'target.instruction 格式不正确。') })()
  return {
    id: requiredString(value.id, 'target.id', 200),
    ...(value.name === undefined
      ? {}
      : { name: requiredString(value.name, 'target.name', 500) }),
    ...(value.type === undefined
      ? {}
      : { type: requiredString(value.type, 'target.type', 100) }),
    ...(instruction === undefined ? {} : { instruction }),
  }
}

function requestedInstructionTargets(
  body: Record<string, unknown>,
): FigmaInstructionTarget[] | null {
  if (body.targets !== undefined) {
    if (!Array.isArray(body.targets) || body.targets.length === 0 || body.targets.length > MAX_SELECTION_NODES) {
      throw new RequestError(400, 'targets 格式不正确。')
    }
    return body.targets.map(parseInstructionTarget)
  }

  // `instructions` is kept as a compact API alias for non-UI callers.
  if (body.instructions !== undefined) {
    if (!Array.isArray(body.instructions) || body.instructions.length === 0 || body.instructions.length > MAX_SELECTION_NODES) {
      throw new RequestError(400, 'instructions 格式不正确。')
    }
    return body.instructions.map((value) => {
      if (!isRecord(value)) throw new RequestError(400, 'instructions 图层格式不正确。')
      return {
        id: requiredString(value.nodeId, 'instruction.nodeId', 200),
        instruction: requiredString(value.message, 'instruction.message', 2_000),
      }
    })
  }

  if (body.nodeIds !== undefined) {
    if (!Array.isArray(body.nodeIds) || body.nodeIds.length === 0 || body.nodeIds.length > MAX_SELECTION_NODES) {
      throw new RequestError(400, 'nodeIds 格式不正确。')
    }
    return body.nodeIds.map((nodeId) => ({
      id: requiredString(nodeId, 'nodeId', 200),
    }))
  }

  return null
}

function resolveInstructionTargets(
  body: Record<string, unknown>,
  selection: FigmaSelectionSnapshot,
  scope: FigmaInstructionScope,
): ResolvedInstructionTarget[] {
  const requested = requestedInstructionTargets(body)
  const fallbackMessage = body.message === undefined
    ? ''
    : requiredString(body.message, 'message', 2_000)
  const selectionById = new Map(selection.nodes.map((node) => [node.id, node]))

  if (requested) {
    const ids = requested.map((target) => target.id)
    if (new Set(ids).size !== ids.length) {
      throw new RequestError(400, 'targets 包含重复图层。')
    }
    for (const target of requested) {
      const node = selectionById.get(target.id)
      if (!node) {
        throw new RequestError(409, `目标图层 ${target.id} 不在已锁定的当前选区中。`)
      }
      if (target.type !== undefined && target.type !== node.type) {
        throw new RequestError(409, `图层“${node.name}”类型已经变化，请重新确认选区。`)
      }
      if (target.name !== undefined && target.name !== node.name) {
        throw new RequestError(409, `图层 ${node.id} 名称已经变化，请重新确认选区。`)
      }
    }
  }

  if (scope === 'all') {
    if (!fallbackMessage) throw new RequestError(400, 'all 模式缺少 message。')
    if (requested) {
      const requestedIds = new Set(requested.map((target) => target.id))
      if (
        requestedIds.size !== selection.nodes.length
        || selection.nodes.some((node) => !requestedIds.has(node.id))
      ) {
        throw new RequestError(409, 'all 模式的 targets 必须与当前完整选区一致。')
      }
    }
    return selection.nodes.map((node) => ({ node, message: fallbackMessage }))
  }

  if (!requested) {
    throw new RequestError(400, 'individual 模式需要 targets 或 instructions。')
  }
  return requested.map((target) => {
    const message = target.instruction || fallbackMessage
    if (!message) {
      throw new RequestError(400, `图层 ${target.id} 缺少 instruction。`)
    }
    return {
      node: selectionById.get(target.id) as FigmaSelectedNode,
      message,
    }
  })
}

function actionSummary(summary: string) {
  return summary.replace(/^将对 1 个图层执行：/, '')
}

function createPatchCommand(
  body: Record<string, unknown>,
  selection: FigmaSelectionSnapshot,
  scope: FigmaInstructionScope,
  sessionId: string,
  selectionRevision: number,
  expectedFileKey: string | undefined,
  lock: 'selection' | 'nodes' = 'selection',
) {
  const resolvedTargets = resolveInstructionTargets(body, selection, scope)
  const commandTargets: Extract<FigmaWriteCommand, { type: 'patch-nodes' }>['targets'] = []
  const nodeResults: FigmaNodeWriteResult[] = []

  for (const { node, message } of resolvedTargets) {
    const parsed = parseFigmaInstruction(message, {
      ...selection,
      nodes: [node],
    })
    if (!parsed.ok) {
      throw new RequestError(422, `图层“${node.name}”：${parsed.message}`)
    }
    const summary = actionSummary(parsed.summary)
    commandTargets.push({
      nodeId: node.id,
      expectedType: node.type,
      patches: parsed.patches,
      summary,
    })
    nodeResults.push({
      nodeId: node.id,
      nodeName: node.name,
      ok: true,
      patchCount: parsed.patches.length,
      summary,
    })
  }

  const executionMode = body.executionMode === undefined
    ? 'atomic'
    : body.executionMode === 'atomic' || body.executionMode === 'best-effort'
      ? body.executionMode
      : (() => { throw new RequestError(400, 'executionMode 格式不正确。') })()
  const commonAction = new Set(nodeResults.map((result) => result.summary)).size === 1
    ? nodeResults[0]?.summary
    : undefined
  const summary = commonAction
    ? `将对 ${nodeResults.length} 个图层执行：${commonAction}`
    : `已为 ${nodeResults.length} 个图层生成独立修改。`
  const command: FigmaWriteCommand = {
    id: `patch-${Date.now()}-${randomUUID()}`,
    type: 'patch-nodes',
    sessionId,
    selectionRevision,
    ...(expectedFileKey || selection.fileKey
      ? { fileKey: expectedFileKey ?? selection.fileKey }
      : {}),
    executionMode,
    ...(lock === 'nodes' ? { lock } : {}),
    targets: commandTargets,
    summary,
  }
  return { command, nodeResults }
}

function parseResult(value: unknown, command: FigmaWriteCommand) {
  if (!isRecord(value) || typeof value.ok !== 'boolean') {
    throw new RequestError(400, '命令结果格式不正确。')
  }
  let changedNodeIds: string[] | undefined
  if (value.changedNodeIds !== undefined) {
    if (!Array.isArray(value.changedNodeIds) || value.changedNodeIds.length > MAX_SELECTION_NODES) {
      throw new RequestError(400, 'changedNodeIds 格式不正确。')
    }
    changedNodeIds = value.changedNodeIds.map((item) => (
      requiredString(item, 'changedNodeId', 200)
    ))
    if (new Set(changedNodeIds).size !== changedNodeIds.length) {
      throw new RequestError(400, 'changedNodeIds 包含重复图层。')
    }
  }

  let nodeResults: FigmaNodeWriteResult[] | undefined
  if (command.type === 'patch-nodes') {
    const targetsById = new Map(command.targets.map((target) => [target.nodeId, target]))
    if (changedNodeIds?.some((nodeId) => !targetsById.has(nodeId))) {
      throw new RequestError(400, '命令结果包含选区外的 changedNodeId。')
    }

    const explicit = new Map<string, FigmaNodeWriteResult>()
    if (value.nodeResults !== undefined) {
      if (!Array.isArray(value.nodeResults) || value.nodeResults.length > command.targets.length) {
        throw new RequestError(400, 'nodeResults 格式不正确。')
      }
      for (const item of value.nodeResults) {
        if (!isRecord(item) || typeof item.ok !== 'boolean') {
          throw new RequestError(400, 'nodeResult 格式不正确。')
        }
        const nodeId = requiredString(item.nodeId, 'nodeResult.nodeId', 200)
        if (!targetsById.has(nodeId)) {
          throw new RequestError(400, `命令结果包含选区外的图层 ${nodeId}。`)
        }
        if (explicit.has(nodeId)) {
          throw new RequestError(400, 'nodeResults 包含重复图层。')
        }
        const patchCount = item.patchCount === undefined
          ? undefined
          : optionalNumber(item.patchCount, 'nodeResult.patchCount', {
            min: 0,
            max: 100,
          })
        if (patchCount !== undefined && !Number.isInteger(patchCount)) {
          throw new RequestError(400, 'nodeResult.patchCount 必须是非负整数。')
        }
        const status = item.status === undefined
          ? undefined
          : item.status === 'success'
            || item.status === 'error'
            || item.status === 'rolled-back'
            || item.status === 'skipped'
            ? item.status
            : (() => { throw new RequestError(400, 'nodeResult.status 格式不正确。') })()
        let changedPatchKinds: FigmaEditIntent['kind'][] | undefined
        if (item.changedPatchKinds !== undefined) {
          if (
            !Array.isArray(item.changedPatchKinds)
            || item.changedPatchKinds.length > 20
            || item.changedPatchKinds.some((kind) => !isEditIntentKind(kind))
          ) {
            throw new RequestError(400, 'nodeResult.changedPatchKinds 格式不正确。')
          }
          changedPatchKinds = item.changedPatchKinds as FigmaEditIntent['kind'][]
          if (new Set(changedPatchKinds).size !== changedPatchKinds.length) {
            throw new RequestError(400, 'nodeResult.changedPatchKinds 包含重复项。')
          }
        }
        explicit.set(nodeId, {
          nodeId,
          ok: item.ok,
          ...(typeof item.nodeName === 'string'
            ? { nodeName: item.nodeName.slice(0, 500) }
            : {}),
          ...(status === undefined ? {} : { status }),
          ...(patchCount === undefined ? {} : { patchCount }),
          ...(changedPatchKinds === undefined ? {} : { changedPatchKinds }),
          ...(typeof item.summary === 'string'
            ? { summary: item.summary.slice(0, 2_000) }
            : {}),
          ...(typeof item.message === 'string'
            ? { message: item.message.slice(0, 2_000) }
            : {}),
        })
      }
    }

    const changedIds = new Set(
      changedNodeIds
      ?? (value.ok && explicit.size === 0
        ? command.targets.map((target) => target.nodeId)
        : []),
    )
    nodeResults = command.targets.map((target) => {
      const provided = explicit.get(target.nodeId)
      if (provided) {
        return {
          ...provided,
          status: provided.status ?? (provided.ok ? 'success' : 'error'),
          patchCount: provided.patchCount ?? target.patches.length,
          changedPatchKinds: provided.changedPatchKinds
            ?? (provided.ok ? target.patches.map((patch) => patch.kind) : []),
          summary: provided.summary ?? target.summary,
        }
      }
      const ok = changedIds.has(target.nodeId)
      return {
        nodeId: target.nodeId,
        ok,
        status: ok ? 'success' : 'error',
        patchCount: target.patches.length,
        changedPatchKinds: ok ? target.patches.map((patch) => patch.kind) : [],
        ...(target.summary ? { summary: target.summary } : {}),
        ...(!ok && typeof value.message === 'string'
          ? { message: value.message.slice(0, 2_000) }
          : {}),
      }
    })
    changedNodeIds = nodeResults
      .filter((result) => result.ok)
      .map((result) => result.nodeId)
  }

  const succeededCount = nodeResults?.filter((result) => result.ok).length
  const failedCount = nodeResults === undefined
    ? undefined
    : nodeResults.length - (succeededCount ?? 0)
  const partial = nodeResults === undefined
    ? undefined
    : (succeededCount ?? 0) > 0 && (failedCount ?? 0) > 0
  return {
    id: command.id,
    ok: value.ok,
    ...(command.sessionId ? { sessionId: command.sessionId } : {}),
    ...(typeof value.nodeId === 'string' ? { nodeId: value.nodeId.slice(0, 200) } : {}),
    ...(changedNodeIds ? { changedNodeIds } : {}),
    ...(nodeResults ? { nodeResults } : {}),
    ...(partial === undefined ? {} : { partial }),
    ...(succeededCount === undefined ? {} : { succeededCount }),
    ...(failedCount === undefined ? {} : { failedCount }),
    ...(typeof value.summary === 'string' ? { summary: value.summary.slice(0, 2_000) } : {}),
    ...(typeof value.message === 'string' ? { message: value.message.slice(0, 2_000) } : {}),
    completedAt: Date.now(),
  } satisfies FigmaWriteCommandResult
}

function pruneQueue() {
  while (pending.length > MAX_QUEUE) {
    const removed = pending.shift()
    if (removed) leasedUntil.delete(removed.id)
  }
}

export function enqueueBridgeCommands(commands: FigmaWriteCommand[]) {
  for (const command of commands) {
    const duplicate = pending.some((item) => item.id === command.id)
      || recent.some((item) => item.id === command.id)
    if (!duplicate) pending.push(command)
  }
  pruneQueue()
  return pending.length
}

export function getBridgeSelection(options?: {
  sessionId?: string
  fileKey?: string
}): FigmaSelectionSnapshot | null {
  if (options?.sessionId) return selectionForSession(options.sessionId)
  if (options?.fileKey) {
    return [...selections.values()]
      .filter((selection) => (
        selection.fileKey === options.fileKey
        && selectionForSession(selection.sessionId) !== null
      ))
      .sort((left, right) => right.updatedAt - left.updatedAt)[0] ?? null
  }
  return currentSelection()
}

export function isFigmaPluginConnected() {
  return Boolean(pluginConnectedAt && currentSelection())
}

export function getBridgeCommandResult(commandId: string): {
  pending: boolean
  result?: FigmaWriteCommandResult
} | null {
  const result = recent.find((item) => item.id === commandId)
  if (result) return { pending: false, result }
  if (pending.some((command) => command.id === commandId)) {
    return { pending: true }
  }
  return null
}

function isOauthSelectionId(sessionId: string) {
  return sessionId.startsWith('oauth:')
}

export function resolveLiveBridgeSession(
  requested: FigmaSelectionSnapshot,
): FigmaSelectionSnapshot {
  const live = isOauthSelectionId(requested.sessionId)
    ? (
        requested.fileKey
          ? getBridgeSelection({ fileKey: requested.fileKey })
          : null
      )
    : (selectionForSession(requested.sessionId)
      ?? (requested.fileKey ? getBridgeSelection({ fileKey: requested.fileKey }) : null))
  if (!live) {
    throw new RequestError(
      409,
      isOauthSelectionId(requested.sessionId)
        ? 'OAuth 只能读取。请在该 Figma 文件中运行 Design Studio Bridge 后再改。'
        : 'Figma 会话已断开，请重新运行 Bridge 插件。',
    )
  }
  if (
    requested.fileKey
    && live.fileKey
    && requested.fileKey !== live.fileKey
  ) {
    throw new RequestError(409, '当前 Bridge 连的是另一个 Figma 文件，请打开同一文件后再写回。')
  }
  return live
}

function commandFromCreateDraft(
  draft: FigmaCreateDraft,
  live: FigmaSelectionSnapshot,
): FigmaWriteCommand {
  const meta = {
    id: `create-${Date.now()}-${randomUUID()}`,
    sessionId: live.sessionId,
    ...(live.fileKey ? { fileKey: live.fileKey } : {}),
    selectionRevision: live.revision,
  }
  return { ...meta, ...draft }
}

function tryEnqueueCreateInstruction(
  message: string,
  requestedSelection: FigmaSelectionSnapshot,
) {
  const parsed = parseFigmaCreateInstruction(message)
  if (!parsed.ok) return null
  const live = resolveLiveBridgeSession(requestedSelection)
  const commands = parsed.drafts.map((draft) => commandFromCreateDraft(draft, live))
  const queueSize = enqueueBridgeCommands(commands)
  const last = commands[commands.length - 1]
  return {
    commandId: last.id,
    summary: parsed.summary,
    queueSize,
    nodeResults: [] as FigmaNodeWriteResult[],
  }
}

export function resolveWritableSelection(
  requested: FigmaSelectionSnapshot,
): { selection: FigmaSelectionSnapshot; lock: 'selection' | 'nodes' } {
  const live = resolveLiveBridgeSession(requested)
  if (!isOauthSelectionId(requested.sessionId) && (
    live.sessionId !== requested.sessionId
    || live.revision !== requested.revision
    || requested.nodes.some((node) => !live.nodes.some((current) => current.id === node.id))
  )) {
    throw new RequestError(409, '选区已改变，请确认右侧当前图层后重新发送修改。')
  }
  const liveIds = new Set(live.nodes.map((node) => node.id))
  const liveById = new Map(live.nodes.map((node) => [node.id, node]))
  const nodes = requested.nodes.length > 0
    ? requested.nodes.map((node) => liveById.get(node.id) ?? node)
    : live.nodes
  if (nodes.length === 0) {
    throw new RequestError(409, '没有可写回的图层。请先在 Figma 或预览里选中图层。')
  }
  const lock: 'selection' | 'nodes' =
    isOauthSelectionId(requested.sessionId)
    || requested.nodes.some((node) => !liveIds.has(node.id))
      ? 'nodes'
      : 'selection'
  return {
    lock,
    selection: {
      ...live,
      fileKey: live.fileKey ?? requested.fileKey,
      documentName: live.documentName ?? requested.documentName,
      nodes,
    },
  }
}

/**
 * Converts a supported natural-language edit into a revision-locked Bridge
 * command. Unsupported chat requests are ignored instead of being presented
 * as successful Figma writes.
 */
export function tryEnqueueNaturalLanguageInstruction(
  message: string,
  requestedSelection: FigmaSelectionSnapshot,
) {
  const created = tryEnqueueCreateInstruction(message, requestedSelection)
  if (created) return created

  let resolved: ReturnType<typeof resolveWritableSelection>
  try {
    resolved = resolveWritableSelection(requestedSelection)
  } catch (error) {
    const parsed = parseFigmaInstruction(message, requestedSelection)
    if (
      !parsed.ok
      && (parsed.code === 'UNSUPPORTED_INSTRUCTION' || parsed.code === 'EMPTY_INSTRUCTION')
    ) {
      return null
    }
    throw error
  }
  const { selection, lock } = resolved
  const parsed = parseFigmaInstruction(message, selection)
  if (!parsed.ok) {
    if (parsed.code === 'UNSUPPORTED_INSTRUCTION' || parsed.code === 'EMPTY_INSTRUCTION') {
      return null
    }
    throw new RequestError(422, parsed.message)
  }
  const body: Record<string, unknown> = {
    message,
    nodeIds: selection.nodes.map((node) => node.id),
    executionMode: 'atomic',
  }
  const { command, nodeResults } = createPatchCommand(
    body,
    selection,
    'all',
    selection.sessionId,
    selection.revision,
    selection.fileKey,
    lock,
  )
  const queueSize = enqueueBridgeCommands([command])
  return {
    commandId: command.id,
    summary: command.summary,
    queueSize,
    nodeResults,
  }
}

function selectionForSession(sessionId: string) {
  const receivedAt = selectionReceivedAt.get(sessionId) ?? 0
  if (Date.now() - receivedAt > SELECTION_STALE_MS) return null
  return selections.get(sessionId) ?? null
}

function currentSelection() {
  return latestSessionId ? selectionForSession(latestSessionId) : null
}

function snapshot(): BridgeQueueSnapshot {
  return {
    pending: [...pending],
    recent: [...recent],
    pluginConnectedAt,
    selection: currentSelection(),
  }
}

function storeSelection(selection: FigmaSelectionSnapshot) {
  const existing = selections.get(selection.sessionId)
  if (existing && selection.revision < existing.revision) {
    throw new RequestError(409, '选区快照已过期。')
  }
  selections.delete(selection.sessionId)
  selections.set(selection.sessionId, selection)
  selectionReceivedAt.set(selection.sessionId, Date.now())
  latestSessionId = selection.sessionId
  while (selections.size > MAX_SESSIONS) {
    const oldest = selections.keys().next().value as string | undefined
    if (!oldest) break
    selections.delete(oldest)
    selectionReceivedAt.delete(oldest)
  }
}

function requestedSelection(requestUrl: URL) {
  const sessionId = requestUrl.searchParams.get('sessionId')?.trim()
  if (sessionId) return selectionForSession(sessionId)
  const fileKey = requestUrl.searchParams.get('fileKey')?.trim()
  if (fileKey) {
    return [...selections.values()]
      .filter((selection) => (
        selection.fileKey === fileKey
        && selectionForSession(selection.sessionId) !== null
      ))
      .sort((left, right) => (
        right.updatedAt - left.updatedAt
        || (selectionReceivedAt.get(right.sessionId) ?? 0)
          - (selectionReceivedAt.get(left.sessionId) ?? 0)
      ))[0] ?? null
  }
  return currentSelection()
}

export function createFigmaBridgeMiddleware() {
  return (
    request: IncomingMessage,
    response: ServerResponse,
    next: () => void,
  ) => {
    const host = request.headers.host ?? '127.0.0.1'
    const requestUrl = new URL(request.url ?? '/', `http://${host}`)
    if (!requestUrl.pathname.startsWith(BRIDGE_PREFIX)) {
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

    void (async () => {
      if (request.method === 'GET' && requestUrl.pathname === `${BRIDGE_PREFIX}/status`) {
        sendJson(request, response, 200, {
          ...snapshot(),
          selection: requestedSelection(requestUrl),
          ok: true,
          note: '在当前 Figma 文件运行 Design Studio Bridge 后即可同步选区并改图层。安装一次后可从画布一键重开。',
        })
        return
      }

      if (request.method === 'POST' && requestUrl.pathname === `${BRIDGE_PREFIX}/selection`) {
        const selection = parseSelection(await readJson(request))
        storeSelection(selection)
        pluginConnectedAt = new Date().toISOString()
        sendJson(request, response, 200, {
          ok: true,
          selection,
          selectedCount: selection.nodes.length,
        })
        return
      }

      if (request.method === 'GET' && requestUrl.pathname === `${BRIDGE_PREFIX}/selection`) {
        sendJson(request, response, 200, {
          ok: true,
          selection: requestedSelection(requestUrl),
        })
        return
      }

      if (request.method === 'POST' && requestUrl.pathname === `${BRIDGE_PREFIX}/instructions`) {
        const body = await readJson(request)
        if (!isRecord(body)) throw new RequestError(400, '指令格式不正确。')
        const sessionId = requiredString(body.sessionId, 'sessionId', 200)
        const scope = parseInstructionScope(body.scope)
        const selectionRevision = optionalNumber(
          body.selectionRevision,
          'selectionRevision',
          { min: 0, max: Number.MAX_SAFE_INTEGER },
        )
        if (selectionRevision === undefined || !Number.isInteger(selectionRevision)) {
          throw new RequestError(400, 'selectionRevision 必须是非负整数。')
        }
        const expectedFileKey = body.expectedFileKey === undefined
          ? undefined
          : parseFileKey(body.expectedFileKey, 'expectedFileKey')
        const selection = selectionForSession(sessionId)
        if (!selection) {
          throw new RequestError(409, 'Figma 会话已断开，请重新运行 Bridge 插件。')
        }
        if (selection.revision !== selectionRevision) {
          throw new RequestError(409, '选区已经变化，请确认当前图层后重新发送。')
        }
        if (expectedFileKey && selection.fileKey !== expectedFileKey) {
          throw new RequestError(
            409,
            selection.fileKey
              ? '当前选区属于另一个 Figma 文件，请切回目标文件后重试。'
              : 'Bridge 未提供文件标识，无法确认当前 Figma 文件。',
          )
        }
        const { command, nodeResults } = createPatchCommand(
          body,
          selection,
          scope,
          sessionId,
          selectionRevision,
          expectedFileKey,
        )
        const queueSize = enqueueBridgeCommands([command])
        sendJson(request, response, 202, {
          ok: true,
          commandId: command.id,
          scope,
          summary: command.summary,
          queueSize,
          nodeResults,
        })
        return
      }

      if (request.method === 'POST' && requestUrl.pathname === `${BRIDGE_PREFIX}/commands`) {
        const body = await readJson(request)
        const values = Array.isArray(body)
          ? body
          : isRecord(body) && Array.isArray(body.commands)
            ? body.commands
            : body === null
              ? []
              : [body]
        const valid = values.map(parseCommand)
        const queueSize = enqueueBridgeCommands(valid)
        sendJson(request, response, 200, {
          ok: true,
          accepted: valid.map((command) => command.id),
          queueSize,
        })
        return
      }

      if (request.method === 'GET' && requestUrl.pathname === `${BRIDGE_PREFIX}/pull`) {
        pluginConnectedAt = new Date().toISOString()
        const sessionId = requestUrl.searchParams.get('sessionId')?.trim() ?? ''
        const now = Date.now()
        const batch = pending
          .filter((command) => !command.sessionId || command.sessionId === sessionId)
          .filter((command) => (leasedUntil.get(command.id) ?? 0) <= now)
          .slice(0, 20)
        for (const command of batch) {
          leasedUntil.set(command.id, now + COMMAND_LEASE_MS)
        }
        sendJson(request, response, 200, { ok: true, commands: batch })
        return
      }

      if (request.method === 'POST' && requestUrl.pathname === `${BRIDGE_PREFIX}/ack`) {
        pluginConnectedAt = new Date().toISOString()
        const body = await readJson(request)
        const values = Array.isArray(body)
          ? body
          : isRecord(body) && Array.isArray(body.results)
            ? body.results
            : []
        const accepted: string[] = []
        for (const value of values) {
          if (!isRecord(value) || typeof value.id !== 'string') continue
          const index = pending.findIndex((command) => command.id === value.id)
          if (index < 0) continue
          const command = pending[index]
          const result = parseResult(value, command)
          pending.splice(index, 1)
          leasedUntil.delete(command.id)
          const previous = recent.findIndex((item) => item.id === result.id)
          if (previous >= 0) recent.splice(previous, 1)
          recent.unshift(result)
          accepted.push(result.id)
        }
        while (recent.length > MAX_RECENT) recent.pop()
        sendJson(request, response, 200, { ok: true, accepted })
        return
      }

      const resultPrefix = `${BRIDGE_PREFIX}/results/`
      if (request.method === 'GET' && requestUrl.pathname.startsWith(resultPrefix)) {
        const commandId = decodeURIComponent(requestUrl.pathname.slice(resultPrefix.length))
        const result = recent.find((item) => item.id === commandId)
        if (result) {
          sendJson(request, response, 200, { ok: true, pending: false, result })
          return
        }
        if (pending.some((command) => command.id === commandId)) {
          sendJson(request, response, 200, { ok: true, pending: true })
          return
        }
        throw new RequestError(404, '没有找到这条 Figma 修改任务。')
      }

      throw new RequestError(404, 'Not Found')
    })().catch((error: unknown) => {
      const status = error instanceof RequestError ? error.status : 500
      const message = error instanceof Error ? error.message : 'Bridge error'
      sendJson(request, response, status, { ok: false, error: message })
    })
  }
}

export function figmaBridgePlugin(): Plugin {
  const middleware = createFigmaBridgeMiddleware()
  return {
    name: 'design-studio-figma-bridge',
    configureServer(server) {
      server.middlewares.use(middleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware)
    },
  }
}
