export const SKILL_IDS = [
  'portrait-beautify',
  'kv-resource-extension',
  'battle-report',
  'visual-draft-generation',
  'code-from-figma',
  'layer-edit',
  'loop',
  'hermes',
] as const

export type SkillId = (typeof SKILL_IDS)[number]

const BATTLE_REPORT_IDS = [
  '3026', '3027', '3028', '3029', '3030', '3031',
  '3032', '3033', '3034', '3035', '3037', '3038',
  '0001', '0002', '0003', '0004', '0005', '0006', '0007', '0008',
]

export const BATTLE_REPORT_TEMPLATES = {
  zhanbaoIds: ['3026', '3027', '3028', '3029', '3030', '3031', '3032', '3033', '3034', '3035', '3037', '3038'],
  haibaoIds: ['0001', '0002', '0003', '0004', '0005', '0006', '0007', '0008'],
  zhanbaoThumb:
    'https://p5-sh.shwkwai.com/kcdn/cdn-kcdn111763/skills/zhanbao_suoluetu/zhanbao_slt.png',
  haibaoThumb:
    'https://p5-sh.shwkwai.com/kcdn/cdn-kcdn111763/skills/haibao_suoluetu/haibao-slt.png',
  originalUrl(type: 'zhanbao' | 'haibao', id: string) {
    return `https://p5-sh.shwkwai.com/kcdn/cdn-kcdn111763/skills/${type}/${id}.png`
  },
}

export function parseBattleReportTemplateId(text: string): {
  id: string
  type: 'zhanbao' | 'haibao'
} | null {
  const match = text.match(/\b(302[6-9]|303[0-5]|303[78]|000[1-8])\b/)
  if (!match) return null
  const id = match[1]
  return {
    id,
    type: id.startsWith('30') ? 'zhanbao' : 'haibao',
  }
}

export function pickSkill(message: string, preferred?: string): SkillId {
  const requested = preferred?.trim().toLowerCase() ?? ''
  if (requested) {
    if (requested === 'portrait-beautify' || requested === 'person-poster-extension') {
      return 'portrait-beautify'
    }
    if (requested === 'battle-report' || requested === 'local-life-material-maker') {
      return 'battle-report'
    }
    if (requested === 'kv-resource-extension') return 'kv-resource-extension'
    if (requested === 'visual-draft-generation') return 'visual-draft-generation'
    if (requested === 'code-from-figma') return 'code-from-figma'
    if (requested === 'loop') return 'loop'
    if (requested === 'hermes') return 'hermes'
    if (/美化|修图|抠图/.test(requested)) return 'portrait-beautify'
    if (/战报/.test(requested)) return 'battle-report'
    if (/资源位|延展|banner|封面/.test(requested)) return 'kv-resource-extension'
    if (/视觉稿|ui\s*稿|专业设计/.test(requested)) return 'visual-draft-generation'
    if (/react|代码|组件|原型/.test(requested)) return 'code-from-figma'
    if (/人物|人像|海报/.test(requested)) return 'portrait-beautify'
  }

  const text = message.toLowerCase()
  if (/\/loop\b|\$loop\b|定时|每隔\s*\d|轮询|持续跟进/.test(text)) {
    return 'loop'
  }
  if (/hermes|赫尔墨斯/.test(text)) {
    return 'hermes'
  }
  if (BATTLE_REPORT_IDS.some((id) => text.includes(id)) || /战报/.test(text)) {
    return 'battle-report'
  }
  if (/美化|修图|抠图|保脸/.test(text)) return 'portrait-beautify'
  if (/资源位|banner|封面|弹窗|延展/.test(text)) return 'kv-resource-extension'
  if (/海报|人像|主播|人脸/.test(text)) return 'portrait-beautify'
  if (/视觉稿|ui\s*稿|生成页面|设计稿/.test(text)) return 'visual-draft-generation'
  if (/react\s*\+|生成组件|转代码|code\s*mode/.test(text)) return 'code-from-figma'
  return 'layer-edit'
}

export function skillBody(name: string) {
  if (name === 'portrait-beautify' || name === 'person-poster-extension') {
    return `## 读取顺序

- 先读 \`skills/portrait-beautify/SKILL.md\`。
- 保脸规则优先于美化和换装。

## 输入

- \`photos\`: 主播原图。
- \`sheet\`: 可选，Excel/Doc 中的姓名、标题、标签。
- \`template\`: 可选，盛典/战报母版。`
  }

  if (name === 'battle-report') {
    return `## 读取顺序

- 先读 \`skills/battle-report/SKILL.md\`。
- 生成前读 \`skills/battle-report/references/design-spec.md\`。
- Prompt 组装读 \`skills/battle-report/references/design-rules.md\`。

## 输入

- \`templateId\`: 战报 3026-3038 或海报 0001-0008。
- \`edits\`: 文案、头像、配色等修改项。`
  }

  if (name === 'visual-draft-generation') {
    return `## 目标

在真实 Figma 文件里产出可编辑图层。不要套用直播活动海报、会议议程或其它固定模板。

## 读取顺序

- 有 Figma 选区时以选区为准。
- 已连接 Design Studio Bridge 时，能改的属性直接写回：文字、填充、透明度、尺寸、位置、显隐、名称。
- 没有 Bridge 时只给分析和建议，不要声称已经改了原文件。
- 不要在本地假画布上填充模板。

## 输入

- \`brief\`: 需求描述、参考图或 Figma 链接。
- \`style\`: 风格关键词。`
  }

  if (name === 'code-from-figma') {
    return `## 目标

根据当前 Figma 选区生成可运行的 React + Tailwind 组件，结果写在对话里。

## 规则

- 对照图层结构、文案、颜色、圆角、间距和层级。
- 不要假装这是 IDE，不要生成本地假画布。
- 没有导入文件或选区时，先请用户读取或打开 Figma。
- 没有像素抠图、热力图等服务时直接说明限制。`
  }

  if (name === 'loop') {
    return `## 读取顺序

- 先读 \`skills/loop/SKILL.md\`。
- 这是 Codex 官方 loop：按间隔或事件重复执行同一任务。

## 输入

- \`interval\`: 如 5m、30s；省略则为动态节奏。
- \`prompt\`: 每次 tick 要执行的任务。`
  }

  if (name === 'hermes') {
    return `## 读取顺序

- 先读 \`skills/hermes/SKILL.md\`。
- 官方仓库：https://github.com/NousResearch/hermes-agent

## 输入

- \`message\`: 交给本机 Hermes CLI 的任务。`
  }

  if (name === 'layer-edit') {
    return `## 读取顺序

- 以当前 Figma 选区为准。
- 只改文字、颜色、透明度、尺寸、位置、显隐或名称。

## 输入

- \`selection\`: Bridge 同步的当前图层。
- \`message\`: 自然语言修改指令。`
  }

  return `## 读取顺序

- 先读 \`skills/resource-extension/SKILL.md\`。
- 交付前核对规格、安全区和体积。

## 输入

- \`kv\`: 活动主视觉或选中的 Figma 节点。
- \`specs\`: 目标资源位清单。`
}

export function skillDisplayName(name: string) {
  if (name === 'portrait-beautify' || name === 'person-poster-extension') return '一键美化'
  if (name === 'battle-report') return '人物战报'
  if (name === 'kv-resource-extension') return '资源位延展'
  if (name === 'visual-draft-generation') return '视觉稿生成'
  if (name === 'code-from-figma') return 'Figma 转代码'
  if (name === 'layer-edit') return '图层修改'
  if (name === 'loop') return 'Loop'
  if (name === 'hermes') return 'Hermes'
  return name
}

export function inferRefs(message: string): Array<{
  name: string
  size: string
  output: string
}> {
  const refs: Array<{ name: string; size: string; output: string }> = []
  if (/弹窗|活动/.test(message)) {
    refs.push({
      name: '热门活动-弹窗',
      size: '840*1120',
      output: '输出要求≤300kb png/jpg',
    })
  }
  if (/封面|直播/.test(message)) {
    refs.push({
      name: '直播封面',
      size: '720*1280',
      output: '输出要求无大小要求 png/jpg',
    })
  }
  if (/banner|广场/.test(message)) {
    refs.push({
      name: '直播广场banner',
      size: '584*160',
      output: '输出要求≤300kb png/jpg',
    })
  }
  return refs
}
