import type { FigmaNode } from '../types/figma'
import type {
  FigmaSelectedNode,
  FigmaSelectionSnapshot,
  FigmaSolidColor,
} from '../types/figmaWrite'

export type TargetedLayer = {
  id: string
  name: string
  type: string
  fileKey?: string
  characters?: string
  width?: number
  height?: number
  thumbnailUrl?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function solidFills(node: FigmaNode): FigmaSolidColor[] | 'MIXED' | undefined {
  const fills = node.fills
  if (!Array.isArray(fills) || fills.length === 0) return undefined
  const solids: FigmaSolidColor[] = []
  for (const fill of fills) {
    if (!isRecord(fill) || fill.visible === false) continue
    if (fill.type !== 'SOLID' || !isRecord(fill.color)) return 'MIXED'
    const color = fill.color
    if (
      typeof color.r !== 'number'
      || typeof color.g !== 'number'
      || typeof color.b !== 'number'
    ) {
      return 'MIXED'
    }
    solids.push({
      r: color.r,
      g: color.g,
      b: color.b,
      a: typeof fill.opacity === 'number'
        ? fill.opacity
        : typeof color.a === 'number'
          ? color.a
          : 1,
    })
  }
  return solids.length > 0 ? solids : undefined
}

export function figmaNodeToSelectedNode(node: FigmaNode): FigmaSelectedNode {
  const box = node.absoluteBoundingBox
  const type = node.type || 'NODE'
  return {
    id: node.id,
    name: node.name || type,
    type,
    visible: node.visible !== false,
    locked: Boolean(node.locked),
    opacity: typeof node.opacity === 'number' ? node.opacity : undefined,
    x: box?.x,
    y: box?.y,
    width: box?.width,
    height: box?.height,
    characters: typeof node.characters === 'string' ? node.characters : undefined,
    fills: solidFills(node),
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

export function targetedLayerFromNode(
  node: FigmaNode,
  extra: Pick<TargetedLayer, 'fileKey' | 'thumbnailUrl'> = {},
): TargetedLayer {
  const selected = figmaNodeToSelectedNode(node)
  return {
    id: selected.id,
    name: selected.name,
    type: selected.type,
    fileKey: extra.fileKey,
    characters: selected.characters,
    width: selected.width,
    height: selected.height,
    thumbnailUrl: extra.thumbnailUrl,
  }
}

export function selectionSnapshotFromLayers(
  layers: TargetedLayer[],
  extra: {
    fileKey?: string
    documentName?: string
    pageName?: string
  } = {},
): FigmaSelectionSnapshot | null {
  if (layers.length === 0) return null
  const now = Date.now()
  return {
    sessionId: `oauth:${extra.fileKey ?? layers[0]?.fileKey ?? 'local'}`,
    fileKey: extra.fileKey ?? layers[0]?.fileKey,
    documentName: extra.documentName,
    pageId: 'current',
    pageName: extra.pageName ?? '当前页面',
    revision: now,
    updatedAt: now,
    nodes: layers.map((layer) => ({
      id: layer.id,
      name: layer.name,
      type: layer.type,
      visible: true,
      locked: false,
      width: layer.width,
      height: layer.height,
      characters: layer.characters,
      supports: {
        text: layer.type === 'TEXT',
        fill: true,
        opacity: true,
        resize: true,
        move: true,
        visibility: true,
        rename: true,
      },
    })),
  }
}

export function attachLiveBridgeSession(
  snapshot: FigmaSelectionSnapshot | null,
  bridge: FigmaSelectionSnapshot | null,
): FigmaSelectionSnapshot | null {
  if (!snapshot) return null
  if (!bridge) return snapshot
  if (
    !snapshot.fileKey
    || snapshot.fileKey !== bridge.fileKey
    || snapshot.nodes.some((node) => !bridge.nodes.some((current) => current.id === node.id))
  ) {
    return snapshot
  }
  return {
    ...bridge,
    fileKey: bridge.fileKey ?? snapshot.fileKey,
    documentName: bridge.documentName ?? snapshot.documentName,
    nodes: bridge.nodes.filter((node) => snapshot.nodes.some((target) => target.id === node.id)),
  }
}

/** Plugin selection is authoritative, including a deliberately empty selection. */
export function resolveLayerTarget(input: {
  fileKey?: string
  preview: TargetedLayer[] | null
  bridge: FigmaSelectionSnapshot | null
  oauth: TargetedLayer | null
}) {
  const bridge = input.bridge && (!input.fileKey || input.bridge.fileKey === input.fileKey)
    ? input.bridge : null
  if (input.preview !== null) return input.preview
  if (bridge) return bridge.nodes.map((node) => ({ ...node, fileKey: bridge.fileKey }))
  return input.oauth && input.oauth.fileKey === input.fileKey ? [input.oauth] : []
}

/** 预览/编辑器选区优先；没有预览选区时才用 Bridge 当前选区。 */
export function preferPreviewLayers(
  preview: TargetedLayer[],
  bridge: TargetedLayer[],
): TargetedLayer[] {
  return preview.length > 0 ? preview : bridge
}

export function formatSelectionPrompt(selection: FigmaSelectionSnapshot | null | undefined) {
  const nodes = selection?.nodes ?? []
  if (nodes.length === 0) return ''
  return nodes.map((node) => {
    const box = node.width && node.height
      ? `${Math.round(node.width)}×${Math.round(node.height)}`
      : ''
    const text = node.characters ? ` 文案：${node.characters.slice(0, 200)}` : ''
    return `- ${node.name}（${node.type}${box ? ` ${box}` : ''}，id ${node.id}）${text}`
  }).join('\n')
}

const CONTEXT_LAYER_TYPES = new Set([
  'FRAME',
  'GROUP',
  'COMPONENT',
  'COMPONENT_SET',
  'INSTANCE',
  'TEXT',
  'SECTION',
])

export function flattenNamedLayers(
  root: FigmaNode,
  limit = 30,
): Array<{ id: string; name: string; type: string }> {
  const out: Array<{ id: string; name: string; type: string }> = []
  const walk = (node: FigmaNode) => {
    if (out.length >= limit) return
    if (CONTEXT_LAYER_TYPES.has(node.type) && node.name) {
      out.push({ id: node.id, name: node.name, type: node.type })
    }
    for (const child of node.children ?? []) walk(child)
  }
  walk(root)
  return out
}
