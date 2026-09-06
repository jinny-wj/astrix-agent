export type FeatureCard = {
  key: string
  title: string
  desc: string
  /** 卡片左侧图标的渐变配色，近似截图中的四种色调 */
  from: string
  to: string
  glyph: 'beautify' | 'resize' | 'report'
}

export const FEATURE_CARDS: FeatureCard[] = [
  {
    key: 'portrait-beautify',
    title: '一键美化',
    desc: '主播照片抠图修图，保脸交付',
    from: '#ffd4a8',
    to: '#f0a35a',
    glyph: 'beautify',
  },
  {
    key: 'kv-resource-extension',
    title: '资源位延展',
    desc: '一键适配多规格资源位',
    from: '#c3b4ff',
    to: '#7f6df0',
    glyph: 'resize',
  },
  {
    key: 'battle-report',
    title: '人物战报',
    desc: '选模板改文案换头像出图',
    from: '#8fd3ff',
    to: '#4a9bf0',
    glyph: 'report',
  },
]

export type FigmaFile = {
  key: string
  title: string
  time?: string
  /** 缩略图渲染类型：new 为新建占位 */
  kind: 'new' | 'doc-list' | 'wireframe' | 'dark-kit'
}

export const FIGMA_FILES: FigmaFile[] = [
  { key: 'new', title: '新建设计稿', kind: 'new' },
  {
    key: 'sample-agenda',
    title: '活动议程长图',
    time: '2026年07月16日 19:47',
    kind: 'doc-list',
  },
  {
    key: 'sample-components',
    title: '组件库-基础控件',
    time: '2026年07月01日 14:09',
    kind: 'wireframe',
  },
  {
    key: 'sample-kit',
    title: '深色主题 Web UI Kit',
    time: '2026年06月30日 20:30',
    kind: 'dark-kit',
  },
]
