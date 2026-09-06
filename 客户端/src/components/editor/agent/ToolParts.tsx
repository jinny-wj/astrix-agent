import { ChevronDown, RotateCw } from 'lucide-react'
import { useState } from 'react'
import { BRAND } from '../../../config/brand'
import type { ResultItem, ToolStatus } from '../../../data/agentScript'

/** 工具提供方标记（与顶部徽标同形） */
function ProviderGlyph() {
  return (
    <svg viewBox="0 0 14 14" className="h-[13px] w-[13px] shrink-0">
      <rect x="0.8" y="0.8" width="12.4" height="12.4" rx="3" fill="#3b6fe0" opacity="0.12" />
      <path d="M4.4 10V4h3a3 3 0 0 1 0 6z" fill="none" stroke="#3b6fe0" strokeWidth="1.3" />
    </svg>
  )
}

/** 设计预览框：模拟一个内嵌浏览器视图，展示被读取的 KV 画面 */
function DesignPreview({ label }: { label: string }) {
  return (
    <div className="mx-[10px] mb-[10px] overflow-hidden rounded-[8px] border border-hairline">
      {/* 地址条 */}
      <div className="flex items-center gap-[9px] bg-white px-[10px] py-[8px]">
        <div className="flex items-center gap-[5px]">
          <span className="h-[9px] w-[9px] rounded-full bg-[#ff5f57]" />
          <span className="h-[9px] w-[9px] rounded-full bg-[#febc2e]" />
          <span className="h-[9px] w-[9px] rounded-full bg-[#28c840]" />
        </div>
        <div className="flex-1 truncate rounded-full border border-hairline px-[10px] py-[3px] text-center text-[11px] text-[#8a8a90]">
          design-preview://canvas
        </div>
        <span className="shrink-0 text-[11.5px] text-[#5d5d64]">{label}</span>
        <button className="shrink-0 rounded-full border border-hairline p-[4px] text-[#6e6e75] hover:bg-[#f4f4f6]">
          <RotateCw size={11} strokeWidth={2} />
        </button>
      </div>

      {/* 画面区：红金渐变 KV + 粒子光斑 */}
      <div className="relative h-[168px] w-full overflow-hidden bg-gradient-to-b from-[#f5143c] via-[#e8123a] to-[#c00d30]">
        {/* 粒子装饰 */}
        {[
          [18, 26], [42, 14], [67, 34], [83, 20], [30, 52],
          [58, 62], [76, 74], [12, 68], [48, 84], [90, 56],
          [24, 40], [62, 24],
        ].map(([x, y], i) => (
          <span
            key={i}
            className="absolute rounded-full bg-white"
            style={{
              left: `${x}%`,
              top: `${y}%`,
              width: i % 3 === 0 ? 3 : 2,
              height: i % 3 === 0 ? 3 : 2,
              opacity: i % 2 === 0 ? 0.85 : 0.5,
            }}
          />
        ))}
        {/* 右下光晕 */}
        <div
          className="absolute -bottom-[30px] -right-[20px] h-[120px] w-[120px] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(255,180,190,0.5), transparent 70%)' }}
        />
        {/* 金色立体标题占位 */}
        <div className="absolute left-1/2 top-[54%] -translate-x-1/2 -translate-y-1/2 text-center">
          <div
            className="text-[26px] font-black leading-none tracking-tight text-transparent"
            style={{
              backgroundImage: 'linear-gradient(180deg,#fff6d8 10%,#ffd465 48%,#e5a02b 78%)',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              filter: 'drop-shadow(0 2px 0 #a8641a)',
            }}
          >
            活动主视觉
          </div>
        </div>
      </div>
    </div>
  )
}

const STATUS_STYLE: Record<ToolStatus, string> = {
  running: 'text-[#d98324]',
  success: 'text-[#3fa96a]',
  error: 'text-[#d64545]',
}

/** 工具调用卡：标题行含工具名、动作、状态、节点 ID，可内嵌设计预览 */
export function ToolCard({
  provider,
  tool,
  action,
  status,
  nodeId,
  note,
  preview,
}: {
  provider: string
  tool: string
  action: string
  status: ToolStatus
  nodeId?: string
  note?: string
  preview?: boolean
}) {
  const [open, setOpen] = useState(true)
  // provider 留空时取品牌名，避免品牌字符串散落在数据里
  const providerName = provider || BRAND.name

  return (
    <div className="overflow-hidden rounded-[10px] border border-[#c7dcfa] bg-white">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-[7px] px-[12px] py-[10px] text-left"
      >
        <ProviderGlyph />
        <span className="shrink-0 text-[13px] font-semibold text-ink">
          {providerName} {tool}
        </span>
        <span className="truncate text-[12px] text-[#8a8a90]">
          {action} · <span className={STATUS_STYLE[status]}>{status}</span>
          {nodeId && ` · 节点 ${nodeId}`}
          {note && ` · ${note}`}
        </span>
        <ChevronDown
          size={14}
          strokeWidth={1.9}
          className={`ml-auto shrink-0 text-[#9a9aa0] ${open ? 'rotate-180' : ''} transition-transform`}
        />
      </button>

      {open && preview && <DesignPreview label={tool} />}
    </div>
  )
}

const TONE_BG: Record<ResultItem['tone'], string> = {
  red: 'linear-gradient(160deg,#f5143c,#c00d30)',
  dark: 'linear-gradient(160deg,#2b2f3a,#14161c)',
  light: 'linear-gradient(160deg,#ffffff,#f0f2f6)',
  warm: 'linear-gradient(160deg,#ffd9a8,#f2a65a)',
}

/** 批量结果：按规格分组的产出物缩略图网格 */
export function ResultGrid({ title, items }: { title: string; items: ResultItem[] }) {
  return (
    <div className="rounded-[10px] border border-hairline bg-white p-[11px]">
      <div className="mb-[9px] flex items-center gap-[6px]">
        <span className="flex h-[15px] w-[15px] items-center justify-center rounded-full bg-[#3fa96a]">
          <svg viewBox="0 0 12 12" className="h-[8px] w-[8px]">
            <path
              d="M2.5 6.2l2.2 2.2 4.8-4.8"
              fill="none"
              stroke="#fff"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </span>
        <span className="text-[12.5px] font-medium text-ink">{title}</span>
        <span className="text-[11.5px] text-[#9a9aa0]">共 {items.length} 项</span>
      </div>

      <div className="grid grid-cols-3 gap-[8px]">
        {items.map((item) => (
          <div key={item.label} className="min-w-0">
            <div className="flex h-[74px] items-center justify-center overflow-hidden rounded-[6px] bg-[#f4f4f6]">
              <div
                className="relative overflow-hidden rounded-[3px]"
                style={{
                  background: TONE_BG[item.tone],
                  // 按比例内接于 74px 高的容器
                  height: item.ratio > 1 ? 'auto' : '66px',
                  width: item.ratio > 1 ? '92%' : `${66 * item.ratio}px`,
                  aspectRatio: String(item.ratio),
                  border: item.tone === 'light' ? '1px solid #e4e6ea' : 'none',
                }}
              >
                {/* 标题条占位 */}
                <span
                  className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-[1px]"
                  style={{
                    width: '62%',
                    height: item.ratio > 1 ? '22%' : '11%',
                    background:
                      item.tone === 'light'
                        ? 'linear-gradient(90deg,#e8b04a,#f5d78a)'
                        : 'linear-gradient(90deg,#ffe9a8,#ffc74d)',
                  }}
                />
              </div>
            </div>
            <div className="mt-[5px] truncate text-[10.5px] text-[#6e6e75]">{item.label}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
