import { useRouter } from '../router'
import { beginCodeWorkspaceFile } from '../config/workspace'

/** 使用已确认的原始 Logo，通过视口去掉画布留白，不重新绘制。 */
function AppLogo({ symbolOnly = false }: { symbolOnly?: boolean }) {
  return (
    <svg role="img" aria-label="星序 Astrix" viewBox={symbolOnly ? '428 315 372 304' : '428 315 802 304'}
      className={symbolOnly ? 'h-7 w-7' : 'h-10 w-[64px]'}>
      <image href="/assets/brand/astrix-logo.png" width="1672" height="941" />
    </svg>
  )
}

/** macOS 窗口三色灯 */
function TrafficLights() {
  return (
    <div className="flex items-center gap-[8px]">
      <span className="h-[12px] w-[12px] rounded-full bg-[#ff5f57]" />
      <span className="h-[12px] w-[12px] rounded-full bg-[#febc2e]" />
      <span className="h-[12px] w-[12px] rounded-full bg-[#28c840]" />
    </div>
  )
}

function ModeSwitch() {
  const { navigate } = useRouter()
  return (
    <div className="flex items-center gap-[2px] rounded-[9px] border border-hairline bg-[#f4f4f5] p-[3px]">
      <button
        type="button"
        className="rounded-[7px] bg-white px-[18px] py-[5px] text-[13px] font-medium text-[#3b6fe0] shadow-[0_1px_2px_rgba(16,18,27,0.06)]"
      >
        Design
      </button>
      <button
        type="button"
        title="根据 Figma 选区生成 React + Tailwind"
        onClick={() => {
          const file = beginCodeWorkspaceFile()
          navigate('editor', { fileId: file.fileId })
        }}
        className="rounded-[7px] px-[18px] py-[5px] text-[13px] text-[#6e6e75] hover:bg-white/80 hover:text-[#3b6fe0]"
      >
        Code
      </button>
    </div>
  )
}

export default function TitleBar() {
  return (
    <header className="flex h-[52px] shrink-0 items-center justify-between px-[18px]">
      <div className="flex items-center gap-[26px]">
        <TrafficLights />
      </div>
      <ModeSwitch />
    </header>
  )
}

export { AppLogo }
