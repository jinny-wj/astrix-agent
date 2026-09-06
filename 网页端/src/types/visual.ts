export type VisualThemeName = 'royal' | 'aurora' | 'crimson'
export type VisualMotifName = 'prism' | 'orb' | 'portal'

export type VisualDocument = {
  id: string
  name: string
  width: 375
  height: 830
  title: string
  subtitle: string
  themeName: VisualThemeName
  motif: VisualMotifName
  copyCount: number
  brief: string
}

export type VisualDocumentChanges = Partial<
  Pick<VisualDocument, 'title' | 'subtitle' | 'themeName' | 'motif' | 'brief'>
>

const TITLE_PATTERN = /(?:主标题|(?<!副)标题)(?:改成|改为|设置为|写成|为|是|[:：])\s*[“「\"']?([^”」\"'，。；;\n]{2,20})/
const SUBTITLE_PATTERN = /(?:副标题|slogan)(?:改成|改为|设置为|写成|为|是|[:：])\s*[“「\"']?([^”」\"'，。；;\n]{2,28})/i

function cleanPrompt(prompt: string) {
  return prompt
    .trim()
    .replace(/^(?:视觉稿生成|专业设计|图生\s*UI\s*稿|图片生成|字体生成)[：:]\s*/i, '')
}

function explicitCopy(prompt: string, pattern: RegExp) {
  return prompt.match(pattern)?.[1]?.trim()
}

function inferTheme(prompt: string): VisualThemeName | undefined {
  if (/蓝色|蓝紫|科技|未来|极光|清爽|冷色/.test(prompt)) return 'aurora'
  if (/红色|橙红|喜庆|节日|促销|热烈|春节|新年/.test(prompt)) return 'crimson'
  if (/紫色|鎏金|金色|奢华|典礼|盛典|舞台/.test(prompt)) return 'royal'
  return undefined
}

function inferMotif(prompt: string): VisualMotifName | undefined {
  if (/星球|球体|圆形|圆环|气泡/.test(prompt)) return 'orb'
  if (/传送门|拱门|入口|光环|门户/.test(prompt)) return 'portal'
  if (/棱镜|钻石|晶体|几何|方形/.test(prompt)) return 'prism'
  if (/换(?:一张)?图|换个构图|另一种构图/.test(prompt)) return 'portal'
  return undefined
}

function inferTitle(prompt: string) {
  const explicit = explicitCopy(prompt, TITLE_PATTERN)
  if (explicit) return explicit
  if (/直播/.test(prompt)) return '直播活动盛典'
  if (/春节|新年|新春/.test(prompt)) return '新春焕新盛典'
  if (/618|双11|电商|促销|大促/.test(prompt)) return '限时焕新季'
  if (/发布会|科技|未来|AI/.test(prompt)) return '未来创想发布会'
  if (/品牌|焕新/.test(prompt)) return '品牌焕新计划'
  if (/UI|界面|页面|网站/i.test(prompt)) return '智能体验新界面'

  const cleaned = cleanPrompt(prompt)
    .replace(/^(?:请|帮我|给我|我想要|我要)/, '')
    .replace(/^(?:设计|生成|制作|做)(?:一张|一个|一套)?/, '')
    .trim()
  const candidate = cleaned.split(/[，。；;\n]/)[0]?.trim()
  if (candidate && candidate.length <= 14) return candidate
  return 'AI 视觉创意'
}

function inferSubtitle(prompt: string) {
  const explicit = explicitCopy(prompt, SUBTITLE_PATTERN)
  if (explicit) return explicit
  if (/直播/.test(prompt)) return '巅峰之夜 · 不见不散'
  if (/春节|新年|新春/.test(prompt)) return '好运启新 · 共赴新程'
  if (/618|双11|电商|促销|大促/.test(prompt)) return '限时好物 · 惊喜开场'
  if (/发布会|科技|未来|AI/.test(prompt)) return '探索边界 · 连接未来'
  return '灵感成稿 · 即刻可编辑'
}

export function inferVisualDocumentChanges(prompt: string): VisualDocumentChanges {
  const changes: VisualDocumentChanges = { brief: cleanPrompt(prompt) }
  const title = explicitCopy(prompt, TITLE_PATTERN)
  const subtitle = explicitCopy(prompt, SUBTITLE_PATTERN)
  const themeName = inferTheme(prompt)
  const motif = inferMotif(prompt)
  if (title) changes.title = title
  if (subtitle) changes.subtitle = subtitle
  if (themeName) changes.themeName = themeName
  if (motif) changes.motif = motif
  return changes
}

export function createVisualDocument(prompt = '', fileName?: string): VisualDocument {
  const brief = cleanPrompt(prompt)
  return {
    id: `visual-${Date.now()}`,
    name: fileName || inferTitle(prompt) || '未命名设计稿',
    width: 375,
    height: 830,
    title: inferTitle(prompt),
    subtitle: inferSubtitle(prompt),
    themeName: inferTheme(prompt) ?? 'royal',
    motif: inferMotif(prompt) ?? 'prism',
    copyCount: 0,
    brief,
  }
}
