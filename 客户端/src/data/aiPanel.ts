/** 右侧 AI 面板的静态文案与配置 */

export type Capability = {
  text: string
  /** 图标底色 */
  tone: string
  glyph: 'font' | 'ui' | 'motion' | 'assets'
}

/** 欢迎卡内的四条能力说明 */
export const CAPABILITIES: Capability[] = [
  { text: '主播照片一键抠图修图，保脸、统一光影后再套盛典模板', tone: '#d4892b', glyph: 'font' },
  { text: 'KV 一键延展到弹窗、直播封面、广场 banner 等多规格', tone: '#7f6df0', glyph: 'ui' },
  { text: '人物战报按模板改文案、换头像，锁定品牌栏后出新图', tone: '#2389c4', glyph: 'motion' },
  { text: '异常结果筛出来给人工改，通过的批量导出到 Figma', tone: '#f0873d', glyph: 'assets' },
]

/** 三步使用引导 */
export const GUIDE_STEPS = [
  '1、在画布里点一个图层',
  '2、图层出现在右侧 Codex 输入框',
  '3、改文字/颜色，或点批量生成',
]

export type QuickAction = {
  label: string
  glyph:
    | 'zap'
    | 'sparkle'
    | 'image'
    | 'visual'
    | 'picture'
    | 'component'
    | 'font'
    | 'icon'
    | 'spec'
    | 'analyze'
  /** 是否为强调态（原界面前两项带彩色图标） */
  accent?: boolean
}

/** 输入框上方的能力标签组 */
export const QUICK_ACTIONS: QuickAction[] = [
  { label: '一键美化', glyph: 'sparkle', accent: true },
  { label: '资源位延展', glyph: 'zap', accent: true },
  { label: '批量生成', glyph: 'image' },
  { label: '人物战报', glyph: 'picture' },
  { label: '视觉稿生成', glyph: 'visual' },
  { label: 'Loop', glyph: 'analyze' },
  { label: 'Hermes', glyph: 'component' },
]
