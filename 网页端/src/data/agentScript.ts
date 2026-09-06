/**
 * Agent 对话消息模型。
 *
 * 结构依据需求文档中的实现回放截图归纳，一次生成任务的消息序列为：
 *   用户气泡 → 上下文引用 → Skill 卡 → 上下文采集摘要 → 工具调用卡（含设计预览） → 批量结果
 */
import type { VisualDocumentChanges } from '../types/visual'

/** 上下文引用条目：一个资源位规格 */
export type ContextRef = {
  /** 资源位名称 */
  name: string
  /** 尺寸，如 840*1120 */
  size: string
  /** 输出要求 */
  output: string
}

/** 工具调用状态 */
export type ToolStatus = 'running' | 'success' | 'error'

/** 批量产出物 */
export type ResultItem = {
  label: string
  /** 画面宽高比，用于缩略图占位 */
  ratio: number
  /** 缩略图主色调 */
  tone: 'red' | 'dark' | 'light' | 'warm'
}

export type Message =
  | { id: string; kind: 'user'; text: string; refs?: ContextRef[] }
  | {
      id: string
      kind: 'skill'
      /** Skill 标识名 */
      name: string
      /** Markdown 正文 */
      body: string
    }
  | {
      id: string
      kind: 'collected'
      /** 读取数量 */
      read: number
      /** 搜索数量 */
      search: number
    }
  | {
      id: string
      kind: 'tool'
      /** 工具提供方，留空则取品牌名 */
      provider: string
      /** 工具名 */
      tool: string
      /** 执行动作 */
      action: string
      status: ToolStatus
      /** 目标节点 ID */
      nodeId?: string
      /** 附注，如「含设计预览」 */
      note?: string
      /** 是否内嵌设计预览框 */
      preview?: boolean
    }
  | { id: string; kind: 'text'; text: string }
  | { id: string; kind: 'result'; title: string; items: ResultItem[] }
  | {
      id: string
      kind: 'figma-write'
      commandIds: string[]
      summary: string
      status: 'queued' | 'success' | 'error'
      detail?: string
    }
  | {
      id: string
      kind: 'artifact'
      artifact: 'visual-document'
      title: string
      summary: string
      changes: VisualDocumentChanges
    }

/** 演示用的回放脚本：模拟一次「资源位批量延展」任务 */
export const REPLAY_SCRIPT: Message[] = [
  {
    id: 'm1',
    kind: 'user',
    text: '这几个重新分别出3个方案',
    refs: [
      { name: '热门活动-弹窗', size: '840*1120', output: '输出要求≤300kb png/jpg' },
      { name: '直播封面', size: '720*1280', output: '输出要求无大小要求 png/jpg' },
      { name: '直播广场banner', size: '584*160', output: '输出要求≤300kb png/jpg' },
    ],
  },
  {
    id: 'm2',
    kind: 'skill',
    name: 'kv-resource-extension',
    body: `## 读取顺序

- 先读 \`references/资源位规格.md\`。
- 有 PRD/doc 时读 \`references/PRD提取规则.md\`。
- 交付前读 \`references/质量检查.md\`。

## 输入

- \`prd\`: 产品 PRD、活动 brief、物料需求、活动规则或可解析截图。
- \`kv\`: 活动主视觉稿件或选中的 Figma 节点。
- \`specs\`: 目标资源位清单，含尺寸与体积限制。`,
  },
  { id: 'm3', kind: 'collected', read: 5, search: 1 },
  {
    id: 'm4',
    kind: 'tool',
    provider: '',
    tool: '读取设计稿',
    action: '读取设计稿',
    status: 'success',
    nodeId: '128:4096',
    note: '含设计预览',
    preview: true,
  },
  {
    id: 'm5',
    kind: 'text',
    text: '已识别主视觉风格：红色渐变背景 + 金色立体标题 + 粒子光斑装饰。将按三个目标规格分别延展，每个规格产出 3 个方案。',
  },
  {
    id: 'm6',
    kind: 'tool',
    provider: '',
    tool: '批量生成资源位',
    action: '生成 9 个物料',
    status: 'success',
    note: '3 规格 × 3 方案',
  },
  {
    id: 'm7',
    kind: 'result',
    title: '批量生成完成',
    items: [
      { label: '热门活动-弹窗 方案1', ratio: 0.75, tone: 'red' },
      { label: '热门活动-弹窗 方案2', ratio: 0.75, tone: 'light' },
      { label: '热门活动-弹窗 方案3', ratio: 0.75, tone: 'dark' },
      { label: '直播封面 方案1', ratio: 0.5625, tone: 'red' },
      { label: '直播封面 方案2', ratio: 0.5625, tone: 'warm' },
      { label: '直播封面 方案3', ratio: 0.5625, tone: 'dark' },
      { label: '直播广场banner 方案1', ratio: 3.65, tone: 'red' },
      { label: '直播广场banner 方案2', ratio: 3.65, tone: 'warm' },
      { label: '直播广场banner 方案3', ratio: 3.65, tone: 'light' },
    ],
  },
]
