import type { FigmaNode, FigmaPaint } from '../types/figma'
import type { FigmaEditIntent, FigmaSolidColor } from '../types/figmaWrite'

function clonePaints(paints: FigmaPaint[] | undefined): FigmaPaint[] | undefined {
  return paints?.map((paint) => ({ ...paint }))
}

function applyFill(node: FigmaNode, color: FigmaSolidColor): FigmaNode {
  const paint: FigmaPaint = {
    type: 'SOLID',
    visible: true,
    opacity: color.a ?? 1,
    color: { r: color.r, g: color.g, b: color.b, a: 1 },
  }
  return {
    ...node,
    fills: [paint],
  }
}

function nextSize(
  current: number | undefined,
  adjustment: { mode: 'set' | 'delta'; value: number } | undefined,
  factor = 1,
) {
  if (adjustment) {
    return adjustment.mode === 'set'
      ? adjustment.value
      : Math.max(1, (current ?? 0) + adjustment.value)
  }
  return Math.max(1, (current ?? 0) * factor)
}

function applyPatchesToNode(node: FigmaNode, patches: FigmaEditIntent[]): FigmaNode {
  let next: FigmaNode = {
    ...node,
    fills: clonePaints(node.fills),
    strokes: clonePaints(node.strokes),
    children: node.children,
  }

  for (const patch of patches) {
    if (patch.kind === 'replace-text') {
      next = { ...next, characters: patch.value }
      continue
    }
    if (patch.kind === 'set-fill-color') {
      next = applyFill(next, patch.color)
      continue
    }
    if (patch.kind === 'set-opacity') {
      next = { ...next, opacity: patch.value }
      continue
    }
    if (patch.kind === 'set-visible') {
      next = { ...next, visible: patch.value }
      continue
    }
    if (patch.kind === 'rename') {
      next = { ...next, name: patch.value }
      continue
    }

    const box = next.absoluteBoundingBox
    if (patch.kind === 'resize' && box) {
      const width = nextSize(box.width, patch.width)
      const height = nextSize(box.height, patch.height)
      next = {
        ...next,
        absoluteBoundingBox: { ...box, width, height },
        size: { x: width, y: height },
      }
      continue
    }
    if (patch.kind === 'scale' && box) {
      const width = nextSize(box.width, undefined, patch.factor)
      const height = nextSize(box.height, undefined, patch.factor)
      next = {
        ...next,
        absoluteBoundingBox: { ...box, width, height },
        size: { x: width, y: height },
      }
      continue
    }
    if (patch.kind === 'move' && box) {
      const x = patch.x
        ? patch.x.mode === 'set' ? patch.x.value : box.x + patch.x.value
        : box.x
      const y = patch.y
        ? patch.y.mode === 'set' ? patch.y.value : box.y + patch.y.value
        : box.y
      const transform = next.relativeTransform
      next = {
        ...next,
        absoluteBoundingBox: { ...box, x, y },
        relativeTransform: transform
          ? [
              [transform[0][0], transform[0][1], transform[0][2] + (x - box.x)],
              [transform[1][0], transform[1][1], transform[1][2] + (y - box.y)],
            ]
          : transform,
      }
    }
  }

  return next
}

export function patchFigmaNodes(
  root: FigmaNode,
  nodeIds: string[],
  patches: FigmaEditIntent[],
): FigmaNode {
  const targets = new Set(nodeIds)
  const walk = (node: FigmaNode): FigmaNode => {
    const children = node.children?.map(walk)
    const current = children ? { ...node, children } : node
    return targets.has(node.id) ? applyPatchesToNode(current, patches) : current
  }
  return walk(root)
}
