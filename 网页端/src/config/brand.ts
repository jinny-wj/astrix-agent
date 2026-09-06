/**
 * 应用品牌配置。
 * 所有对外展示的名称、标语、文案均从此处取值，便于统一替换。
 */
export const BRAND = {
  /** 产品全名 */
  name: '星序 Astrix',
  /** 徽标内的短标记 */
  mark: '星序',
  /** 右侧面板里的 Agent 名，对标设计工具里的输入框身份 */
  assistant: 'Codex',
  /** 首页主标语 */
  tagline: '让灵感变成现实',
  /** 首页输入框提示 */
  homePlaceholder:
    '上传主播照片做一键美化，或输入「战报 3027」选模板，也可以丢一张 KV 做资源位延展…',
  /** 编辑器面板欢迎语 */
  welcomeTitle: '你好，我是 Codex',
  /** 编辑器对话框提示 */
  chatPlaceholder: '给 Codex 发送消息，# 添加上下文，⇧⏎ 换行',
} as const
