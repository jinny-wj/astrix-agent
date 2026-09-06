/**
 * 批量产出板数据。
 *
 * 依据需求文档回放截图：批量生成的物料以「画板组」形式平铺在画布上，
 * 每组通常为「渠道场景截图 + 该渠道资源位」的配对，便于逐一验收。
 */

/** 单个画板 */
export type Artboard = {
  label: string
  /** 画板宽度（画布像素） */
  w: number
  /** 画板高度 */
  h: number
  /** 画面类型 */
  kind: 'kv' | 'screen' | 'banner' | 'cover' | 'dark-screen' | 'strip'
}

/** 一组产出（同一渠道的场景与物料） */
export type ArtboardGroup = {
  id: string
  boards: Artboard[]
}

export const BATCH_GROUPS: ArtboardGroup[] = [
  { id: 'g0', boards: [{ label: '测试1.0...', w: 92, h: 62, kind: 'kv' }] },
  {
    id: 'g1',
    boards: [
      { label: '热门...', w: 62, h: 128, kind: 'screen' },
      { label: '热门...', w: 62, h: 42, kind: 'banner' },
    ],
  },
  {
    id: 'g2',
    boards: [
      { label: '直播...', w: 62, h: 128, kind: 'screen' },
      { label: '直播...', w: 62, h: 42, kind: 'banner' },
    ],
  },
  {
    id: 'g3',
    boards: [
      { label: '直播...', w: 62, h: 128, kind: 'cover' },
      { label: '直播...', w: 62, h: 128, kind: 'screen' },
    ],
  },
  {
    id: 'g4',
    boards: [
      { label: '热门...', w: 62, h: 128, kind: 'screen' },
      { label: '热门...', w: 62, h: 42, kind: 'banner' },
    ],
  },
  {
    id: 'g5',
    boards: [
      { label: '热门...', w: 62, h: 96, kind: 'dark-screen' },
      { label: '热...', w: 42, h: 40, kind: 'banner' },
      { label: '热...', w: 42, h: 82, kind: 'kv' },
      { label: '热...', w: 42, h: 82, kind: 'kv' },
      { label: '热...', w: 42, h: 82, kind: 'kv' },
    ],
  },
  {
    id: 'g6',
    boards: [
      { label: '话题...', w: 62, h: 128, kind: 'screen' },
      { label: '直...', w: 42, h: 82, kind: 'kv' },
      { label: '直...', w: 42, h: 82, kind: 'kv' },
      { label: '直...', w: 42, h: 82, kind: 'kv' },
    ],
  },
  {
    id: 'g7',
    boards: [
      { label: '直播...', w: 62, h: 128, kind: 'screen' },
      { label: '直...', w: 42, h: 42, kind: 'banner' },
    ],
  },
  {
    id: 'g8',
    boards: [
      { label: '横版...', w: 62, h: 44, kind: 'strip' },
      { label: '', w: 62, h: 30, kind: 'dark-screen' },
      { label: '', w: 62, h: 30, kind: 'strip' },
    ],
  },
  {
    id: 'g9',
    boards: [
      { label: '直播...', w: 78, h: 112, kind: 'dark-screen' },
      { label: '...', w: 52, h: 16, kind: 'strip' },
      { label: '...', w: 52, h: 16, kind: 'strip' },
    ],
  },
  {
    id: 'g10',
    boards: [
      { label: '热门...', w: 62, h: 128, kind: 'screen' },
      { label: '热门...', w: 62, h: 42, kind: 'banner' },
    ],
  },
]
