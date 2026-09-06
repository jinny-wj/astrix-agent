import { CheckCircle2, ChevronDown, Copy, Layers3 } from 'lucide-react'
import { useState } from 'react'
import type { ContextRef } from '../../../data/agentScript'

/** Figma 文件标记 */
function FigmaGlyph() {
  return (
    <svg viewBox="0 0 12 18" className="h-[13px] w-[9px] shrink-0">
      <path d="M3 0h3v6H3a3 3 0 0 1 0-6z" fill="#f24e1e" />
      <path d="M6 0h3a3 3 0 0 1 0 6H6V0z" fill="#ff7262" />
      <path d="M6 6h3a3 3 0 0 1 0 6H6V6z" fill="#1abcfe" />
      <path d="M3 6h3v6H3a3 3 0 0 1 0-6z" fill="#a259ff" />
      <path d="M3 12h3v3a3 3 0 1 1-3-3z" fill="#0acf83" />
    </svg>
  )
}

/** 用户消息：右对齐蓝紫渐变气泡，下方可挂上下文引用列表 */
export function UserBubble({ text, refs }: { text: string; refs?: ContextRef[] }) {
  const [open, setOpen] = useState(true)

  return (
    <div className="flex flex-col items-end">
      <div className="max-w-[86%] rounded-[10px] bg-gradient-to-r from-[#5b7ce8] to-[#7b6ae4] px-[14px] py-[9px] text-[13px] font-medium text-white">
        {text}
      </div>

      {refs && refs.length > 0 && (
        <div className="mt-[9px] w-full">
          <button
            onClick={() => setOpen((v) => !v)}
            className="flex w-full items-center justify-end gap-[4px] text-[12px] text-[#8a8a90] hover:text-[#5d5d64]"
          >
            参考 {refs.length} 个上下文
            <ChevronDown
              size={13}
              strokeWidth={1.9}
              className={open ? 'rotate-180 transition-transform' : 'transition-transform'}
            />
          </button>

          {open && (
            <div className="mt-[7px] space-y-[6px]">
              {refs.map((ref) => (
                <div
                  key={ref.name}
                  className="flex items-center gap-[8px] rounded-[8px] bg-[#f5f5f7] px-[10px] py-[8px]"
                >
                  <FigmaGlyph />
                  <span className="truncate text-[12px] text-[#3d3d42]">
                    {ref.name} {ref.size} {ref.output}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** Skill 卡：蓝色描边容器，标题行 + 可折叠 Markdown 正文 + 复制按钮 */
export function SkillCard({ name, body }: { name: string; body: string }) {
  const [open, setOpen] = useState(true)
  const displayName = name === 'visual-draft-generation'
    ? '视觉稿生成'
    : name === 'code-from-figma'
      ? 'Figma 转代码'
    : name === 'kv-resource-extension'
      ? '资源位延展'
      : name === 'portrait-beautify' || name === 'person-poster-extension'
        ? '一键美化'
        : name === 'battle-report'
          ? '人物战报'
          : name === 'layer-edit'
            ? '图层修改'
          : name === 'loop'
            ? 'Loop'
          : name === 'hermes'
            ? 'Hermes'
          : name

  return (
    <div className="overflow-hidden rounded-[10px] border border-[#c7dcfa] bg-white">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-[7px] px-[12px] py-[10px]"
      >
        {/* Skill 标记 */}
        <svg viewBox="0 0 14 14" className="h-[13px] w-[13px] shrink-0">
          <path
            d="M7 1.2l1.5 3.4 3.4 1.4-3.4 1.4L7 12.8 5.5 7.4 2.1 6l3.4-1.4z"
            fill="#3b6fe0"
          />
        </svg>
        <span className="text-[13px] font-semibold text-ink">Skill</span>
        <span className="truncate text-[12.5px] text-[#8a8a90]">{displayName}</span>
        <ChevronDown
          size={14}
          strokeWidth={1.9}
          className={`ml-auto shrink-0 text-[#9a9aa0] ${open ? 'rotate-180' : ''} transition-transform`}
        />
      </button>

      {open && (
        <div className="relative mx-[10px] mb-[10px] max-h-[188px] overflow-hidden rounded-[7px] bg-[#f4f4f6] px-[12px] py-[11px]">
          <button
            title="复制"
            className="absolute right-[9px] top-[9px] text-[#8a8a90] hover:text-ink"
          >
            <Copy size={14} strokeWidth={1.8} />
          </button>

          <div className="space-y-[7px] pr-[24px] text-[12px] leading-[1.6] text-[#3d3d42]">
            {body.split('\n').map((line, i) => {
              if (!line.trim()) return null
              if (line.startsWith('## ')) {
                return (
                  <div key={i} className="font-semibold text-ink">
                    {line.replace('## ', '')}
                  </div>
                )
              }
              // 行内 `code` 渲染为等宽浅底
              const parts = line.split(/(`[^`]+`)/g)
              return (
                <div key={i}>
                  {parts.map((part, j) =>
                    part.startsWith('`') && part.endsWith('`') ? (
                      <code
                        key={j}
                        className="rounded bg-[#e7e7ea] px-[3px] py-[1px] font-mono text-[11px] text-[#c0392b]"
                      >
                        {part.slice(1, -1)}
                      </code>
                    ) : (
                      <span key={j}>{part}</span>
                    ),
                  )}
                </div>
              )
            })}
          </div>

          {/* 底部渐隐，暗示内容被截断 */}
          <div className="pointer-events-none absolute bottom-0 left-0 h-[26px] w-full bg-gradient-to-t from-[#f4f4f6] to-transparent" />
        </div>
      )}
    </div>
  )
}

/** 对话正文：支持 Markdown 图片，方便战报模板缩略图直接展示 */
export function MarkdownMessage({ text }: { text: string }) {
  const parts = text.split(/(!\[[^\]]*]\([^)]+\))/g)
  return (
    <div className="space-y-[10px] text-[12.5px] leading-[1.65] text-[#3d3d42]">
      {parts.map((part, index) => {
        const match = part.match(/^!\[([^\]]*)]\(([^)]+)\)$/)
        if (match) {
          return (
            <img
              key={`${match[2]}-${index}`}
              src={match[2]}
              alt={match[1] || '模板预览'}
              className="max-h-[420px] w-full rounded-[10px] border border-[#ececef] object-contain bg-[#f7f7f8]"
            />
          )
        }
        if (!part.trim()) return null
        return (
          <div key={index} className="whitespace-pre-wrap">
            {part.trim()}
          </div>
        )
      })}
    </div>
  )
}

/** 上下文采集摘要：单行灰色文本 */
export function CollectedContext({ read, search }: { read: number; search: number }) {
  return (
    <button className="flex items-center gap-[8px] text-[12.5px] text-[#9a9aa0] hover:text-[#6e6e75]">
      <span>collected context</span>
      <span>
        读取 {read} · 搜索 {search}
      </span>
      <span className="text-[11px]">›</span>
    </button>
  )
}

export function VisualArtifactCard({
  title,
  summary,
}: {
  title: string
  summary: string
}) {
  return (
    <div className="rounded-[10px] border border-[#bce7cf] bg-[#f5fbf7] p-space-md">
      <div className="flex items-center gap-space-sm">
        <span className="flex h-[28px] w-[28px] items-center justify-center rounded-[8px] bg-[#def4e7] text-[#27955a]">
          <Layers3 size={15} strokeWidth={1.9} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-space-xs">
            <p className="truncate text-[12.5px] font-semibold text-ink">{title}</p>
            <CheckCircle2 size={12} className="shrink-0 text-[#27955a]" />
          </div>
          <p className="mt-space-xs text-[11.5px] leading-relaxed text-[#66736b]">{summary}</p>
        </div>
      </div>
    </div>
  )
}
