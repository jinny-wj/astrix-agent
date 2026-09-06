import { FolderClosed, Home, LayoutGrid, Sparkles } from 'lucide-react'
import { AppLogo } from './TitleBar'

export type HomeNavKey = 'generate' | 'assets' | 'tools' | 'creative'
const NAV_ITEMS = [
  { key: 'generate', label: '生成', Icon: Home },
  { key: 'assets', label: '资产', Icon: FolderClosed },
  { key: 'tools', label: '工具', Icon: LayoutGrid },
  { key: 'creative', label: '创意', Icon: Sparkles },
] as const

export default function Sidebar({ active, onNavigate }: {
  active: HomeNavKey
  onNavigate: (key: HomeNavKey) => void
}) {
  return (
    <aside className="studio-sidebar sticky top-0 flex h-screen w-[76px] shrink-0 flex-col items-center">
      <div className="absolute top-3"><AppLogo /></div>
      <nav aria-label="工作台导航" className="absolute top-1/2 flex -translate-y-1/2 flex-col gap-3">
        {NAV_ITEMS.map(({ key, label, Icon }) => (
          <button key={key} type="button" aria-current={active === key ? 'page' : undefined}
            onClick={() => onNavigate(key)}
            className={`flex h-[62px] w-[56px] flex-col items-center justify-center gap-2 rounded-2xl text-[12px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 ${active === key ? 'bg-white text-[#20242d] shadow-sm' : 'text-[#87909e] hover:bg-white/70 hover:text-[#20242d]'}`}>
            <Icon size={22} strokeWidth={1.7} />{label}
          </button>
        ))}
      </nav>
      <div className="absolute bottom-6 grid h-10 w-10 place-items-center rounded-full border border-[#e5e8f0] bg-white"><AppLogo symbolOnly /></div>
    </aside>
  )
}
