/**
 * The subset of Figma's REST schema used by the importer and canvas renderer.
 *
 * Figma adds node fields over time, so the node and response types deliberately
 * remain open to unknown fields while strongly typing the rendering primitives
 * this project consumes.
 */

export type FigmaNodeType =
  | 'DOCUMENT'
  | 'CANVAS'
  | 'FRAME'
  | 'GROUP'
  | 'SECTION'
  | 'SLICE'
  | 'COMPONENT'
  | 'COMPONENT_SET'
  | 'INSTANCE'
  | 'BOOLEAN_OPERATION'
  | 'VECTOR'
  | 'STAR'
  | 'LINE'
  | 'ELLIPSE'
  | 'REGULAR_POLYGON'
  | 'RECTANGLE'
  | 'TEXT'
  | 'TABLE'
  | 'TABLE_CELL'
  | 'STICKY'
  | 'SHAPE_WITH_TEXT'
  | 'CONNECTOR'
  | 'WASHI_TAPE'
  | 'STAMP'
  | 'MEDIA'
  | 'HIGHLIGHT'
  | 'WIDGET'
  | 'EMBED'
  | 'LINK_UNFURL'
  | 'CODE_BLOCK'
  | 'SLIDE'
  | 'SLIDE_ROW'
  | 'INTERACTIVE_SLIDE_ELEMENT'
  | (string & {})

export type FigmaBlendMode =
  | 'PASS_THROUGH'
  | 'NORMAL'
  | 'DARKEN'
  | 'MULTIPLY'
  | 'LINEAR_BURN'
  | 'COLOR_BURN'
  | 'LIGHTEN'
  | 'SCREEN'
  | 'LINEAR_DODGE'
  | 'COLOR_DODGE'
  | 'OVERLAY'
  | 'SOFT_LIGHT'
  | 'HARD_LIGHT'
  | 'DIFFERENCE'
  | 'EXCLUSION'
  | 'HUE'
  | 'SATURATION'
  | 'COLOR'
  | 'LUMINOSITY'
  | (string & {})

export interface FigmaVector {
  x: number
  y: number
}

export interface FigmaRectangle extends FigmaVector {
  width: number
  height: number
}

export interface FigmaColor {
  r: number
  g: number
  b: number
  a?: number
}

export type FigmaTransform = [
  [number, number, number],
  [number, number, number],
]

export interface FigmaColorStop {
  position: number
  color: FigmaColor
}

export interface FigmaPaint {
  type:
    | 'SOLID'
    | 'GRADIENT_LINEAR'
    | 'GRADIENT_RADIAL'
    | 'GRADIENT_ANGULAR'
    | 'GRADIENT_DIAMOND'
    | 'IMAGE'
    | 'EMOJI'
    | 'VIDEO'
    | (string & {})
  visible?: boolean
  opacity?: number
  blendMode?: FigmaBlendMode
  color?: FigmaColor
  gradientHandlePositions?: FigmaVector[]
  gradientStops?: FigmaColorStop[]
  scaleMode?: 'FILL' | 'FIT' | 'TILE' | 'STRETCH' | (string & {})
  imageRef?: string
  imageTransform?: FigmaTransform
  scalingFactor?: number
  rotation?: number
  filters?: {
    exposure?: number
    contrast?: number
    saturation?: number
    temperature?: number
    tint?: number
    highlights?: number
    shadows?: number
  }
  [field: string]: unknown
}

export interface FigmaEffect {
  type:
    | 'INNER_SHADOW'
    | 'DROP_SHADOW'
    | 'LAYER_BLUR'
    | 'BACKGROUND_BLUR'
    | 'TEXTURE'
    | (string & {})
  visible?: boolean
  radius?: number
  color?: FigmaColor
  blendMode?: FigmaBlendMode
  offset?: FigmaVector
  spread?: number
  showShadowBehindNode?: boolean
  [field: string]: unknown
}

export interface FigmaPath {
  path: string
  windingRule: 'NONZERO' | 'EVENODD' | (string & {})
  overrideID?: number
}

export interface FigmaArcData {
  startingAngle: number
  endingAngle: number
  innerRadius: number
}

export interface FigmaTypeStyle {
  fontFamily?: string
  fontPostScriptName?: string | null
  fontStyle?: string
  fontWeight?: number
  fontSize?: number
  textAlignHorizontal?: 'LEFT' | 'RIGHT' | 'CENTER' | 'JUSTIFIED' | (string & {})
  textAlignVertical?: 'TOP' | 'CENTER' | 'BOTTOM' | (string & {})
  letterSpacing?: number
  lineHeightPx?: number
  lineHeightPercent?: number
  lineHeightPercentFontSize?: number
  lineHeightUnit?: 'PIXELS' | 'FONT_SIZE_%' | 'INTRINSIC_%' | (string & {})
  textCase?: 'ORIGINAL' | 'UPPER' | 'LOWER' | 'TITLE' | 'SMALL_CAPS' | 'SMALL_CAPS_FORCED' | (string & {})
  textDecoration?: 'NONE' | 'STRIKETHROUGH' | 'UNDERLINE' | (string & {})
  paragraphSpacing?: number
  paragraphIndent?: number
  italic?: boolean
  fills?: FigmaPaint[]
  hyperlink?: {
    type: 'URL' | 'NODE' | (string & {})
    url?: string
    nodeID?: string
  }
  opentypeFlags?: Record<string, number>
  [field: string]: unknown
}

export interface FigmaExportSetting {
  suffix: string
  format: 'JPG' | 'PNG' | 'SVG' | 'PDF' | (string & {})
  constraint: {
    type: 'SCALE' | 'WIDTH' | 'HEIGHT' | (string & {})
    value: number
  }
}

export interface FigmaComponentProperty {
  type: 'BOOLEAN' | 'INSTANCE_SWAP' | 'TEXT' | 'VARIANT' | (string & {})
  value: boolean | string
  preferredValues?: Array<{
    type: 'COMPONENT' | 'COMPONENT_SET' | (string & {})
    key: string
  }>
}

export interface FigmaNode {
  id: string
  name: string
  type: FigmaNodeType
  children?: FigmaNode[]
  visible?: boolean
  locked?: boolean
  opacity?: number
  blendMode?: FigmaBlendMode
  isMask?: boolean
  maskType?: 'ALPHA' | 'VECTOR' | 'LUMINANCE' | (string & {})
  clipsContent?: boolean
  preserveRatio?: boolean
  absoluteBoundingBox?: FigmaRectangle
  absoluteRenderBounds?: FigmaRectangle | null
  size?: FigmaVector
  relativeTransform?: FigmaTransform
  absoluteTransform?: FigmaTransform
  minWidth?: number | null
  maxWidth?: number | null
  minHeight?: number | null
  maxHeight?: number | null
  constraints?: {
    vertical: 'TOP' | 'BOTTOM' | 'CENTER' | 'TOP_BOTTOM' | 'SCALE' | (string & {})
    horizontal: 'LEFT' | 'RIGHT' | 'CENTER' | 'LEFT_RIGHT' | 'SCALE' | (string & {})
  }
  fills?: FigmaPaint[]
  fillGeometry?: FigmaPath[]
  fillOverrideTable?: Record<string, FigmaPaint[] | null>
  strokes?: FigmaPaint[]
  strokeGeometry?: FigmaPath[]
  strokeWeight?: number
  strokeAlign?: 'INSIDE' | 'OUTSIDE' | 'CENTER' | (string & {})
  strokeCap?: 'NONE' | 'ROUND' | 'SQUARE' | 'LINE_ARROW' | 'TRIANGLE_ARROW' | (string & {})
  strokeJoin?: 'MITER' | 'BEVEL' | 'ROUND' | (string & {})
  strokeDashes?: number[]
  cornerRadius?: number
  rectangleCornerRadii?: [number, number, number, number]
  cornerSmoothing?: number
  effects?: FigmaEffect[]
  backgroundColor?: FigmaColor
  backgrounds?: FigmaPaint[]
  exportSettings?: FigmaExportSetting[]
  arcData?: FigmaArcData
  booleanOperation?: 'UNION' | 'INTERSECT' | 'SUBTRACT' | 'EXCLUDE' | (string & {})
  characters?: string
  style?: FigmaTypeStyle
  characterStyleOverrides?: number[]
  styleOverrideTable?: Record<string, FigmaTypeStyle>
  lineTypes?: Array<'NONE' | 'ORDERED' | 'UNORDERED' | (string & {})>
  lineIndentations?: number[]
  componentId?: string
  componentProperties?: Record<string, FigmaComponentProperty>
  layoutMode?: 'NONE' | 'HORIZONTAL' | 'VERTICAL' | 'GRID' | (string & {})
  primaryAxisSizingMode?: 'FIXED' | 'AUTO' | (string & {})
  counterAxisSizingMode?: 'FIXED' | 'AUTO' | (string & {})
  primaryAxisAlignItems?: 'MIN' | 'MAX' | 'CENTER' | 'SPACE_BETWEEN' | (string & {})
  counterAxisAlignItems?: 'MIN' | 'MAX' | 'CENTER' | 'BASELINE' | (string & {})
  itemSpacing?: number
  paddingLeft?: number
  paddingRight?: number
  paddingTop?: number
  paddingBottom?: number
  layoutAlign?: 'INHERIT' | 'STRETCH' | 'MIN' | 'CENTER' | 'MAX' | (string & {})
  layoutGrow?: number
  layoutPositioning?: 'AUTO' | 'ABSOLUTE' | (string & {})
  itemReverseZIndex?: boolean
  strokesIncludedInLayout?: boolean
  [field: string]: unknown
}

export interface FigmaComponentMetadata {
  key: string
  name: string
  description: string
  remote: boolean
  componentSetId?: string
  documentationLinks?: Array<{ uri: string }>
}

export interface FigmaComponentSetMetadata {
  key: string
  name: string
  description: string
  remote: boolean
  documentationLinks?: Array<{ uri: string }>
}

export interface FigmaStyleMetadata {
  key: string
  name: string
  styleType: 'FILL' | 'TEXT' | 'EFFECT' | 'GRID' | (string & {})
  remote: boolean
  description: string
}

export interface FigmaFileResponse {
  name: string
  document: FigmaNode
  components: Record<string, FigmaComponentMetadata>
  componentSets?: Record<string, FigmaComponentSetMetadata>
  styles: Record<string, FigmaStyleMetadata>
  schemaVersion: number
  lastModified: string
  thumbnailUrl?: string
  version: string
  role?: string
  editorType?: string
  linkAccess?: string
  mainFileKey?: string
  branches?: Array<{
    key: string
    name: string
    thumbnail_url?: string
    last_modified?: string
    link_access?: string
  }>
  [field: string]: unknown
}

export interface FigmaFileImagesResponse {
  error?: boolean
  status?: number
  images: Record<string, string | null>
}

export interface FigmaFileReference {
  key: string
  nodeId?: string
}

export interface ImportedFigmaFile extends FigmaFileReference {
  file: FigmaFileResponse
  images: Record<string, string>
}
