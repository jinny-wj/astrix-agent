import type { ReactNode } from 'react'
import {
  ArrowRight,
  Check,
  Image,
  Layers3,
  Palette,
  Sparkles,
  WandSparkles,
} from 'lucide-react'
import { openNewFileFromHomepage, openFigmaInBrowser } from '../config/figma'

type CaseCardProps = {
  title: string
  skill: string
  prompt: string
  children: ReactNode
}

function CaseCard({ title, skill, prompt, children }: CaseCardProps) {
  return (
    <button
      type="button"
      onClick={() => {
        const { surface, url } = openNewFileFromHomepage({ skill, prompt })
        if (surface === 'figma-tab') openFigmaInBrowser(url)
      }}
      className="group min-w-0 text-left"
    >
      <div className="relative aspect-[1.58/1] overflow-hidden rounded-[14px] border border-[#e2e5f1] bg-[#eef0ff] shadow-[0_10px_30px_rgba(80,74,150,0.06)] transition duration-300 group-hover:-translate-y-1 group-hover:border-[#d5d9ed] group-hover:shadow-[0_16px_34px_rgba(74,68,145,0.12)]">
        {children}
      </div>
      <h3 className="mt-[12px] truncate text-[14px] font-medium leading-5 text-ink">
        {title}
      </h3>
    </button>
  )
}

function ExplorerCase() {
  return (
    <div className="relative h-full overflow-hidden bg-[radial-gradient(circle_at_50%_12%,#ffffff_0,#f1efff_40%,#dfe8ff_100%)]">
      <div className="absolute -left-8 -top-12 h-36 w-36 rounded-full bg-[#b9c7ff]/50 blur-3xl" />
      <div className="absolute -bottom-12 right-3 h-32 w-32 rounded-full bg-[#dcc5ff]/60 blur-3xl" />

      <div className="absolute left-[8%] top-[17%] h-[72%] w-[25%] rotate-[-4deg] rounded-[10px] border border-white/90 bg-white/85 p-[5px] shadow-[0_12px_25px_rgba(79,73,154,0.16)] backdrop-blur">
        <div className="flex h-[9px] items-center gap-[2px] border-b border-[#ececf5]">
          <span className="h-[2px] w-[13px] rounded bg-[#c8c8d4]" />
          <span className="h-[2px] w-[7px] rounded bg-[#e0e0e8]" />
        </div>
        <div className="mt-[5px] rounded-[4px] bg-[#f0ebff] p-[4px]">
          <div className="h-[3px] w-3/5 rounded bg-[#9e8be8]" />
          <div className="mt-[3px] h-[15px] rounded bg-gradient-to-br from-[#b5a5ff] to-[#7b8ff0]" />
        </div>
        <div className="mt-[5px] grid grid-cols-2 gap-[3px]">
          {['#f4c8e7', '#c7d8ff', '#d9cffd', '#bce6ec'].map((color) => (
            <span key={color} className="h-[13px] rounded-[3px]" style={{ background: color }} />
          ))}
        </div>
        <div className="mt-[5px] h-[3px] w-4/5 rounded bg-[#d5d5df]" />
        <div className="mt-[3px] h-[3px] w-3/5 rounded bg-[#e2e2e9]" />
      </div>

      <div className="absolute left-[34%] top-[9%] z-10 h-[78%] w-[31%] rounded-[11px] border border-white bg-white p-[6px] shadow-[0_16px_30px_rgba(74,65,150,0.2)]">
        <div className="flex items-center justify-between">
          <span className="h-[4px] w-[28px] rounded bg-[#28283a]" />
          <span className="flex h-[10px] w-[10px] items-center justify-center rounded-full bg-[#eeecff] text-[#7566dc]">
            <Sparkles size={6} />
          </span>
        </div>
        <div className="mt-[6px] rounded-[5px] bg-gradient-to-r from-[#7a65e7] to-[#9b87ef] p-[6px] text-white">
          <div className="h-[3px] w-2/3 rounded bg-white/90" />
          <div className="mt-[3px] h-[2px] w-1/2 rounded bg-white/50" />
        </div>
        <div className="mt-[5px] flex gap-[3px]">
          <span className="h-[22px] flex-1 rounded-[4px] bg-[#fff2f8]" />
          <span className="h-[22px] flex-1 rounded-[4px] bg-[#eef3ff]" />
        </div>
        <div className="mt-[5px] flex items-center gap-[4px] rounded-[4px] bg-[#f6f6fa] p-[4px]">
          <span className="h-[10px] w-[10px] rounded-full bg-[#f0b5d4]" />
          <span className="h-[3px] flex-1 rounded bg-[#d4d4df]" />
        </div>
      </div>

      <div className="absolute right-[7%] top-[20%] h-[69%] w-[25%] rotate-[4deg] rounded-[10px] border border-white/90 bg-white/90 p-[5px] shadow-[0_12px_25px_rgba(79,73,154,0.16)]">
        <div className="rounded-[5px] bg-[#eaf3ff] p-[5px]">
          <div className="mx-auto flex h-[28px] w-[28px] items-center justify-center rounded-full bg-gradient-to-br from-[#7bc7ff] to-[#9275ee] text-white">
            <WandSparkles size={13} strokeWidth={1.8} />
          </div>
          <div className="mx-auto mt-[4px] h-[3px] w-2/3 rounded bg-[#8994c4]" />
        </div>
        <div className="mt-[5px] space-y-[3px]">
          {[75, 92, 62].map((width) => (
            <div key={width} className="flex items-center gap-[3px]">
              <Check size={5} className="text-[#7968dc]" strokeWidth={3} />
              <span className="h-[2px] rounded bg-[#d4d5df]" style={{ width: `${width}%` }} />
            </div>
          ))}
        </div>
      </div>

      <div className="absolute bottom-[7%] left-[62%] z-20 flex h-[30px] w-[30px] items-center justify-center rounded-[11px] border border-white/80 bg-gradient-to-br from-[#9f8cff] to-[#5b8df6] text-white shadow-[0_8px_18px_rgba(93,83,192,0.35)]">
        <Sparkles size={15} />
      </div>
    </div>
  )
}

function ResourceCase() {
  const panels = [
    { tone: 'from-[#806df0] to-[#a58cf7]', size: 'h-[77%] w-[27%]', rotate: '-rotate-3' },
    { tone: 'from-[#5c7ee9] to-[#879bf4]', size: 'h-[86%] w-[31%]', rotate: 'rotate-0' },
    { tone: 'from-[#9874e8] to-[#c48df0]', size: 'h-[72%] w-[25%]', rotate: 'rotate-3' },
  ]

  return (
    <div className="relative flex h-full items-end justify-center gap-[7px] overflow-hidden bg-[radial-gradient(circle_at_50%_85%,#ffffff_0,#eeeaff_48%,#dce8ff_100%)] px-[10%] pb-[8%] pt-[9%]">
      <div className="absolute left-[8%] top-[10%] flex items-center gap-[5px] text-[#6558b8]">
        <Layers3 size={13} />
        <span className="text-[8px] font-semibold tracking-[0.12em]">多尺寸资源位</span>
      </div>
      <div className="absolute right-[10%] top-[11%] rounded-full border border-white bg-white/70 px-[7px] py-[3px] text-[6px] font-medium text-[#7b70bd] shadow-sm">
        3 个方案已生成
      </div>

      {panels.map((panel, index) => (
        <div
          key={panel.tone}
          className={`relative ${panel.size} ${panel.rotate} overflow-hidden rounded-[9px] border border-white/70 bg-gradient-to-br ${panel.tone} p-[7px] shadow-[0_14px_25px_rgba(84,69,161,0.2)]`}
        >
          <div className="absolute -right-4 -top-3 h-14 w-14 rounded-full border-[7px] border-white/10" />
          <div className="absolute bottom-3 right-2 h-9 w-9 rounded-full bg-white/10 blur-sm" />
          <span className="inline-flex rounded-full bg-white/20 px-[4px] py-[2px] text-[4.5px] font-medium text-white">
            NEW
          </span>
          <div className="mt-[9px] text-center text-[7px] font-semibold leading-tight text-white">
            {index === 1 ? '夏日灵感' : index === 0 ? '创意焕新' : '限定礼遇'}
          </div>
          <div className="mx-auto mt-[3px] h-[2px] w-3/5 rounded bg-white/50" />
          <div className="absolute bottom-[9px] left-1/2 flex h-[15px] w-[60%] -translate-x-1/2 items-center justify-center rounded-full bg-white text-[4.5px] font-semibold text-[#6d5bc8]">
            立即探索
          </div>
        </div>
      ))}

      <div className="absolute bottom-[7%] left-[7%] flex h-[33px] w-[33px] items-center justify-center rounded-full border-[3px] border-white/70 bg-gradient-to-br from-[#74d6f6] to-[#796ae8] text-white shadow-[0_8px_20px_rgba(83,104,191,0.3)]">
        <WandSparkles size={15} />
      </div>
    </div>
  )
}

function ThemeSwitcherCase() {
  const themes = [
    { bg: '#f8eddf', accent: '#c19055', image: '#dbc09a' },
    { bg: '#eff0ff', accent: '#7668d8', image: '#a9a2ed' },
    { bg: '#e7f3ef', accent: '#398778', image: '#8bc6b9' },
    { bg: '#eaf3ff', accent: '#4d83c7', image: '#98bde8' },
  ]

  return (
    <div className="relative h-full overflow-hidden bg-[radial-gradient(circle_at_50%_100%,#ffffff_0%,#edf0ff_52%,#e2eaff_100%)]">
      <div className="absolute left-[7%] top-[10%] flex items-center gap-[5px] rounded-full border border-white bg-white/70 px-[7px] py-[4px] text-[7px] font-medium text-[#6359a9] shadow-sm backdrop-blur">
        <Palette size={10} />
        一键切换主题
      </div>
      <div className="absolute right-[8%] top-[11%] flex items-center gap-[4px]">
        {['#c39565', '#7969de', '#418a7c', '#4c83c7'].map((color) => (
          <span key={color} className="h-[7px] w-[7px] rounded-full ring-2 ring-white" style={{ background: color }} />
        ))}
      </div>

      <div className="absolute inset-x-[7%] bottom-[7%] flex h-[69%] items-end justify-between gap-[5px]">
        {themes.map((theme, index) => (
          <div
            key={theme.accent}
            className={`relative h-[91%] flex-1 overflow-hidden rounded-[8px] border-2 border-white p-[4px] shadow-[0_12px_20px_rgba(70,70,128,0.14)] ${
              index % 2 === 0 ? '-translate-y-[2px]' : ''
            }`}
            style={{ background: theme.bg }}
          >
            <div className="flex items-center justify-between">
              <span className="h-[3px] w-[17px] rounded" style={{ background: theme.accent }} />
              <span className="h-[5px] w-[5px] rounded-full border border-white" style={{ background: theme.accent }} />
            </div>
            <div className="relative mt-[5px] h-[40%] overflow-hidden rounded-[4px]" style={{ background: theme.image }}>
              <div className="absolute -bottom-3 -right-2 h-10 w-10 rotate-45 rounded-[8px] bg-white/25" />
              <Image size={11} className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-white/80" />
            </div>
            <div className="mt-[5px] h-[3px] w-4/5 rounded" style={{ background: theme.accent }} />
            <div className="mt-[3px] h-[2px] w-full rounded bg-black/10" />
            <div className="mt-[2px] h-[2px] w-3/5 rounded bg-black/10" />
            <div
              className="absolute inset-x-[5px] bottom-[5px] h-[8px] rounded-[3px]"
              style={{ background: theme.accent }}
            />
          </div>
        ))}
      </div>

      <div className="absolute bottom-[5%] right-[5%] flex h-[30px] w-[30px] items-center justify-center rounded-full bg-white text-[#7060d5] shadow-[0_8px_20px_rgba(79,73,146,0.2)]">
        <Sparkles size={14} />
      </div>
    </div>
  )
}

export default function CaseGallery() {
  return (
    <section
      id="home-creative"
      className="mx-auto mt-space-3xl max-w-[1104px] pb-space-3xl"
      aria-labelledby="case-gallery-title"
    >
      <div className="flex items-center justify-between">
        <h2 id="case-gallery-title" className="text-[16px] font-semibold tracking-[-0.01em] text-ink">
          精选案例
        </h2>
        <button
          type="button"
          onClick={() => {
            document.getElementById('design-capabilities')?.scrollIntoView({
              behavior: 'smooth',
              block: 'start',
            })
          }}
          className="group/more flex items-center gap-[5px] rounded-full px-[5px] py-[3px] text-[13px] font-medium text-[#5d73e8] transition-colors hover:text-[#4059d5] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#aeb9ff]"
        >
          了解更多
          <ArrowRight
            size={14}
            strokeWidth={2}
            className="transition-transform group-hover/more:translate-x-0.5"
          />
        </button>
      </div>

      <div className="mt-[18px] grid grid-cols-1 gap-x-[16px] gap-y-[26px] sm:grid-cols-2 lg:grid-cols-3">
        <CaseCard title="一键美化" skill="portrait-beautify" prompt="一键美化：主播照片抠图修图，保脸交付">
          <ExplorerCase />
        </CaseCard>
        <CaseCard title="资源位延展" skill="kv-resource-extension" prompt="资源位延展：一键适配多规格资源位">
          <ResourceCase />
        </CaseCard>
        <CaseCard title="人物战报" skill="battle-report" prompt="人物战报：选模板改文案换头像出图">
          <ThemeSwitcherCase />
        </CaseCard>
      </div>
    </section>
  )
}
