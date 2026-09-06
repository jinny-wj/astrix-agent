/**
 * 画布内占位设计稿数据。
 * 结构为议程类长图（时间轴 + 讲师卡片 + 圆形头像），仅用于撑起画布布局。
 * P1-b/c 接入真实 Figma 节点后，此文件将被节点树数据替代。
 */
export type AgendaItem = {
  time: string
  title: string
  speaker: string
  /** 头像占位底色 */
  tone: string
}

export const AGENDA_ITEMS: AgendaItem[] = [
  { time: '09:30-09:40', title: '开场：设计的下一个十年', speaker: '讲师 A', tone: '#8f9299' },
  { time: '09:40-10:10', title: '从数据洞察到认知跃迁', speaker: '讲师 B', tone: '#7c8896' },
  { time: '10:10-10:30', title: '智能界面与审美范式的变化', speaker: '讲师 C', tone: '#6f7480' },
  {
    time: '10:30-10:50',
    title: '一场从创作到产业的深度跃迁——影像单元全回顾',
    speaker: '讲师 D',
    tone: '#a08b90',
  },
  {
    time: '10:50-11:10',
    title: '从设计到构建：体验设计的新边界',
    speaker: '讲师 E',
    tone: '#4a4f57',
  },
  { time: '11:10-11:40', title: '一位艺术家和他的新搭档', speaker: '讲师 F', tone: '#8b8f96' },
  { time: '11:40-12:00', title: '设计美学与交互体验的迁移', speaker: '讲师 G', tone: '#7f848c' },
]
