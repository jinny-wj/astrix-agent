import type {
  FigmaEditIntent,
  FigmaSelectionSnapshot,
  FigmaSolidColor,
} from '../src/types/figmaWrite'

export type FigmaInstructionErrorCode =
  | 'EMPTY_INSTRUCTION'
  | 'NO_SELECTION'
  | 'LOCKED_SELECTION'
  | 'UNSUPPORTED_INSTRUCTION'
  | 'UNSUPPORTED_SELECTION'
  | 'INVALID_VALUE'

export type FigmaInstructionParseResult =
  | {
      ok: true
      patches: FigmaEditIntent[]
      summary: string
    }
  | {
      ok: false
      code: FigmaInstructionErrorCode
      message: string
    }

const MAX_INSTRUCTION_LENGTH = 2_000
const MAX_TEXT_LENGTH = 20_000
const MAX_NAME_LENGTH = 300
const MAX_DIMENSION = 100_000
const MAX_COORDINATE = 1_000_000

const COLOR_NAMES: Record<string, FigmaSolidColor> = {
  白: { r: 1, g: 1, b: 1 },
  黑: { r: 0, g: 0, b: 0 },
  红: { r: 1, g: 0.12, b: 0.12 },
  蓝: { r: 0.12, g: 0.38, b: 1 },
  绿: { r: 0.12, g: 0.72, b: 0.36 },
  黄: { r: 1, g: 0.82, b: 0.08 },
  紫: { r: 0.55, g: 0.25, b: 0.9 },
  橙: { r: 1, g: 0.48, b: 0.08 },
  粉: { r: 1, g: 0.38, b: 0.62 },
  灰: { r: 0.5, g: 0.5, b: 0.5 },
  青: { r: 0.05, g: 0.75, b: 0.78 },
  金: { r: 0.85, g: 0.64, b: 0.25 },
}

type ResizePatch = Extract<FigmaEditIntent, { kind: 'resize' }>
type MovePatch = Extract<FigmaEditIntent, { kind: 'move' }>
type ScalePatch = Extract<FigmaEditIntent, { kind: 'scale' }>

function fail(
  code: FigmaInstructionErrorCode,
  message: string,
): FigmaInstructionParseResult {
  return { ok: false, code, message }
}

function splitClauses(input: string) {
  const clauses: string[] = []
  let clause = ''
  let quote = ''
  let parenthesesDepth = 0

  for (const character of input) {
    if (quote) {
      clause += character
      if (
        character === quote
        || (quote === '”' && character === '”')
        || (quote === '’' && character === '’')
      ) {
        quote = ''
      }
      continue
    }

    if (character === '「') quote = '」'
    else if (character === '“') quote = '”'
    else if (character === '‘') quote = '’'
    else if (character === '"' || character === "'") quote = character

    if (character === '(' || character === '（') parenthesesDepth += 1
    if (character === ')' || character === '）') {
      parenthesesDepth = Math.max(0, parenthesesDepth - 1)
    }

    if (
      !quote
      && parenthesesDepth === 0
      && /[,，;；\n]/.test(character)
    ) {
      if (clause.trim()) clauses.push(clause.trim())
      clause = ''
      continue
    }

    clause += character
  }

  if (clause.trim()) clauses.push(clause.trim())
  return clauses
}

function normalizeClause(input: string) {
  return input
    .trim()
    .replace(/^(?:请|麻烦)?\s*(?:帮我)?\s*(?:把|将)?\s*/, '')
    .replace(
      /^(?:当前|这个|这些|所选|选中(?:的)?|全部|所有)\s*(?:图层|节点)\s*(?:的)?\s*(?:(?:统一|一起|都|同时|批量|集体|整体)\s*)?/,
      '',
    )
    .replace(
      /^(?:(?:全部|所有|这些|所选|选中(?:的)?|多个?)\s*)?(?:人物|角色)\s*(?:(?:图层|节点)\s*)?(?:(?:统一|一起|都|同时|批量|集体|整体)\s*)?/,
      '',
    )
    .trim()
}

function stripWrappingQuotes(input: string) {
  const value = input.trim()
  const pairs: Array<[string, string]> = [
    ['「', '」'],
    ['“', '”'],
    ['‘', '’'],
    ['"', '"'],
    ["'", "'"],
  ]
  for (const [open, close] of pairs) {
    if (value.startsWith(open) && value.endsWith(close)) {
      return value.slice(open.length, -close.length).trim()
    }
  }
  return value
}

function parseNumber(value: string) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function colorFromHex(value: string): FigmaSolidColor | null {
  const match = /^#([0-9a-f]{3,8})$/i.exec(value.trim())
  if (!match) return null
  let hex = match[1]
  if (hex.length === 3 || hex.length === 4) {
    hex = [...hex].map((character) => `${character}${character}`).join('')
  }
  if (hex.length !== 6 && hex.length !== 8) return null
  const r = Number.parseInt(hex.slice(0, 2), 16) / 255
  const g = Number.parseInt(hex.slice(2, 4), 16) / 255
  const b = Number.parseInt(hex.slice(4, 6), 16) / 255
  const a = hex.length === 8
    ? Number.parseInt(hex.slice(6, 8), 16) / 255
    : undefined
  return a === undefined ? { r, g, b } : { r, g, b, a }
}

function colorFromRgb(value: string): FigmaSolidColor | null {
  const match = /^rgba?\s*[（(]\s*([^）)]+)\s*[）)]$/i.exec(value.trim())
  if (!match) return null
  const parts = match[1].split(/[,，]/).map((part) => part.trim())
  if (parts.length !== 3 && parts.length !== 4) return null
  const channels = parts.slice(0, 3).map(parseNumber)
  if (
    channels.some((channel) => channel === null || channel < 0 || channel > 255)
  ) {
    return null
  }
  const alphaPart = parts[3]
  let alpha: number | undefined
  if (alphaPart !== undefined) {
    if (alphaPart.endsWith('%')) {
      const percentage = parseNumber(alphaPart.slice(0, -1))
      if (percentage === null || percentage < 0 || percentage > 100) return null
      alpha = percentage / 100
    } else {
      const parsed = parseNumber(alphaPart)
      if (parsed === null || parsed < 0 || parsed > 1) return null
      alpha = parsed
    }
  }
  const [r, g, b] = channels as [number, number, number]
  return alpha === undefined
    ? { r: r / 255, g: g / 255, b: b / 255 }
    : { r: r / 255, g: g / 255, b: b / 255, a: alpha }
}

function parseColor(input: string) {
  const value = stripWrappingQuotes(input).replace(/色$/, '').trim()
  return colorFromHex(value) ?? colorFromRgb(value) ?? COLOR_NAMES[value] ?? null
}

function upsertResize(patches: FigmaEditIntent[], update: Omit<ResizePatch, 'kind'>) {
  const existing = patches.find(
    (patch): patch is ResizePatch => patch.kind === 'resize',
  )
  if (existing) Object.assign(existing, update)
  else patches.push({ kind: 'resize', ...update })
}

function upsertMove(patches: FigmaEditIntent[], update: Omit<MovePatch, 'kind'>) {
  const existing = patches.find(
    (patch): patch is MovePatch => patch.kind === 'move',
  )
  if (existing) Object.assign(existing, update)
  else patches.push({ kind: 'move', ...update })
}

function upsertScale(patches: FigmaEditIntent[], factor: number) {
  const existing = patches.find(
    (patch): patch is ScalePatch => patch.kind === 'scale',
  )
  if (existing) existing.factor *= factor
  else patches.push({ kind: 'scale', factor })
}

function parseScaleClause(
  clause: string,
  patches: FigmaEditIntent[],
): FigmaInstructionParseResult | null {
  const relativeMatch = /^(?:(?:全部|所有|这些|所选)\s*)?(?:(?:人物|角色|图层|节点)\s*)?(?:统一|一起|都|同时|批量|集体|整体)?\s*(放大|变大|缩小|变小)\s*(\d+(?:\.\d+)?)\s*(%|％|倍)$/.exec(clause)
  if (relativeMatch) {
    const amount = parseNumber(relativeMatch[2])
    if (amount === null || amount <= 0) {
      return fail('INVALID_VALUE', '缩放数值必须大于 0。')
    }
    const unit = relativeMatch[3]
    const enlarging = relativeMatch[1] === '放大' || relativeMatch[1] === '变大'
    const factor = unit === '倍'
      ? enlarging ? amount : 1 / amount
      : enlarging ? 1 + amount / 100 : 1 - amount / 100
    if (!Number.isFinite(factor) || factor < 0.05 || factor > 20) {
      return fail('INVALID_VALUE', '缩放后的倍数必须在 0.05–20 之间。')
    }
    upsertScale(patches, factor)
    return { ok: true, patches, summary: '' }
  }

  const absoluteMatch = /^(?:(?:全部|所有|这些|所选)\s*)?(?:(?:人物|角色|图层|节点)\s*)?(?:整体\s*)?缩放(?:到|为|成)\s*(\d+(?:\.\d+)?)\s*(%|％|倍)$/.exec(clause)
  if (!absoluteMatch) return null
  const amount = parseNumber(absoluteMatch[1])
  if (amount === null || amount <= 0) {
    return fail('INVALID_VALUE', '缩放数值必须大于 0。')
  }
  const factor = absoluteMatch[2] === '倍' ? amount : amount / 100
  if (!Number.isFinite(factor) || factor < 0.05 || factor > 20) {
    return fail('INVALID_VALUE', '缩放后的倍数必须在 0.05–20 之间。')
  }
  upsertScale(patches, factor)
  return { ok: true, patches, summary: '' }
}

function parseDimensionClause(
  clause: string,
  patches: FigmaEditIntent[],
): FigmaInstructionParseResult | null {
  const sizeMatch = /^(?:尺寸|大小)\s*(?:(?:修改|改|设置|设|调整)(?:成|为)|调到)?\s*[:：]?\s*(-?\d+(?:\.\d+)?)\s*(?:x|×|\*)\s*(-?\d+(?:\.\d+)?)\s*(?:px)?$/i.exec(clause)
  if (sizeMatch) {
    const width = parseNumber(sizeMatch[1])
    const height = parseNumber(sizeMatch[2])
    if (width === null || height === null || width <= 0 || height <= 0) {
      return fail('INVALID_VALUE', '宽度和高度必须是大于 0 的数字。')
    }
    upsertResize(patches, {
      width: { mode: 'set', value: width },
      height: { mode: 'set', value: height },
    })
    return { ok: true, patches, summary: '' }
  }

  const dimensionMatch = /^(宽度?|高度?)\s*(?:(增加|增大|加|减少|减小|减|缩小)\s*|(?:(?:修改|改|设置|设|调整)(?:成|为)|调到|为)?\s*[:：]?\s*)(-?\d+(?:\.\d+)?)\s*(?:px)?$/.exec(clause)
  if (!dimensionMatch) return null
  const axis = dimensionMatch[1].startsWith('宽') ? 'width' : 'height'
  const operation = dimensionMatch[2]
  const parsed = parseNumber(dimensionMatch[3])
  if (parsed === null) return fail('INVALID_VALUE', '尺寸必须是有效数字。')
  const decreasing = /减少|减小|减|缩小/.test(operation ?? '')
  const mode = operation ? 'delta' : 'set'
  const value = decreasing ? -Math.abs(parsed) : parsed
  if (mode === 'set' && value <= 0) {
    return fail('INVALID_VALUE', '尺寸必须大于 0。')
  }
  upsertResize(patches, { [axis]: { mode, value } })
  return { ok: true, patches, summary: '' }
}

function parseMoveClause(
  clause: string,
  patches: FigmaEditIntent[],
): FigmaInstructionParseResult | null {
  const absoluteMatch = /^(?:移动到|移到|位置\s*(?:(?:修改|改|设置|设)(?:成|为))?)\s*[:：]?\s*(?:x\s*=\s*(-?\d+(?:\.\d+)?))?\s*(?:[,，]?\s*)?(?:y\s*=\s*(-?\d+(?:\.\d+)?))?$/i.exec(clause)
  if (absoluteMatch && (absoluteMatch[1] !== undefined || absoluteMatch[2] !== undefined)) {
    const x = absoluteMatch[1] === undefined ? null : parseNumber(absoluteMatch[1])
    const y = absoluteMatch[2] === undefined ? null : parseNumber(absoluteMatch[2])
    upsertMove(patches, {
      ...(x === null ? {} : { x: { mode: 'set', value: x } as const }),
      ...(y === null ? {} : { y: { mode: 'set', value: y } as const }),
    })
    return { ok: true, patches, summary: '' }
  }

  const directionMatch = /^(?:向)?(右|左|上|下)(?:移动|移)\s*(-?\d+(?:\.\d+)?)\s*(?:px)?$/.exec(clause)
    ?? /^(右移|左移|上移|下移)\s*(-?\d+(?:\.\d+)?)\s*(?:px)?$/.exec(clause)
  if (!directionMatch) return null

  const rawDirection = directionMatch[1]
  const direction = rawDirection.charAt(0)
  const amount = parseNumber(directionMatch[2])
  if (amount === null) return fail('INVALID_VALUE', '移动距离必须是有效数字。')
  const signed = direction === '左' || direction === '上'
    ? -Math.abs(amount)
    : Math.abs(amount)
  if (direction === '左' || direction === '右') {
    upsertMove(patches, { x: { mode: 'delta', value: signed } })
  } else {
    upsertMove(patches, { y: { mode: 'delta', value: signed } })
  }
  return { ok: true, patches, summary: '' }
}

function parseClause(
  rawClause: string,
  selection: FigmaSelectionSnapshot,
  patches: FigmaEditIntent[],
): FigmaInstructionParseResult {
  const clause = normalizeClause(rawClause)

  if (/^(?:取消隐藏|显示|设为显示|设置为显示|设为可见|设置为可见)$/.test(clause)) {
    patches.push({ kind: 'set-visible', value: true })
    return { ok: true, patches, summary: '' }
  }
  if (/^(?:隐藏|设为隐藏|设置为隐藏|设为不可见|设置为不可见)$/.test(clause)) {
    patches.push({ kind: 'set-visible', value: false })
    return { ok: true, patches, summary: '' }
  }

  const textMatch = /^(?:文字|文案|文本|内容|标题)\s*(?:(?:修改|改|替换|设置|设|换)(?:成|为)|变成|写成)\s*[:：]?\s*(.+)$/.exec(clause)
  if (textMatch) {
    const value = stripWrappingQuotes(textMatch[1])
    if (!value) return fail('INVALID_VALUE', '新文字不能为空。')
    if (value.length > MAX_TEXT_LENGTH) {
      return fail('INVALID_VALUE', `文字不能超过 ${MAX_TEXT_LENGTH} 个字符。`)
    }
    patches.push({ kind: 'replace-text', value })
    return { ok: true, patches, summary: '' }
  }

  const colorMatch = /^(?:(?:文字|字体)?颜色|填充(?:颜色)?|背景(?:颜色|色)?)\s*(?:(?:修改|改|设置|设|换)(?:成|为)|变成)?\s*[:：]?\s*(.+)$/.exec(clause)
  if (colorMatch) {
    const color = parseColor(colorMatch[1])
    if (!color) {
      return fail(
        'INVALID_VALUE',
        '无法识别这个颜色。请使用 #3366FF、rgb(51, 102, 255) 或常用中文色名。',
      )
    }
    patches.push({ kind: 'set-fill-color', color })
    return { ok: true, patches, summary: '' }
  }

  const opacityMatch = /^(?:透明度|不透明度)\s*(?:(?:修改|改|设置|设|调整)(?:成|为)|调到)?\s*[:：]?\s*(-?\d+(?:\.\d+)?)\s*(%)?$/.exec(clause)
  if (opacityMatch) {
    const parsed = parseNumber(opacityMatch[1])
    if (parsed === null) return fail('INVALID_VALUE', '透明度必须是有效数字。')
    const value = opacityMatch[2] || parsed > 1 ? parsed / 100 : parsed
    if (value < 0 || value > 1) {
      return fail('INVALID_VALUE', '透明度请输入 0–100% 或 0–1。')
    }
    patches.push({ kind: 'set-opacity', value })
    return { ok: true, patches, summary: '' }
  }

  const renameMatch = /^(?:(?:图层|节点)\s*)?(?:(?:名称|名字|图层名|节点名)\s*)?(?:重命名为|命名为|(?:修改|改|设置|设)(?:成|为))\s*[:：]?\s*(.+)$/.exec(clause)
  if (renameMatch && /^(?:(?:图层|节点)\s*)?(?:重命名为|命名为|名称|名字|图层名|节点名)/.test(clause)) {
    const value = stripWrappingQuotes(renameMatch[1])
    if (!value) return fail('INVALID_VALUE', '图层名称不能为空。')
    if (value.length > MAX_NAME_LENGTH) {
      return fail('INVALID_VALUE', `图层名称不能超过 ${MAX_NAME_LENGTH} 个字符。`)
    }
    patches.push({ kind: 'rename', value })
    return { ok: true, patches, summary: '' }
  }

  const scale = parseScaleClause(clause, patches)
  if (scale) return scale
  const dimension = parseDimensionClause(clause, patches)
  if (dimension) return dimension
  const movement = parseMoveClause(clause, patches)
  if (movement) return movement

  const colorShorthand = /^(?:改成|改为|换成|变成)\s*(.+)$/.exec(clause)
  if (colorShorthand) {
    const color = parseColor(colorShorthand[1])
    if (
      color
      && (
        selection.nodes.length === 0
        || selection.nodes.some((node) => node.supports.fill)
      )
    ) {
      patches.push({ kind: 'set-fill-color', color })
      return { ok: true, patches, summary: '' }
    }
  }

  const genericTextMatch = /^(?:改成|改为|换成|替换为)\s*[:：]?\s*(.+)$/.exec(clause)
  if (genericTextMatch && selection.nodes.every((node) => node.supports.text)) {
    const value = stripWrappingQuotes(genericTextMatch[1])
    if (!value) return fail('INVALID_VALUE', '新文字不能为空。')
    patches.push({ kind: 'replace-text', value })
    return { ok: true, patches, summary: '' }
  }

  return fail(
    'UNSUPPORTED_INSTRUCTION',
    `暂时无法理解“${rawClause}”。可尝试：文字改成「立即购买」、颜色改为 #3366FF、透明度 50%、尺寸 300×200、右移 20px、隐藏或重命名。`,
  )
}

function formatColor(color: FigmaSolidColor) {
  const toHex = (channel: number) => Math.round(channel * 255)
    .toString(16)
    .padStart(2, '0')
    .toUpperCase()
  const alpha = color.a === undefined ? '' : toHex(color.a)
  return `#${toHex(color.r)}${toHex(color.g)}${toHex(color.b)}${alpha}`
}

function describePatches(patches: FigmaEditIntent[]) {
  return patches.map((patch) => {
    switch (patch.kind) {
      case 'replace-text':
        return `文字改为“${patch.value.length > 20 ? `${patch.value.slice(0, 20)}…` : patch.value}”`
      case 'set-fill-color':
        return `填充改为 ${formatColor(patch.color)}`
      case 'set-opacity':
        return `透明度改为 ${Math.round(patch.value * 100)}%`
      case 'resize':
        return '调整尺寸'
      case 'move':
        return '调整位置'
      case 'scale':
        return `整体缩放到 ${Math.round(patch.factor * 1000) / 10}%`
      case 'set-visible':
        return patch.value ? '显示图层' : '隐藏图层'
      case 'rename':
        return `重命名为“${patch.value}”`
    }
  })
}

function validatePatches(
  patches: FigmaEditIntent[],
  selection: FigmaSelectionSnapshot,
): FigmaInstructionParseResult | null {
  const supportFor = (patch: FigmaEditIntent) => {
    switch (patch.kind) {
      case 'replace-text': return 'text' as const
      case 'set-fill-color': return 'fill' as const
      case 'set-opacity': return 'opacity' as const
      case 'resize': return 'resize' as const
      case 'move': return 'move' as const
      case 'scale': return 'resize' as const
      case 'set-visible': return 'visibility' as const
      case 'rename': return 'rename' as const
    }
  }

  for (const patch of patches) {
    const support = supportFor(patch)
    const unsupported = selection.nodes.filter((node) => !node.supports[support])
    if (unsupported.length > 0) {
      const names = unsupported.slice(0, 3).map((node) => `“${node.name}”`).join('、')
      return fail(
        'UNSUPPORTED_SELECTION',
        `${names}${unsupported.length > 3 ? ' 等图层' : ''}不支持这项修改。请重新选择兼容图层。`,
      )
    }

    if (patch.kind === 'resize') {
      for (const key of ['width', 'height'] as const) {
        const adjustment = patch[key]
        if (!adjustment) continue
        if (
          !Number.isFinite(adjustment.value)
          || Math.abs(adjustment.value) > MAX_DIMENSION
          || (adjustment.mode === 'set' && adjustment.value <= 0)
        ) {
          return fail('INVALID_VALUE', `尺寸必须在 0–${MAX_DIMENSION} 之间。`)
        }
        if (adjustment.mode === 'delta') {
          const invalidNode = selection.nodes.find((node) => {
            const current = key === 'width' ? node.width : node.height
            return current === undefined || current + adjustment.value <= 0
          })
          if (invalidNode) {
            return fail(
              'INVALID_VALUE',
              `修改后“${invalidNode.name}”的${key === 'width' ? '宽度' : '高度'}必须大于 0。`,
            )
          }
        }
      }
    }

    if (patch.kind === 'move') {
      for (const adjustment of [patch.x, patch.y]) {
        if (
          adjustment
          && (!Number.isFinite(adjustment.value)
            || Math.abs(adjustment.value) > MAX_COORDINATE)
        ) {
          return fail(
            'INVALID_VALUE',
            `位置数值必须在 -${MAX_COORDINATE}–${MAX_COORDINATE} 之间。`,
          )
        }
      }
    }

    if (patch.kind === 'scale') {
      if (!Number.isFinite(patch.factor) || patch.factor < 0.05 || patch.factor > 20) {
        return fail('INVALID_VALUE', '缩放倍数必须在 0.05–20 之间。')
      }
      const invalidNode = selection.nodes.find((node) => (
        node.width === undefined
        || node.height === undefined
        || node.width * patch.factor <= 0
        || node.height * patch.factor <= 0
        || node.width * patch.factor > MAX_DIMENSION
        || node.height * patch.factor > MAX_DIMENSION
      ))
      if (invalidNode) {
        return fail(
          'INVALID_VALUE',
          `缩放后“${invalidNode.name}”的尺寸必须在 0–${MAX_DIMENSION} 之间。`,
        )
      }
    }
  }
  return null
}

export function parseFigmaInstruction(
  message: string,
  selection: FigmaSelectionSnapshot,
): FigmaInstructionParseResult {
  const input = message.trim()
  if (!input) return fail('EMPTY_INSTRUCTION', '请输入要执行的修改。')
  if (input.length > MAX_INSTRUCTION_LENGTH) {
    return fail(
      'INVALID_VALUE',
      `单次指令不能超过 ${MAX_INSTRUCTION_LENGTH} 个字符。`,
    )
  }
  const patches: FigmaEditIntent[] = []
  const clauses = splitClauses(input)
  for (const clause of clauses) {
    const parsed = parseClause(clause, selection, patches)
    if (!parsed.ok) return parsed
  }
  if (patches.length === 0) {
    return fail('UNSUPPORTED_INSTRUCTION', '没有识别到可执行的图层修改。')
  }
  if (selection.nodes.length === 0) {
    return fail('NO_SELECTION', '请先在 Figma 中选择至少一个图层。')
  }
  const locked = selection.nodes.filter((node) => node.locked)
  if (locked.length > 0) {
    return fail(
      'LOCKED_SELECTION',
      `“${locked[0].name}”处于锁定状态，请先在 Figma 中解锁。`,
    )
  }

  const validation = validatePatches(patches, selection)
  if (validation) return validation
  const actions = describePatches(patches).join('、')
  return {
    ok: true,
    patches,
    summary: `将对 ${selection.nodes.length} 个图层执行：${actions}`,
  }
}

export type FigmaCreateDraft =
  | {
      type: 'create-frame'
      name: string
      x: number
      y: number
      width: number
      height: number
      fills?: FigmaSolidColor[]
    }
  | {
      type: 'create-text'
      characters: string
      x: number
      y: number
      fontSize?: number
      name?: string
      fills?: FigmaSolidColor[]
    }
  | {
      type: 'clone-into-frame'
      name: string
      x: number
      y: number
      width: number
      height: number
      fills?: FigmaSolidColor[]
      labels: Array<{
        characters: string
        x: number
        y: number
        fontSize?: number
        name?: string
      }>
    }

export type FigmaCreateParseResult =
  | {
      ok: true
      drafts: FigmaCreateDraft[]
      summary: string
    }
  | {
      ok: false
      code: 'UNSUPPORTED_INSTRUCTION' | 'EMPTY_INSTRUCTION'
      message: string
    }

function quotedValue(input: string) {
  return /[「“"']([^」”"']{1,80})[」”"']/.exec(input)?.[1]?.trim()
}

function parseSize(input: string) {
  const match = /(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)/i.exec(input)
  if (!match) return null
  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    return null
  }
  return {
    width: Math.min(width, MAX_DIMENSION),
    height: Math.min(height, MAX_DIMENSION),
  }
}

function defaultFrameSize(input: string) {
  if (/web|桌面|网页|1440/.test(input)) return { width: 1440, height: 900 }
  return { width: 375, height: 812 }
}

function frameFill(input: string) {
  const match = /(白|黑|红|蓝|绿|黄|紫|橙|粉|灰|青|金)色?\s*(?:的)?\s*(?:画板|画框|画布|frame)/i.exec(input)
  if (match) {
    const color = parseColor(match[1])
    if (color) return [color]
  }
  return [{ r: 1, g: 1, b: 1 }]
}

/**
 * 空白文件也可执行的创建指令。只覆盖明确的「新建画板 / 新建文本」，
 * 复杂生成仍交给 Agent。
 */
export function parseFigmaCreateInstruction(message: string): FigmaCreateParseResult {
  const input = message.trim()
  if (!input) return { ok: false, code: 'EMPTY_INSTRUCTION', message: '请输入要创建的内容。' }
  const unsupported: FigmaCreateParseResult = {
    ok: false, code: 'UNSUPPORTED_INSTRUCTION', message: '没有识别到明确、完整的创建指令。',
  }
  // Only explicit imperative creation requests may bypass the Agent. Ignore
  // quoted copy when checking for negation or questions about creation.
  const syntax = input.replace(/「[^」]*」|“[^”]*”|"[^"]*"|'[^']*'/g, '')
  if (input.length > MAX_INSTRUCTION_LENGTH || /不要|别|不必|不用|无需|不能|不需要|先不|禁止|取消|分析|解释|如何|怎么|能否|是否|[?？]/.test(syntax)) {
    return unsupported
  }
  const clauses = splitClauses(input)
  const first = normalizeClause(clauses[0] ?? '')
  const create = /^(?:新建|创建|生成|添加|加|做)\s*(?:一[个张]|个|张)?\s*(?:(?:空白|手机|移动端|桌面|网页|web|mobile|[白黑红蓝绿黄紫橙粉灰青金]色?|\d+(?:\.\d+)?\s*[x×*]\s*\d+(?:\.\d+)?|的)\s*)*(画板|画框|画布|frame|文本(?:图层)?|标题|文字(?:图层)?)(.*)$/i.exec(first)
  if (!create) return unsupported
  const wantsFrame = /^(?:画板|画框|画布|frame)$/i.test(create[1])
  const wantsText = !wantsFrame
  const quoted = '(?:「[^」]+」|“[^”]+”|"[^"]+"|\x27[^\x27]+\x27)'
  const attribute = new RegExp(`^(?:(?:标题|文本|文字|内容)\\s*(?:写成|为|是)|名叫)\\s*${quoted}$`)
  const tail = create[2].trim()
  if (tail && !attribute.test(tail) && !(wantsText && new RegExp(`^(?:(?:为|是|写成)\\s*)?${quoted}$`).test(tail))) {
    return unsupported
  }
  if (clauses.slice(1).some((clause) => !attribute.test(clause.trim()))) return unsupported

  const size = parseSize(input) ?? (wantsFrame ? defaultFrameSize(input) : null)
  const titleClause = clauses.find((clause) => /^(?:标题|文本|文字|内容)\s*(?:写成|为|是)/.test(clause.trim()))
  const title = titleClause ? quotedValue(titleClause) : (/^名叫/.test(tail) ? undefined : quotedValue(tail))
  const frameName = /名叫\s*[「“"']([^」”"']+)[」”"']/.exec(input)?.[1]?.trim()
    || (wantsFrame ? '画板' : '文本')

  if (wantsFrame && title) {
    const width = size?.width ?? 375
    const height = size?.height ?? 812
    return {
      ok: true,
      drafts: [{
        type: 'clone-into-frame',
        name: frameName,
        x: 80,
        y: 80,
        width,
        height,
        fills: frameFill(input),
        labels: [{
          characters: title,
          x: 24,
          y: 24,
          fontSize: Math.min(Math.max(Math.round(width / 12), 16), 48),
          name: '标题',
        }],
      }],
      summary: `将创建画板「${frameName}」并写入标题`,
    }
  }

  const drafts: FigmaCreateDraft[] = []
  if (wantsFrame && size) {
    drafts.push({
      type: 'create-frame',
      name: frameName,
      x: 80,
      y: 80,
      width: size.width,
      height: size.height,
      fills: frameFill(input),
    })
  }
  if (wantsText && title) {
    drafts.push({
      type: 'create-text',
      name: '标题',
      characters: title,
      x: 104,
      y: 104,
      fontSize: 28,
    })
  }
  if (drafts.length === 0) {
    return { ok: false, code: 'UNSUPPORTED_INSTRUCTION', message: '创建指令缺少尺寸或文案。' }
  }
  return {
    ok: true,
    drafts,
    summary: `将${drafts.map((draft) => (
      draft.type === 'create-text'
        ? `创建文本「${draft.characters}」`
        : `创建画板「${draft.name}」`
    )).join('、')}`,
  }
}
