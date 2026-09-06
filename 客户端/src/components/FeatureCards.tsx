import {
  Maximize2,
  Sparkles,
  UserRound,
  type LucideIcon,
} from 'lucide-react'
import { openNewFileFromHomepage, openFigmaInBrowser } from '../config/figma'
import { FEATURE_CARDS, type FeatureCard } from '../data/mock'

const ICONS: Record<FeatureCard['glyph'], LucideIcon> = {
  beautify: Sparkles,
  resize: Maximize2,
  report: UserRound,
}

const ICON_STYLES: Record<FeatureCard['glyph'], string> = {
  beautify: 'bg-[#fff3e4] text-[#d4892b]',
  resize: 'bg-[#f0edff] text-[#7565d8]',
  report: 'bg-[#e9f6ff] text-[#2389c4]',
}

export default function FeatureCards() {
  const openSkillWorkspace = (skill: string, prompt: string) => {
    const { surface, url } = openNewFileFromHomepage({ skill, prompt })
    if (surface === 'figma-tab') openFigmaInBrowser(url)
  }

  return (
    <section
      id="design-capabilities"
      aria-label="设计能力"
      className="mx-auto mt-space-2xl-plus grid max-w-[1002px] grid-cols-1 gap-space-sm sm:grid-cols-3"
    >
      {FEATURE_CARDS.map((card) => {
        const Icon = ICONS[card.glyph]
        return (
          <button
            key={card.key}
            type="button"
            onClick={() => openSkillWorkspace(card.key, `${card.title}：${card.desc}`)}
            className="group flex h-[76px] items-center gap-space-md rounded-[24px] border border-[rgba(0,0,0,0.05)] bg-white px-space-lg text-left transition hover:-translate-y-0.5 hover:border-[rgba(0,0,0,0.1)] hover:shadow-[0_8px_24px_rgba(31,35,41,0.06)]"
          >
            <span
              className={[
                'flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] transition group-hover:scale-[1.03]',
                ICON_STYLES[card.glyph],
              ].join(' ')}
            >
              <Icon size={20} strokeWidth={1.8} />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[14px] font-medium leading-[18px] text-[#0f1419]">
                {card.title}
              </span>
              <span className="mt-space-xs block truncate text-[12px] leading-[12px] text-[#72808a]">
                {card.desc}
              </span>
            </span>
          </button>
        )
      })}
    </section>
  )
}
