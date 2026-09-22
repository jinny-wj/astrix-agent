import type { FigmaEditIntent } from '../src/types/figmaWrite'

export const DESIGN_ADJUSTMENT_KINDS = [
  'set-image-mode', 'set-image-filter', 'set-corner-radius',
  'set-font-size', 'set-line-height', 'set-layout-spacing',
] as const

const FILTERS = { 曝光: 'exposure', 对比度: 'contrast', 饱和度: 'saturation', 色温: 'temperature' } as const
const SPACING = { 间距: 'itemSpacing', 上: 'paddingTop', 右: 'paddingRight', 下: 'paddingBottom', 左: 'paddingLeft' } as const

/** Strict whole-clause matching: questions, negations and extra edits never execute partially. */
export function parseDesignAdjustment(clause: string): FigmaEditIntent[] | null {
  const mode = /^图片(?:填充方式)?(?:改为|改成|设为|设置为)?(适应|完整显示|填充|铺满)$/.exec(clause)
  if (mode) return [{ kind: 'set-image-mode', value: /适应|完整显示/.test(mode[1]) ? 'FIT' : 'FILL' }]
  const filter = /^(?:图片)?(曝光|对比度|饱和度|色温)(?:改为|改成|设为|设置为)?\s*([+-]?\d+(?:\.\d+)?)\s*[%％]$/.exec(clause)
  if (filter) return [{ kind: 'set-image-filter', filter: FILTERS[filter[1] as keyof typeof FILTERS], value: Number(filter[2]) / 100 }]
  const metric = /^(圆角|字号|行高)(?:改为|改成|设为|设置为)?\s*(-?\d+(?:\.\d+)?)\s*(?:px)?$/i.exec(clause)
  if (metric) return [{ kind: metric[1] === '圆角' ? 'set-corner-radius' : metric[1] === '字号' ? 'set-font-size' : 'set-line-height', value: Number(metric[2]) }]
  const spacing = /^(?:自动布局)?(间距|[上下左右]内边距|内边距)(?:改为|改成|设为|设置为)?\s*(-?\d+(?:\.\d+)?)\s*(?:px)?$/i.exec(clause)
  if (spacing) {
    const keys: Array<keyof typeof SPACING> = spacing[1] === '内边距' ? ['上', '右', '下', '左'] : [spacing[1] === '间距' ? '间距' : spacing[1][0] as '上' | '右' | '下' | '左']
    return keys.map(key => ({ kind: 'set-layout-spacing', property: SPACING[key], value: Number(spacing[2]) }))
  }
  const resource = /^(?:资源位)?尺寸(?:改为|改成|设为|设置为|调整为)\s*(直播广场\s*banner|直播封面|活动弹窗|H5首屏)$/i.exec(clause)
  if (resource) {
    const name = resource[1].replace(/\s/g, '').toLowerCase()
    const [width, height] = name === '直播广场banner' ? [584, 160] : name === '直播封面' ? [720, 1280] : name === '活动弹窗' ? [840, 1120] : [375, 812]
    return [{ kind: 'resize', width: { mode: 'set', value: width }, height: { mode: 'set', value: height } }]
  }
  return null
}

/** Used for both natural language and structured Bridge input. */
export function validateDesignAdjustment(patch: Record<string, unknown>): string | null {
  if (patch.kind === 'set-image-mode') return patch.value === 'FIT' || patch.value === 'FILL' ? null : '图片填充方式只能是适应或填充。'
  if (patch.kind === 'set-image-filter') {
    if (!Object.values(FILTERS).includes(patch.filter as typeof FILTERS[keyof typeof FILTERS])) return '不支持这项图片调整。'
    return typeof patch.value === 'number' && Number.isFinite(patch.value) && Math.abs(patch.value) <= 1 ? null : '图片调整值必须在 -100% 到 100% 之间。'
  }
  if (patch.kind === 'set-layout-spacing' && !Object.values(SPACING).includes(patch.property as typeof SPACING[keyof typeof SPACING])) return '不支持这项自动布局属性。'
  const minimum = patch.kind === 'set-font-size' || patch.kind === 'set-line-height' ? 1 : 0
  return typeof patch.value === 'number' && Number.isFinite(patch.value) && patch.value >= minimum && patch.value <= 10000 ? null : `调整值必须在 ${minimum} 到 10000 px 之间。`
}
