import { BRAND } from '../../config/brand'
import { CAPABILITIES, GUIDE_STEPS, type Capability } from '../../data/aiPanel'

/** 能力条目左侧的小图标 */
function CapabilityIcon({ cap }: { cap: Capability }) {
  return (
    <svg viewBox="0 0 20 20" className="mt-[1px] h-[15px] w-[15px] shrink-0">
      <rect x="0" y="0" width="20" height="20" rx="4.5" fill={cap.tone} opacity="0.14" />
      {cap.glyph === 'font' && (
        <text
          x="10"
          y="14.5"
          textAnchor="middle"
          fontSize="11"
          fontWeight="700"
          fill={cap.tone}
          fontFamily="Inter, sans-serif"
        >
          A
        </text>
      )}
      {cap.glyph === 'ui' && (
        <g fill={cap.tone}>
          <rect x="4" y="4.5" width="5" height="11" rx="1.2" />
          <rect x="10.5" y="4.5" width="5.5" height="5" rx="1.2" />
          <rect x="10.5" y="10.5" width="5.5" height="5" rx="1.2" />
        </g>
      )}
      {cap.glyph === 'motion' && (
        <g fill="none" stroke={cap.tone} strokeWidth="1.5" strokeLinecap="round">
          <circle cx="10" cy="10" r="5" />
          <path d="M10 5.5v-2M10 16.5v-2M5.5 10h-2M16.5 10h-2" />
        </g>
      )}
      {cap.glyph === 'assets' && (
        <g fill={cap.tone}>
          <rect x="4" y="4.5" width="5.2" height="5.2" rx="1.2" />
          <rect x="10.8" y="4.5" width="5.2" height="5.2" rx="1.2" />
          <rect x="4" y="10.8" width="5.2" height="5.2" rx="1.2" />
          <rect x="10.8" y="10.8" width="5.2" height="5.2" rx="1.2" />
        </g>
      )}
    </svg>
  )
}

/** 三步引导中的示意缩略图 */
function GuideThumb({ index }: { index: number }) {
  if (index === 0) {
    // 选中 Figma 节点：左侧图层列表 + 蓝色选中方块
    return (
      <div className="flex h-full w-full gap-[4px] p-[7px]">
        <div className="flex w-[26%] flex-col gap-[2.5px]">
          {Array.from({ length: 5 }).map((_, i) => (
            <span key={i} className="block h-[2.5px] rounded bg-[#e6e7ea]" />
          ))}
        </div>
        <div className="flex flex-1 items-center justify-center rounded-[3px] border border-[#0d99ff] bg-[#eaf5ff]">
          <span className="h-[16px] w-[24px] rounded-[2px] bg-[#0d99ff]" />
        </div>
      </div>
    )
  }
  if (index === 1) {
    // 描述需求：输入框形态
    return (
      <div className="flex h-full w-full items-center justify-center px-[9px]">
        <div className="flex w-full items-center justify-between rounded-[5px] border border-hairline bg-white px-[6px] py-[5px]">
          <span className="text-[5.5px] text-[#b0b0b6]">描述你的需求</span>
          <svg viewBox="0 0 12 12" className="h-[7px] w-[7px]">
            <path
              d="M6 1l1.2 3.2L10.4 5.4 7.2 6.6 6 9.8 4.8 6.6 1.6 5.4 4.8 4.2z"
              fill="#0d99ff"
            />
          </svg>
        </div>
      </div>
    )
  }
  // 生成：结果行 + 完成勾选
  return (
    <div className="flex h-full w-full items-center gap-[6px] px-[9px]">
      <svg viewBox="0 0 12 12" className="h-[9px] w-[9px] shrink-0">
        <path d="M6 0.6l1.3 3.5 3.5 1.3-3.5 1.3L6 10.2 4.7 6.7 1.2 5.4l3.5-1.3z" fill="#7f6df0" />
      </svg>
      <div className="flex flex-1 flex-col gap-[3px]">
        <span className="block h-[2.5px] w-full rounded bg-[#e6e7ea]" />
        <span className="block h-[2.5px] w-[62%] rounded bg-[#eeeff1]" />
      </div>
      <span className="flex h-[11px] w-[11px] shrink-0 items-center justify-center rounded-full bg-[#0d99ff]">
        <svg viewBox="0 0 12 12" className="h-[7px] w-[7px]">
          <path
            d="M2.5 6.2l2.2 2.2 4.8-4.8"
            fill="none"
            stroke="#fff"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      </span>
    </div>
  )
}

export default function AiWelcome() {
  return (
    <div className="px-[14px] pt-[14px]">
      {/* 白底欢迎区，保留小图标作为轻量视觉提示。 */}
      <div className="relative overflow-hidden bg-white px-[15px] py-[15px]">
        <div className="pr-[74px]">
          <h2 className="text-[14px] font-semibold leading-tight text-ink">
            {BRAND.welcomeTitle}
          </h2>
          <div className="mt-[8px] inline-flex items-center rounded-full border border-[#e9e9ed] bg-white px-[10px] py-[3px] text-[11px] font-medium text-[#747985]">
            点图层后，可在右侧修改或批量生成
          </div>
          <ul className="mt-[11px] space-y-[8px]">
            {CAPABILITIES.map((cap) => (
              <li key={cap.text} className="flex gap-[7px]">
                <CapabilityIcon cap={cap} />
                <span className="text-[11.5px] leading-[1.45] text-[#4e5158]">{cap.text}</span>
              </li>
            ))}
          </ul>
        </div>

        <img
          src="/assets/brand-mark.svg"
          alt=""
          data-slot="brand-mark-panel"
          className="absolute right-[8px] top-[26px] h-[84px] w-[78px] select-none"
          draggable={false}
        />
      </div>

      {/* 三步引导 */}
      <div className="mt-[16px]">
        <div className="flex gap-[9px]">
          {GUIDE_STEPS.map((step) => (
            <div key={step} className="flex-1 text-[11.5px] font-medium text-[#3b6fe0]">
              {step}
            </div>
          ))}
        </div>
        <div className="mt-[8px] flex gap-[9px]">
          {GUIDE_STEPS.map((_, i) => (
            <div
              key={i}
              className="h-[62px] flex-1 overflow-hidden rounded-[8px] border border-hairline bg-[#fcfcfd]"
            >
              <GuideThumb index={i} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
