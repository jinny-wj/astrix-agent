import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type PointerEvent,
  type ReactElement,
  type WheelEvent,
} from 'react'
import { useEditor } from '../../state/editorStore'
import type { FigmaFileResponse } from '../../types/figma'
import CanvasToolbar from './CanvasToolbar'

type FigmaColor = {
  r: number
  g: number
  b: number
  a?: number
}

type FigmaVector = {
  x: number
  y: number
}

type FigmaRect = FigmaVector & {
  width: number
  height: number
}

type FigmaPaint = {
  type: string
  visible?: boolean
  opacity?: number
  color?: FigmaColor
  blendMode?: string
  imageRef?: string
  scaleMode?: string
  scalingFactor?: number
  rotation?: number
  imageTransform?: [[number, number, number], [number, number, number]]
  gradientHandlePositions?: FigmaVector[]
  gradientStops?: Array<{ position: number; color: FigmaColor }>
}

type FigmaPath = {
  path: string
  windingRule?: 'NONZERO' | 'EVENODD' | string
}

type FigmaTextStyle = {
  fontFamily?: string
  fontPostScriptName?: string | null
  fontSize?: number
  fontWeight?: number
  italic?: boolean
  letterSpacing?: number | { value?: number; unit?: string }
  lineHeightPx?: number
  lineHeightPercent?: number
  lineHeightPercentFontSize?: number
  textAlignHorizontal?: string
  textAlignVertical?: string
  textCase?: string
  textDecoration?: string
  paragraphIndent?: number
  paragraphSpacing?: number
  fills?: FigmaPaint[]
}

type FigmaEffect = {
  type: string
  visible?: boolean
  radius?: number
  spread?: number
  offset?: FigmaVector
  color?: FigmaColor
}

/**
 * A deliberately structural subset of the REST node shape. Keeping this local
 * lets the renderer also accept responses from older Figma API typings.
 */
export type FigmaCanvasNode = {
  id: string
  name?: string
  type: string
  visible?: boolean
  opacity?: number
  rotation?: number
  blendMode?: string
  children?: FigmaCanvasNode[]
  absoluteBoundingBox?: FigmaRect
  absoluteRenderBounds?: FigmaRect | null
  relativeTransform?: [[number, number, number], [number, number, number]]
  size?: FigmaVector
  fills?: FigmaPaint[] | string
  background?: FigmaPaint[]
  backgrounds?: FigmaPaint[]
  backgroundColor?: FigmaColor
  strokes?: FigmaPaint[] | string
  strokeWeight?: number
  strokeTopWeight?: number
  strokeRightWeight?: number
  strokeBottomWeight?: number
  strokeLeftWeight?: number
  strokeDashes?: number[]
  dashPattern?: number[]
  cornerRadius?: number
  rectangleCornerRadii?: [number, number, number, number] | number[]
  clipsContent?: boolean
  characters?: string
  style?: FigmaTextStyle
  characterStyleOverrides?: number[]
  styleOverrideTable?: Record<string, FigmaTextStyle>
  effects?: FigmaEffect[]
  isMask?: boolean
  maskType?: 'ALPHA' | 'VECTOR' | 'LUMINANCE' | string
  booleanOperation?: 'UNION' | 'INTERSECT' | 'SUBTRACT' | 'EXCLUDE' | string
  fillGeometry?: FigmaPath[]
  strokeGeometry?: FigmaPath[]
}

type FigmaFileLike =
  | FigmaCanvasNode
  | {
      document?: FigmaCanvasNode
      nodes?: Record<string, FigmaCanvasNode | { document?: FigmaCanvasNode }>
    }

type FigmaImageMap = Record<string, string | null | undefined>

export type FigmaCanvasProps = {
  /** Raw Figma REST response. */
  file?: FigmaFileLike | FigmaFileResponse
  /** Store-friendly imported document, including its resolved image URLs. */
  document?: {
    file: FigmaFileResponse
    images?: FigmaImageMap
    nodeId?: string
  }
  imageMap?: FigmaImageMap | { images?: FigmaImageMap }
  /** Render this node as the scene root. The first visible page is used otherwise. */
  initialNodeId?: string
  className?: string
}

type Origin = { x: number; y: number }

type PaintLayer = {
  image: string
  position: string
  repeat: string
  size: string
  blendMode?: string
  transform?: string
}

const STRUCTURAL_NODE_TYPES = new Set(['DOCUMENT', 'CANVAS'])
const CONTAINER_NODE_TYPES = new Set(['FRAME', 'GROUP', 'COMPONENT', 'INSTANCE', 'SECTION'])
const MIN_ZOOM = 0.35
const MAX_ZOOM = 2

function finite(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function colorChannel(value: number) {
  const normalized = value > 1 ? value : value * 255
  return Math.round(clamp(normalized, 0, 255))
}

function rgba(color: FigmaColor | undefined, opacity = 1) {
  if (!color) return 'rgba(0, 0, 0, 0)'
  const alpha = clamp(finite(color.a, 1) * finite(opacity, 1), 0, 1)
  return `rgba(${colorChannel(color.r)}, ${colorChannel(color.g)}, ${colorChannel(color.b)}, ${alpha})`
}

function normalizeBlendMode(mode: string | undefined) {
  if (!mode || mode === 'NORMAL' || mode === 'PASS_THROUGH') return 'normal'
  const aliases: Record<string, string> = {
    LINEAR_BURN: 'color-burn',
    LINEAR_DODGE: 'plus-lighter',
    LUMINOSITY: 'luminosity',
  }
  return aliases[mode] ?? mode.toLowerCase().replace(/_/g, '-')
}

function gradientStops(paint: FigmaPaint) {
  const stops = paint.gradientStops ?? []
  if (stops.length === 0) return 'transparent 0%, transparent 100%'
  return stops
    .map((stop) => `${rgba(stop.color, paint.opacity)} ${clamp(finite(stop.position), 0, 1) * 100}%`)
    .join(', ')
}

function gradientAngle(handles: FigmaVector[] | undefined) {
  if (!handles || handles.length < 2) return 180
  const start = handles[0]
  const end = handles[1]
  return Math.atan2(end.y - start.y, end.x - start.x) * (180 / Math.PI) + 90
}

function paintLayer(
  paint: FigmaPaint,
  images: FigmaImageMap,
  nodeId: string,
): PaintLayer | null {
  if (paint.visible === false) return null
  const stops = gradientStops(paint)
  const handles = paint.gradientHandlePositions
  const center = handles?.[0] ?? { x: 0.5, y: 0.5 }
  const blendMode = normalizeBlendMode(paint.blendMode)

  if (paint.type === 'SOLID') {
    const color = rgba(paint.color, paint.opacity)
    return {
      image: `linear-gradient(${color}, ${color})`,
      position: 'center',
      repeat: 'no-repeat',
      size: '100% 100%',
      blendMode,
    }
  }
  if (paint.type === 'GRADIENT_LINEAR') {
    return {
      image: `linear-gradient(${gradientAngle(handles)}deg, ${stops})`,
      position: 'center',
      repeat: 'no-repeat',
      size: '100% 100%',
      blendMode,
    }
  }
  if (paint.type === 'GRADIENT_RADIAL' || paint.type === 'GRADIENT_DIAMOND') {
    return {
      image: `radial-gradient(ellipse at ${center.x * 100}% ${center.y * 100}%, ${stops})`,
      position: 'center',
      repeat: 'no-repeat',
      size: '100% 100%',
      blendMode,
    }
  }
  if (paint.type === 'GRADIENT_ANGULAR') {
    return {
      image: `conic-gradient(from ${gradientAngle(handles)}deg at ${center.x * 100}% ${center.y * 100}%, ${stops})`,
      position: 'center',
      repeat: 'no-repeat',
      size: '100% 100%',
      blendMode,
    }
  }
  if (paint.type === 'IMAGE') {
    const source = (paint.imageRef && images[paint.imageRef]) || images[nodeId]
    if (!source) return null
    const mode = paint.scaleMode ?? 'FILL'
    const tiled = mode === 'TILE'
    const transform = paint.imageTransform
    const matrix =
      transform
        ? `matrix(${finite(transform[0][0])}, ${finite(transform[1][0])}, ${finite(transform[0][1])}, ${finite(transform[1][1])}, ${finite(transform[0][2])}, ${finite(transform[1][2])})`
        : paint.rotation
          ? `rotate(${finite(paint.rotation)}deg)`
          : undefined
    return {
      image: `url(${JSON.stringify(source)})`,
      position: 'center',
      repeat: tiled ? 'repeat' : 'no-repeat',
      size: tiled
        ? `${Math.max(finite(paint.scalingFactor, 1) * 100, 1)}% auto`
        : mode === 'FIT'
          ? 'contain'
          : mode === 'STRETCH'
            ? '100% 100%'
            : 'cover',
      blendMode,
      transform: matrix,
    }
  }
  return null
}

function paintStyle(
  paints: FigmaPaint[] | string | undefined,
  images: FigmaImageMap,
  nodeId: string,
): CSSProperties {
  if (!Array.isArray(paints)) return {}
  const layers = paints
    .map((paint) => paintLayer(paint, images, nodeId))
    .filter((layer): layer is PaintLayer => Boolean(layer))

  if (layers.length === 0) return {}
  // CSS multi-background cannot express per-layer matrix transforms.
  // Prefer the first non-transformed stack; transformed images are rendered
  // as overlay layers in NodeView.
  const plain = layers.filter((layer) => !layer.transform)
  if (plain.length === 0) return {}
  return {
    backgroundImage: plain.map((layer) => layer.image).join(', '),
    backgroundPosition: plain.map((layer) => layer.position).join(', '),
    backgroundRepeat: plain.map((layer) => layer.repeat).join(', '),
    backgroundSize: plain.map((layer) => layer.size).join(', '),
    backgroundBlendMode: plain.map((layer) => layer.blendMode ?? 'normal').join(', '),
  }
}

function geometryClipPath(node: FigmaCanvasNode): string | undefined {
  const geometry = node.fillGeometry ?? []
  if (!geometry.length) return undefined
  const parts = geometry
    .map((item) => item.path?.trim())
    .filter(Boolean)
  if (parts.length === 0) return undefined
  return parts.map((path) => `path(evenodd, "${path}")`).join(', ')
}

function GeometryOverlay({
  node,
  fills,
}: {
  node: FigmaCanvasNode
  fills: FigmaPaint[] | string | undefined
}) {
  const geometry = node.fillGeometry ?? []
  if (geometry.length === 0) return null
  const solid = firstVisiblePaint(fills)
  const fill =
    solid?.type === 'SOLID' ? rgba(solid.color, solid.opacity) : 'currentColor'
  const strokePaint = firstVisiblePaint(node.strokes)
  const stroke =
    strokePaint?.type === 'SOLID'
      ? rgba(strokePaint.color, strokePaint.opacity)
      : 'transparent'

  return (
    <svg
      aria-hidden
      viewBox={`0 0 ${Math.max(finite(node.absoluteBoundingBox?.width ?? node.size?.x), 1)} ${Math.max(finite(node.absoluteBoundingBox?.height ?? node.size?.y), 1)}`}
      preserveAspectRatio="none"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
    >
      {geometry.map((item, index) => (
        <path
          key={`${node.id}-geo-${index}`}
          d={item.path}
          fill={fill}
          fillRule={item.windingRule === 'EVENODD' ? 'evenodd' : 'nonzero'}
          stroke={stroke}
          strokeWidth={Math.max(finite(node.strokeWeight), 0)}
        />
      ))}
    </svg>
  )
}

function TransformedImageLayers({
  paints,
  images,
  nodeId,
}: {
  paints: FigmaPaint[] | string | undefined
  images: FigmaImageMap
  nodeId: string
}) {
  if (!Array.isArray(paints)) return null
  return (
    <>
      {paints.map((paint, index) => {
        const layer = paintLayer(paint, images, nodeId)
        if (!layer?.transform || !layer.image.startsWith('url(')) return null
        const url = layer.image.slice(4, -1).replace(/^"|"$/g, '')
        return (
          <div
            key={`${nodeId}-img-${index}`}
            aria-hidden
            style={{
              position: 'absolute',
              inset: 0,
              backgroundImage: layer.image,
              backgroundPosition: layer.position,
              backgroundRepeat: layer.repeat,
              backgroundSize: layer.size,
              transform: layer.transform,
              transformOrigin: 'center center',
              mixBlendMode: (layer.blendMode ?? 'normal') as CSSProperties['mixBlendMode'],
              pointerEvents: 'none',
            }}
            data-image-url={url}
          />
        )
      })}
    </>
  )
}

function renderChildNodes(
  children: FigmaCanvasNode[] | undefined,
  parentBounds: FigmaRect,
  scene: FigmaRect,
  images: FigmaImageMap,
) {
  if (!children?.length) return null
  const elements: ReactElement[] = []
  let index = 0
  while (index < children.length) {
    const child = children[index]
    if (child.isMask) {
      const masked: FigmaCanvasNode[] = []
      let cursor = index + 1
      while (cursor < children.length && !children[cursor].isMask) {
        masked.push(children[cursor])
        cursor += 1
      }
      const maskGeometry = child.fillGeometry?.[0]?.path
      const maskStyle: CSSProperties = maskGeometry
        ? {
            clipPath: `path(evenodd, "${maskGeometry}")`,
            WebkitClipPath: `path(evenodd, "${maskGeometry}")`,
          }
        : child.maskType === 'ALPHA' || child.maskType === 'LUMINANCE'
          ? {
              // Approximate alpha/luminance masks with overflow clip on mask bounds.
              overflow: 'hidden',
            }
          : { overflow: 'hidden' }

      elements.push(
        <div
          key={`mask-group-${child.id}`}
          data-figma-mask={child.id}
          style={{
            position: 'absolute',
            inset: 0,
            ...maskStyle,
          }}
        >
          <NodeView
            node={child}
            parentOrigin={{ x: parentBounds.x, y: parentBounds.y }}
            scene={scene}
            images={images}
          />
          {masked.map((item) => (
            <NodeView
              key={item.id}
              node={item}
              parentOrigin={{ x: parentBounds.x, y: parentBounds.y }}
              scene={scene}
              images={images}
            />
          ))}
        </div>,
      )
      index = cursor
      continue
    }

    elements.push(
      <NodeView
        key={child.id}
        node={child}
        parentOrigin={{ x: parentBounds.x, y: parentBounds.y }}
        scene={scene}
        images={images}
      />,
    )
    index += 1
  }
  return elements
}

function firstVisiblePaint(paints: FigmaPaint[] | string | undefined) {
  return Array.isArray(paints) ? paints.find((paint) => paint.visible !== false) : undefined
}

function borderStyle(node: FigmaCanvasNode): CSSProperties {
  const stroke = firstVisiblePaint(node.strokes)
  if (!stroke) return {}

  const weight = Math.max(finite(node.strokeWeight, 1), 0)
  const style: CSSProperties = {
    borderStyle: (node.strokeDashes?.length || node.dashPattern?.length) ? 'dashed' : 'solid',
    borderWidth: weight,
  }

  if (node.strokeTopWeight !== undefined) style.borderTopWidth = Math.max(node.strokeTopWeight, 0)
  if (node.strokeRightWeight !== undefined) style.borderRightWidth = Math.max(node.strokeRightWeight, 0)
  if (node.strokeBottomWeight !== undefined) style.borderBottomWidth = Math.max(node.strokeBottomWeight, 0)
  if (node.strokeLeftWeight !== undefined) style.borderLeftWidth = Math.max(node.strokeLeftWeight, 0)

  if (stroke.type === 'SOLID') {
    style.borderColor = rgba(stroke.color, stroke.opacity)
  } else if (stroke.type.startsWith('GRADIENT_')) {
    const layer = paintLayer(stroke, {}, node.id)
    if (layer) {
      style.borderImageSource = layer.image
      style.borderImageSlice = 1
    }
  }
  return style
}

function radiusStyle(node: FigmaCanvasNode): CSSProperties {
  if (node.type === 'ELLIPSE') return { borderRadius: '50%' }
  const corners = node.rectangleCornerRadii
  if (corners && corners.length >= 4) {
    return {
      borderRadius: `${finite(corners[0])}px ${finite(corners[1])}px ${finite(corners[2])}px ${finite(corners[3])}px`,
    }
  }
  return node.cornerRadius !== undefined ? { borderRadius: Math.max(node.cornerRadius, 0) } : {}
}

function effectStyle(effects: FigmaEffect[] | undefined): CSSProperties {
  const visible = effects?.filter((effect) => effect.visible !== false) ?? []
  const shadows = visible
    .filter((effect) => effect.type === 'DROP_SHADOW' || effect.type === 'INNER_SHADOW')
    .map((effect) => {
      const inset = effect.type === 'INNER_SHADOW' ? 'inset ' : ''
      return `${inset}${finite(effect.offset?.x)}px ${finite(effect.offset?.y)}px ${Math.max(finite(effect.radius), 0)}px ${finite(effect.spread)}px ${rgba(effect.color)}`
    })
  const blur = visible.find((effect) => effect.type === 'LAYER_BLUR')
  return {
    ...(shadows.length > 0 ? { boxShadow: shadows.join(', ') } : {}),
    ...(blur ? { filter: `blur(${Math.max(finite(blur.radius), 0)}px)` } : {}),
  }
}

function letterSpacing(value: FigmaTextStyle['letterSpacing']) {
  if (typeof value === 'number') return `${value}px`
  if (!value || value.value === undefined) return undefined
  return value.unit === 'PERCENT' ? `${value.value / 100}em` : `${value.value}px`
}

function textCase(value: string | undefined): CSSProperties['textTransform'] {
  if (value === 'UPPER') return 'uppercase'
  if (value === 'LOWER') return 'lowercase'
  if (value === 'TITLE') return 'capitalize'
  return undefined
}

function typographyStyle(style: FigmaTextStyle | undefined): CSSProperties {
  if (!style) return {}
  let lineHeight: string | undefined
  if (style.lineHeightPx !== undefined) lineHeight = `${style.lineHeightPx}px`
  else if (style.lineHeightPercentFontSize !== undefined) lineHeight = `${style.lineHeightPercentFontSize}%`
  else if (style.lineHeightPercent !== undefined) lineHeight = `${style.lineHeightPercent}%`
  const decoration = style.textDecoration === 'UNDERLINE'
    ? 'underline'
    : style.textDecoration === 'STRIKETHROUGH'
      ? 'line-through'
      : undefined
  return {
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    fontStyle: style.italic ? 'italic' : undefined,
    letterSpacing: letterSpacing(style.letterSpacing),
    lineHeight,
    textAlign: style.textAlignHorizontal?.toLowerCase() as CSSProperties['textAlign'],
    textTransform: textCase(style.textCase),
    textDecoration: decoration,
    textIndent: style.paragraphIndent,
  }
}

function textPaintStyle(
  paints: FigmaPaint[] | string | undefined,
  images: FigmaImageMap,
  nodeId: string,
): CSSProperties {
  const visible = Array.isArray(paints) ? paints.filter((paint) => paint.visible !== false) : []
  const solid = visible.find((paint) => paint.type === 'SOLID')
  const layers = paintStyle(visible.filter((paint) => paint.type !== 'SOLID'), images, nodeId)
  if (!layers.backgroundImage) return solid ? { color: rgba(solid.color, solid.opacity) } : {}
  return {
    ...layers,
    color: 'transparent',
    backgroundClip: 'text',
    WebkitBackgroundClip: 'text',
  }
}

function findNode(node: FigmaCanvasNode | undefined, id: string): FigmaCanvasNode | undefined {
  if (!node) return undefined
  if (node.id === id) return node
  for (const child of node.children ?? []) {
    const found = findNode(child, id)
    if (found) return found
  }
  return undefined
}

function unwrapDocument(file: FigmaFileLike, initialNodeId?: string) {
  if ('nodes' in file && file.nodes) {
    const entry = initialNodeId ? file.nodes[initialNodeId] : Object.values(file.nodes)[0]
    if (entry) {
      if ('document' in entry && entry.document) return entry.document
      if ('id' in entry) return entry
    }
  }
  if ('document' in file && file.document) return file.document
  return 'id' in file ? file : undefined
}

function resolveRoot(file: FigmaFileLike, initialNodeId?: string) {
  const document = unwrapDocument(file, initialNodeId)
  const requested = initialNodeId ? findNode(document, initialNodeId) : undefined
  if (requested) return requested
  if (document?.type === 'DOCUMENT') {
    return document.children?.find((child) => child.type === 'CANVAS' && child.visible !== false) ?? document
  }
  return document
}

function directBounds(node: FigmaCanvasNode, parentOrigin: Origin): FigmaRect | undefined {
  const absolute = node.absoluteBoundingBox ?? node.absoluteRenderBounds ?? undefined
  if (absolute) {
    return {
      x: finite(absolute.x),
      y: finite(absolute.y),
      width: Math.max(finite(absolute.width), 0),
      height: Math.max(finite(absolute.height), 0),
    }
  }
  if (!node.size) return undefined
  return {
    x: parentOrigin.x + finite(node.relativeTransform?.[0]?.[2]),
    y: parentOrigin.y + finite(node.relativeTransform?.[1]?.[2]),
    width: Math.max(finite(node.size.x), 0),
    height: Math.max(finite(node.size.y), 0),
  }
}

function sceneBounds(node: FigmaCanvasNode): FigmaRect | undefined {
  const own = directBounds(node, { x: 0, y: 0 })
  if (own && !STRUCTURAL_NODE_TYPES.has(node.type)) return own

  const boxes = (node.children ?? [])
    .filter((child) => child.visible !== false)
    .map(sceneBounds)
    .filter((box): box is FigmaRect => Boolean(box))
  if (boxes.length === 0) return own

  const left = Math.min(...boxes.map((box) => box.x))
  const top = Math.min(...boxes.map((box) => box.y))
  const right = Math.max(...boxes.map((box) => box.x + box.width))
  const bottom = Math.max(...boxes.map((box) => box.y + box.height))
  return { x: left, y: top, width: right - left, height: bottom - top }
}

function richTextRuns(node: FigmaCanvasNode, images: FigmaImageMap) {
  const text = node.characters ?? ''
  const overrides = node.characterStyleOverrides
  if (!overrides || overrides.length === 0 || !node.styleOverrideTable) return text

  const characters = Array.from(text)
  const runs: Array<{ key: number; value: string; styleId: number }> = []
  characters.forEach((character, index) => {
    const styleId = overrides[index] ?? 0
    const previous = runs[runs.length - 1]
    if (previous?.styleId === styleId) previous.value += character
    else runs.push({ key: index, value: character, styleId })
  })

  return runs.map((run) => {
    const override = node.styleOverrideTable?.[String(run.styleId)]
    return (
      <span
        key={run.key}
        style={{
          ...typographyStyle(override),
          ...textPaintStyle(override?.fills, images, node.id),
        }}
      >
        {run.value}
      </span>
    )
  })
}

type NodeViewProps = {
  node: FigmaCanvasNode
  parentOrigin: Origin
  scene: FigmaRect
  images: FigmaImageMap
  isRoot?: boolean
}

function NodeView({
  node,
  parentOrigin,
  scene,
  images,
  isRoot = false,
}: NodeViewProps): ReactElement | null {
  const { selectedNodeIds, selectNode } = useEditor()
  const selected = selectedNodeIds.includes(node.id)
  if (node.visible === false) return null
  const bounds = directBounds(node, parentOrigin)

  if (!bounds || STRUCTURAL_NODE_TYPES.has(node.type)) {
    return (
      <div
        data-figma-node-id={node.id}
        data-figma-node-type={node.type}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          event.stopPropagation()
          selectNode(node.id, { additive: event.shiftKey || event.metaKey })
        }}
        style={{
          position: 'absolute',
          inset: 0,
          outline: selected ? '1.5px solid #0d99ff' : undefined,
          outlineOffset: selected ? 1 : undefined,
        }}
      >
        {(node.children ?? []).length > 0
          ? renderChildNodes(
              node.children,
              { x: scene.x, y: scene.y, width: scene.width, height: scene.height },
              scene,
              images,
            )
          : null}
      </div>
    )
  }

  const fills = Array.isArray(node.fills) && node.fills.length > 0
    ? node.fills
    : node.background ?? node.backgrounds
  const isText = node.type === 'TEXT'
  const hasGeometry = Boolean(node.fillGeometry?.length)
  const isVectorLike =
    hasGeometry
    || node.type === 'BOOLEAN_OPERATION'
    || node.type === 'VECTOR'
    || node.type === 'STAR'
    || node.type === 'LINE'
    || node.type === 'REGULAR_POLYGON'
  const hasChildren = CONTAINER_NODE_TYPES.has(node.type) || Boolean(node.children?.length)
  const rotation = finite(node.rotation)
  const clip = geometryClipPath(node)
  const nodeStyle: CSSProperties = {
    position: 'absolute',
    left: isRoot ? 0 : bounds.x - parentOrigin.x,
    top: isRoot ? 0 : bounds.y - parentOrigin.y,
    width: bounds.width,
    height: bounds.height,
    boxSizing: 'border-box',
    opacity: clamp(finite(node.opacity, 1), 0, 1),
    overflow: node.clipsContent || isText ? 'hidden' : 'visible',
    transform: rotation ? `rotate(${rotation}deg)` : undefined,
    transformOrigin: 'center center',
    mixBlendMode: normalizeBlendMode(node.blendMode) as CSSProperties['mixBlendMode'],
    outline: selected ? '1.5px solid #0d99ff' : undefined,
    outlineOffset: selected ? 1 : undefined,
    ...(clip ? { clipPath: clip, WebkitClipPath: clip } : {}),
    ...radiusStyle(node),
    ...(isText || isVectorLike ? {} : paintStyle(fills, images, node.id)),
    ...(fills || isVectorLike ? {} : node.backgroundColor ? { backgroundColor: rgba(node.backgroundColor) } : {}),
    ...(isVectorLike ? {} : borderStyle(node)),
    ...effectStyle(node.effects),
  }

  if (isText) {
    const vertical = node.style?.textAlignVertical
    Object.assign(nodeStyle, {
      display: 'flex',
      flexDirection: 'column',
      justifyContent: vertical === 'CENTER' ? 'center' : vertical === 'BOTTOM' ? 'flex-end' : 'flex-start',
      whiteSpace: 'pre-wrap',
      overflowWrap: 'break-word',
      ...typographyStyle(node.style),
      ...textPaintStyle(node.fills, images, node.id),
    } satisfies CSSProperties)
  }

  return (
    <div
      data-figma-node-id={node.id}
      data-figma-node-type={node.type}
      data-figma-boolean={node.booleanOperation}
      title={node.name}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.stopPropagation()
        selectNode(node.id, { additive: event.shiftKey || event.metaKey })
      }}
      style={nodeStyle}
    >
      {isText ? richTextRuns(node, images) : null}
      {!isText && isVectorLike ? (
        <GeometryOverlay node={node} fills={fills} />
      ) : null}
      {!isText && !isVectorLike ? (
        <TransformedImageLayers paints={fills} images={images} nodeId={node.id} />
      ) : null}
      {hasChildren
        ? renderChildNodes(
            node.children,
            bounds,
            scene,
            images,
          )
        : null}
    </div>
  )
}

function normalizeImages(imageMap: FigmaCanvasProps['imageMap']): FigmaImageMap {
  if (!imageMap) return {}
  const nested = (imageMap as { images?: unknown }).images
  if (nested && typeof nested === 'object') return nested as FigmaImageMap
  return imageMap as FigmaImageMap
}

export default function FigmaCanvas({
  file,
  document,
  imageMap,
  initialNodeId,
  className = '',
}: FigmaCanvasProps) {
  const { selectNode, selectedNodeIds, zoom, setZoom, pan, setPan } = useEditor()
  const viewportRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ pointerId: number; x: number; y: number; panX: number; panY: number } | null>(null)
  const autoSelectKey = useRef<string | null>(null)
  const source = (file ?? document?.file) as FigmaFileLike | undefined
  const requestedNodeId = initialNodeId ?? document?.nodeId
  const root = useMemo(
    () => source ? resolveRoot(source, requestedNodeId) : undefined,
    [requestedNodeId, source],
  )
  const bounds = useMemo(() => root ? sceneBounds(root) : undefined, [root])
  const resolvedImageMap = imageMap ?? document?.images
  const images = useMemo(() => normalizeImages(resolvedImageMap), [resolvedImageMap])

  useEffect(() => {
    if (!requestedNodeId || !root) return
    const key = `${requestedNodeId}:${root.id}`
    if (autoSelectKey.current === key) return
    autoSelectKey.current = key
    selectNode(root.id)
  }, [requestedNodeId, root, selectNode])

  const beginPan = (event: PointerEvent<HTMLDivElement>) => {
    const blankPrimary = event.button === 0 && event.target === event.currentTarget
    const middleButton = event.button === 1
    if (!blankPrimary && !middleButton) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      panX: pan.x,
      panY: pan.y,
    }
  }

  const movePan = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return
    setPan({
      x: drag.current.panX + event.clientX - drag.current.x,
      y: drag.current.panY + event.clientY - drag.current.y,
    })
  }

  const endPan = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return
    drag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const wheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (!event.ctrlKey && !event.metaKey) {
      setPan({ x: pan.x - event.deltaX, y: pan.y - event.deltaY })
      return
    }

    const nextZoom = clamp(zoom * (event.deltaY > 0 ? 0.9 : 1.1), MIN_ZOOM, MAX_ZOOM)
    const rect = viewportRef.current?.getBoundingClientRect()
    if (rect) {
      const cursorX = event.clientX - (rect.left + rect.width / 2)
      const cursorY = event.clientY - (rect.top + rect.height / 2)
      const ratio = nextZoom / zoom
      setPan({
        x: cursorX - (cursorX - pan.x) * ratio,
        y: cursorY - (cursorY - pan.y) * ratio,
      })
    }
    setZoom(nextZoom)
  }

  if (!root || !bounds || bounds.width <= 0 || bounds.height <= 0) {
    return (
      <div className={`flex min-h-0 flex-1 items-center justify-center bg-[#f6f6f7] text-sm text-[#8a8a90] ${className}`}>
        此 Figma 页面没有可渲染的节点
      </div>
    )
  }

  return (
    <div
      ref={viewportRef}
      aria-label="Figma canvas"
      className={`relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-[#f6f6f7] ${className}`}
      style={{ touchAction: 'none' }}
      onPointerDown={beginPan}
      onPointerMove={movePan}
      onPointerUp={endPan}
      onPointerCancel={endPan}
      onWheel={wheel}
    >
      {selectedNodeIds.length > 0 ? (
        <div className="pointer-events-none absolute inset-x-0 top-4 z-10 flex justify-center">
          <div className="pointer-events-auto">
            <CanvasToolbar />
          </div>
        </div>
      ) : null}
      <div
        style={{
          position: 'relative',
          width: bounds.width,
          height: bounds.height,
          flex: '0 0 auto',
          transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
          transformOrigin: 'center center',
        }}
      >
        <Fragment>
          <NodeView
            node={root}
            parentOrigin={{ x: bounds.x, y: bounds.y }}
            scene={bounds}
            images={images}
            isRoot={!STRUCTURAL_NODE_TYPES.has(root.type)}
          />
        </Fragment>
      </div>
    </div>
  )
}
