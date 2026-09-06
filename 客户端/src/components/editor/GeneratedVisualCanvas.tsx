import {
  ChevronDown,
  Copy,
  Download,
  Image,
  LoaderCircle,
  Palette,
  PencilLine,
  Sparkles,
  X,
} from 'lucide-react'
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type WheelEvent,
} from 'react'
import { useEditor, type GenerationStatus } from '../../state/editorStore'
import type {
  VisualDocument,
  VisualMotifName,
  VisualThemeName,
} from '../../types/visual'

type Theme = {
  name: string
  background: string
  surface: string
  surfaceStrong: string
  gold: string
  goldSoft: string
  glow: string
  glowSecondary: string
  text: string
  muted: string
}

const THEMES: Record<VisualThemeName, Theme> = {
  royal: {
    name: '鎏金紫',
    background: 'linear-gradient(155deg, #11031f 0%, #251044 48%, #120520 100%)',
    surface: 'rgba(75, 33, 112, 0.64)',
    surfaceStrong: 'rgba(104, 52, 145, 0.78)',
    gold: '#ffd978',
    goldSoft: '#fff1ba',
    glow: '#a845ff',
    glowSecondary: '#f8b94c',
    text: '#fffaf0',
    muted: '#cbbad9',
  },
  aurora: {
    name: '极光蓝',
    background: 'linear-gradient(155deg, #031626 0%, #0d3150 48%, #081523 100%)',
    surface: 'rgba(22, 83, 116, 0.62)',
    surfaceStrong: 'rgba(23, 112, 137, 0.76)',
    gold: '#72f2e3',
    goldSoft: '#d8fffb',
    glow: '#25c5ff',
    glowSecondary: '#e868ff',
    text: '#f3ffff',
    muted: '#a9cad7',
  },
  crimson: {
    name: '曜石红',
    background: 'linear-gradient(155deg, #220306 0%, #4a1015 48%, #1b0407 100%)',
    surface: 'rgba(117, 34, 40, 0.62)',
    surfaceStrong: 'rgba(151, 48, 47, 0.76)',
    gold: '#ffc568',
    goldSoft: '#fff0c4',
    glow: '#ff493f',
    glowSecondary: '#ffb846',
    text: '#fff9ef',
    muted: '#deb9b2',
  },
}

const THEME_ORDER: VisualThemeName[] = ['royal', 'aurora', 'crimson']
const MOTIF_ORDER: VisualMotifName[] = ['prism', 'orb', 'portal']

function SelectHandle({ position }: { position: 'tl' | 'tr' | 'bl' | 'br' }) {
  const positions = {
    tl: '-left-[5px] -top-[5px]',
    tr: '-right-[5px] -top-[5px]',
    bl: '-bottom-[5px] -left-[5px]',
    br: '-bottom-[5px] -right-[5px]',
  }

  return (
    <span
      aria-hidden="true"
      className={`absolute z-40 h-[9px] w-[9px] border border-[#0d99ff] bg-white ${positions[position]}`}
    />
  )
}

function HeroMotif({ motif, theme }: { motif: VisualMotifName; theme: Theme }) {
  if (motif === 'orb') {
    return (
      <div className="relative h-[174px] w-[252px]">
        <div
          className="absolute left-1/2 top-1/2 h-[136px] w-[136px] -translate-x-1/2 -translate-y-1/2 rounded-full blur-[18px]"
          style={{ background: theme.glow, opacity: 0.46 }}
        />
        <div
          className="absolute left-1/2 top-1/2 h-[116px] w-[116px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/30"
          style={{
            background: `radial-gradient(circle at 35% 28%, white 0%, ${theme.goldSoft} 8%, ${theme.glow} 38%, #16051f 100%)`,
            boxShadow: `0 0 34px ${theme.glow}, inset -18px -20px 32px rgba(0,0,0,.44)`,
          }}
        />
        <div className="absolute left-[50px] top-[26px] h-[122px] w-[152px] rotate-[-14deg] rounded-[50%] border border-white/35" />
        <div
          className="absolute left-[42px] top-[37px] h-[104px] w-[170px] rotate-[18deg] rounded-[50%] border"
          style={{ borderColor: theme.gold }}
        />
        <div
          className="absolute left-[118px] top-[10px] h-[14px] w-[14px] rotate-45 rounded-[3px]"
          style={{ background: theme.goldSoft, boxShadow: `0 0 18px ${theme.gold}` }}
        />
      </div>
    )
  }

  if (motif === 'portal') {
    return (
      <div className="relative h-[174px] w-[252px]">
        <div
          className="absolute left-1/2 top-[14px] h-[142px] w-[142px] -translate-x-1/2 rounded-full blur-[18px]"
          style={{ background: theme.glow, opacity: 0.36 }}
        />
        <div
          className="absolute left-1/2 top-[18px] h-[132px] w-[132px] -translate-x-1/2 rounded-full border-[7px]"
          style={{
            borderColor: theme.gold,
            boxShadow: `0 0 24px ${theme.gold}, inset 0 0 32px ${theme.glow}`,
          }}
        />
        <div
          className="absolute left-1/2 top-[35px] h-[98px] w-[98px] -translate-x-1/2 rounded-full border border-white/50"
          style={{ background: `radial-gradient(circle, transparent 8%, ${theme.glow}66 62%, transparent 70%)` }}
        />
        <div
          className="absolute bottom-[14px] left-1/2 h-[26px] w-[204px] -translate-x-1/2 rounded-[50%] blur-[6px]"
          style={{ background: theme.gold, opacity: 0.45 }}
        />
        <div
          className="absolute bottom-[22px] left-1/2 h-[9px] w-[188px] -translate-x-1/2 rounded-[50%]"
          style={{ background: `linear-gradient(90deg, transparent, ${theme.goldSoft}, transparent)` }}
        />
      </div>
    )
  }

  return (
    <div className="relative h-[174px] w-[252px]">
      <div
        className="absolute left-1/2 top-[18px] h-[142px] w-[142px] -translate-x-1/2 rotate-45 rounded-[18px] blur-[20px]"
        style={{ background: theme.glow, opacity: 0.38 }}
      />
      <div
        className="absolute left-1/2 top-[18px] h-[128px] w-[128px] -translate-x-1/2 rotate-45 rounded-[18px] border"
        style={{
          borderColor: theme.gold,
          background: `linear-gradient(145deg, ${theme.surfaceStrong}, rgba(255,255,255,.08))`,
          boxShadow: `0 0 22px ${theme.glow}, inset 0 0 28px rgba(255,255,255,.08)`,
        }}
      />
      <div
        className="absolute left-1/2 top-[41px] h-[84px] w-[84px] -translate-x-1/2 rotate-45 rounded-[12px] border border-white/35"
        style={{ background: `linear-gradient(145deg, ${theme.gold}55, transparent)` }}
      />
      <div
        className="absolute left-1/2 top-[51px] flex h-[66px] w-[66px] -translate-x-1/2 items-center justify-center rounded-full border-2 bg-black/35 text-[28px] font-black"
        style={{ borderColor: theme.gold, color: theme.goldSoft, boxShadow: `0 0 18px ${theme.gold}` }}
      >
        25
      </div>
      <div
        className="absolute bottom-[12px] left-1/2 h-[9px] w-[214px] -translate-x-1/2 rounded-[50%]"
        style={{ background: `linear-gradient(90deg, transparent, ${theme.gold}, transparent)` }}
      />
    </div>
  )
}

type PosterProps = {
  editable?: boolean
  motif: VisualMotifName
  onSelect?: (id: string) => void
  selectedNodeId?: string
  subtitle: string
  themeName: VisualThemeName
  title: string
}

function Poster({
  editable = false,
  motif,
  onSelect,
  selectedNodeId,
  subtitle,
  themeName,
  title,
}: PosterProps) {
  const theme = THEMES[themeName]
  const select = (event: PointerEvent<HTMLElement>, id: string) => {
    if (!editable || !onSelect) return
    event.stopPropagation()
    onSelect(id)
  }
  const selected = (id: string) => (
    editable && selectedNodeId === id
      ? 'outline outline-2 outline-[#0d99ff] outline-offset-2'
      : ''
  )

  return (
    <div
      className="relative h-[830px] w-[375px] overflow-hidden text-white shadow-[0_18px_60px_rgba(24,19,33,.24)]"
      style={{ background: theme.background }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-25"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.05) 1px, transparent 1px)',
          backgroundSize: '28px 28px',
          maskImage: 'linear-gradient(to bottom, black, transparent 74%)',
        }}
      />
      <div
        aria-hidden="true"
        className="absolute left-[-64px] top-[170px] h-[220px] w-[220px] rotate-45 rounded-[36px] blur-[4px]"
        style={{ border: `1px solid ${theme.gold}33` }}
      />
      <div
        aria-hidden="true"
        className="absolute right-[-52px] top-[112px] h-[168px] w-[168px] rotate-45 rounded-[28px]"
        style={{ border: `1px solid ${theme.glow}55` }}
      />
      <div
        aria-hidden="true"
        className="absolute left-1/2 top-[-90px] h-[310px] w-[310px] -translate-x-1/2 rounded-full blur-[54px]"
        style={{ background: theme.glow, opacity: 0.2 }}
      />

      <div className="relative flex h-full flex-col px-space-lg-plus pb-space-lg-plus pt-space-lg">
        <header className="flex items-start justify-between">
          <div className="flex items-center gap-space-sm">
            <span
              className="flex h-[28px] w-[28px] items-center justify-center rounded-full border text-[12px] font-bold"
              style={{ borderColor: theme.gold, color: theme.goldSoft }}
            >
              M
            </span>
            <div>
              <p className="text-[9px] font-semibold tracking-[.22em]" style={{ color: theme.goldSoft }}>
                LIVE · INFINITE
              </p>
              <p className="text-[7px] tracking-[.16em]" style={{ color: theme.muted }}>
                直播盛典 · 精彩无限
              </p>
            </div>
          </div>
          <div className="flex gap-space-xs">
            <span className="rounded-full border border-white/25 px-space-sm py-space-xs text-[7px]">分享</span>
            <span className="rounded-full border border-white/25 px-space-sm py-space-xs text-[7px]">规则</span>
          </div>
        </header>

        <section
          onPointerDown={(event) => select(event, 'visual-hero')}
          className={`relative mt-space-sm flex h-[168px] items-center justify-center ${selected('visual-hero')}`}
        >
          <HeroMotif motif={motif} theme={theme} />
        </section>

        <section
          onPointerDown={(event) => select(event, 'visual-title')}
          className={`relative z-10 text-center ${selected('visual-title')}`}
        >
          <p className="text-[10px] font-semibold tracking-[.42em]" style={{ color: theme.gold }}>
            2026 ANNUAL LIVE EVENT
          </p>
          <h1
            className="mt-space-xs text-[42px] font-black leading-[.98] tracking-[-.07em]"
            style={{
              color: theme.goldSoft,
              textShadow: `0 2px 0 ${theme.glowSecondary}, 0 0 20px ${theme.glow}`,
            }}
          >
            {title}
          </h1>
          <div className="mt-space-sm flex items-center justify-center gap-space-sm">
            <span className="h-px w-[44px]" style={{ background: `linear-gradient(90deg, transparent, ${theme.gold})` }} />
            <p
              className="rounded-full border px-space-md py-space-xs text-[9px] font-semibold tracking-[.18em]"
              style={{ borderColor: theme.gold, color: theme.goldSoft, background: theme.surface }}
            >
              {subtitle}
            </p>
            <span className="h-px w-[44px]" style={{ background: `linear-gradient(90deg, ${theme.gold}, transparent)` }} />
          </div>
        </section>

        <section
          onPointerDown={(event) => select(event, 'visual-features')}
          className={`mt-space-lg grid grid-cols-4 rounded-[10px] border border-white/10 p-space-sm ${selected('visual-features')}`}
          style={{ background: theme.surface }}
        >
          {[
            ['盛', '大咖云集', '顶级嘉宾阵容'],
            ['礼', '豪礼相送', '万元福利'],
            ['星', '精彩节目', '高能不断'],
            ['享', '专属福利', '限时特权'],
          ].map(([icon, name, description], index) => (
            <div
              key={name}
              className={`flex flex-col items-center text-center ${index > 0 ? 'border-l border-white/10' : ''}`}
            >
              <span className="text-[14px] font-black" style={{ color: theme.gold }}>{icon}</span>
              <strong className="mt-space-xs text-[8px]">{name}</strong>
              <span className="mt-space-xs text-[6px]" style={{ color: theme.muted }}>{description}</span>
            </div>
          ))}
        </section>

        <section className="mt-space-md text-center">
          <div className="flex items-center justify-center gap-space-sm">
            <span className="h-px w-[54px]" style={{ background: `linear-gradient(90deg, transparent, ${theme.gold})` }} />
            <p className="text-[10px] font-semibold tracking-[.18em]" style={{ color: theme.goldSoft }}>盛典倒计时</p>
            <span className="h-px w-[54px]" style={{ background: `linear-gradient(90deg, ${theme.gold}, transparent)` }} />
          </div>
          <div className="mt-space-sm flex items-end justify-center gap-space-xs">
            {[
              ['02', '天'],
              ['15', '时'],
              ['30', '分'],
              ['45', '秒'],
            ].map(([value, unit], index) => (
              <div key={unit} className="flex items-center gap-space-xs">
                {index > 0 && <span className="text-[12px]" style={{ color: theme.gold }}>:</span>}
                <span
                  className="flex h-[28px] min-w-[30px] items-center justify-center rounded-[5px] border text-[13px] font-bold"
                  style={{ borderColor: `${theme.gold}77`, background: theme.surface }}
                >
                  {value}
                </span>
                <span className="text-[6px]" style={{ color: theme.muted }}>{unit}</span>
              </div>
            ))}
          </div>
        </section>

        <section
          onPointerDown={(event) => select(event, 'visual-guests')}
          className={`mt-space-lg ${selected('visual-guests')}`}
        >
          <div className="flex items-center justify-center gap-space-sm">
            <span className="h-px w-[46px]" style={{ background: `linear-gradient(90deg, transparent, ${theme.gold})` }} />
            <p className="text-[10px] font-semibold tracking-[.14em]" style={{ color: theme.goldSoft }}>精彩亮点抢先看</p>
            <span className="h-px w-[46px]" style={{ background: `linear-gradient(90deg, ${theme.gold}, transparent)` }} />
          </div>
          <div className="mt-space-sm grid grid-cols-4 gap-space-sm">
            {[
              ['JY', '小静心', '甜美歌手'],
              ['LC', '林川', '实力唱将'],
              ['LEO', '橘子Leo', '人气主播'],
              ['AN', '安然', '新锐艺人'],
            ].map(([initials, name, role], index) => (
              <div
                key={name}
                className="overflow-hidden rounded-[7px] border border-white/10 pb-space-sm text-center"
                style={{ background: theme.surface }}
              >
                <div
                  className="relative mx-auto h-[62px] w-full overflow-hidden"
                  style={{
                    background: `radial-gradient(circle at 50% 24%, ${theme.goldSoft}aa 0 10%, transparent 11%), linear-gradient(${128 + index * 22}deg, ${theme.glow}, #18051f)`,
                  }}
                >
                  <div className="absolute bottom-[-24px] left-1/2 h-[70px] w-[58px] -translate-x-1/2 rounded-[50%] bg-white/20" />
                  <span className="absolute right-[5px] top-[5px] text-[6px] font-bold" style={{ color: theme.goldSoft }}>
                    {initials}
                  </span>
                </div>
                <p className="mt-space-xs text-[7px] font-semibold">{name}</p>
                <p className="mt-space-xs text-[6px]" style={{ color: theme.muted }}>{role}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-space-lg">
          <div className="flex items-center justify-center gap-space-sm">
            <span className="h-px w-[58px]" style={{ background: `linear-gradient(90deg, transparent, ${theme.gold})` }} />
            <p className="text-[9px] font-semibold tracking-[.16em]" style={{ color: theme.goldSoft }}>豪礼相送 · 惊喜不断</p>
            <span className="h-px w-[58px]" style={{ background: `linear-gradient(90deg, ${theme.gold}, transparent)` }} />
          </div>
          <div className="mt-space-sm grid grid-cols-4 gap-space-sm">
            {[
              ['PHONE', '旗舰手机'],
              ['VIP', '年度会员'],
              ['GIFT', '精美礼盒'],
              ['COIN', '海量金币'],
            ].map(([gift, name]) => (
              <div key={gift} className="rounded-[7px] border border-white/10 p-space-sm text-center" style={{ background: theme.surface }}>
                <strong className="text-[9px]" style={{ color: theme.gold }}>{gift}</strong>
                <p className="mt-space-xs text-[6px]" style={{ color: theme.muted }}>{name}</p>
              </div>
            ))}
          </div>
        </section>

        <section
          onPointerDown={(event) => select(event, 'visual-cta')}
          className={`mt-auto text-center ${selected('visual-cta')}`}
        >
          <button
            type="button"
            className="w-[180px] rounded-full px-space-xl py-space-sm text-[13px] font-black tracking-[.2em] text-[#321409] shadow-[0_7px_22px_rgba(255,197,78,.28)]"
            style={{ background: `linear-gradient(180deg, ${theme.goldSoft}, ${theme.gold} 58%, ${theme.glowSecondary})` }}
          >
            立即预约 →
          </button>
          <p className="mt-space-sm text-[6px]" style={{ color: theme.muted }}>预约开启提醒不错过每一刻精彩</p>
        </section>
      </div>
    </div>
  )
}

type ActionButtonProps = {
  children: string
  icon: typeof PencilLine
  onClick: () => void
  pressed?: boolean
}

function ActionButton({ children, icon: Icon, onClick, pressed = false }: ActionButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      className={`flex items-center gap-space-xs rounded-[7px] px-space-md py-space-sm text-[12px] font-medium transition-colors ${
        pressed ? 'bg-[#e8f3ff] text-[#0875c9]' : 'text-[#41434a] hover:bg-[#f4f5f7]'
      }`}
    >
      <Icon size={15} strokeWidth={1.8} />
      {children}
    </button>
  )
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  context.beginPath()
  context.roundRect(x, y, width, height, radius)
}

function exportVisualDocument(document: VisualDocument, format: 'png' | 'jpeg') {
  const scale = 3
  const canvas = window.document.createElement('canvas')
  canvas.width = document.width * scale
  canvas.height = document.height * scale
  const context = canvas.getContext('2d')
  if (!context) return
  context.scale(scale, scale)

  const palettes: Record<VisualThemeName, [string, string, string, string]> = {
    royal: ['#11031f', '#35115b', '#ffd978', '#a845ff'],
    aurora: ['#031626', '#0d4566', '#72f2e3', '#25c5ff'],
    crimson: ['#220306', '#68151d', '#ffc568', '#ff493f'],
  }
  const [background, surface, accent, glow] = palettes[document.themeName]
  const gradient = context.createLinearGradient(0, 0, document.width, document.height)
  gradient.addColorStop(0, background)
  gradient.addColorStop(0.52, surface)
  gradient.addColorStop(1, background)
  context.fillStyle = gradient
  context.fillRect(0, 0, document.width, document.height)

  const halo = context.createRadialGradient(188, 224, 16, 188, 224, 190)
  halo.addColorStop(0, `${glow}b8`)
  halo.addColorStop(1, `${glow}00`)
  context.fillStyle = halo
  context.fillRect(0, 40, document.width, 390)

  context.strokeStyle = `${accent}88`
  context.lineWidth = 2
  if (document.motif === 'orb') {
    context.beginPath()
    context.arc(188, 230, 82, 0, Math.PI * 2)
    context.stroke()
    context.beginPath()
    context.ellipse(188, 230, 122, 48, -0.24, 0, Math.PI * 2)
    context.stroke()
  } else if (document.motif === 'portal') {
    context.lineWidth = 9
    context.beginPath()
    context.arc(188, 228, 78, 0, Math.PI * 2)
    context.stroke()
  } else {
    context.save()
    context.translate(188, 228)
    context.rotate(Math.PI / 4)
    roundedRect(context, -68, -68, 136, 136, 16)
    context.stroke()
    context.restore()
  }

  context.textAlign = 'center'
  context.fillStyle = '#fffdf7'
  context.font = '900 43px "PingFang SC", sans-serif'
  context.fillText(document.title.slice(0, 12), 188, 386)
  context.fillStyle = accent
  context.font = '600 14px "PingFang SC", sans-serif'
  context.fillText(document.subtitle.slice(0, 24), 188, 418)

  context.font = '600 12px sans-serif'
  ;['02', '15', '30', '45'].forEach((item, index) => {
    const x = 72 + index * 60
    context.fillStyle = `${surface}e8`
    roundedRect(context, x, 456, 42, 36, 6)
    context.fill()
    context.strokeStyle = `${accent}99`
    context.stroke()
    context.fillStyle = '#fffdf7'
    context.fillText(item, x + 21, 479)
  })

  ;[0, 1, 2, 3].forEach((index) => {
    const x = 26 + index * 84
    context.fillStyle = `${surface}dd`
    roundedRect(context, x, 552, 70, 104, 8)
    context.fill()
    const portrait = context.createLinearGradient(x, 552, x + 70, 628)
    portrait.addColorStop(0, `${accent}dd`)
    portrait.addColorStop(1, `${glow}aa`)
    context.fillStyle = portrait
    roundedRect(context, x + 6, 558, 58, 68, 6)
    context.fill()
    context.fillStyle = '#ffffff'
    context.font = '500 9px "PingFang SC", sans-serif'
    context.fillText(`嘉宾 ${index + 1}`, x + 35, 643)
  })

  const buttonGradient = context.createLinearGradient(72, 0, 303, 0)
  buttonGradient.addColorStop(0, accent)
  buttonGradient.addColorStop(0.5, '#fff1b8')
  buttonGradient.addColorStop(1, accent)
  context.fillStyle = buttonGradient
  roundedRect(context, 72, 716, 231, 48, 24)
  context.fill()
  context.fillStyle = '#3a2444'
  context.font = '700 16px "PingFang SC", sans-serif'
  context.fillText('立即参与  →', 188, 746)

  canvas.toBlob((blob) => {
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const link = window.document.createElement('a')
    link.download = `${document.title || '视觉稿'}.${format === 'jpeg' ? 'jpg' : 'png'}`
    link.href = url
    window.document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }, `image/${format}`, 0.94)
}

function GeneratingBoard({
  prompt,
  status,
}: {
  prompt: string
  status: GenerationStatus
}) {
  const failed = status === 'error'
  return (
    <div className="relative shrink-0">
      <div className="mb-space-md flex items-center gap-space-sm text-[12px] font-medium text-[#72747a]">
        <span>新建设计稿</span>
        <span className="rounded-full bg-white/75 px-space-sm py-space-xs text-[9px] text-[#787b82]">
          {failed ? '等待重试' : '生成中'}
        </span>
      </div>
      <div className="relative flex h-[830px] w-[375px] flex-col overflow-hidden border border-[#d5d7db] bg-white shadow-[0_18px_60px_rgba(24,19,33,.12)]">
        <div className="h-[7px] w-full bg-gradient-to-r from-[#35b7d2] via-[#6f7cf5] to-[#9a6de8]" />
        <div className="flex flex-1 flex-col items-center justify-center px-space-2xl text-center">
          <span className={`flex h-[52px] w-[52px] items-center justify-center rounded-[16px] ${failed ? 'bg-[#fff0f0] text-[#cb4b4b]' : 'bg-[#eef4ff] text-[#4d7ee8]'}`}>
            <LoaderCircle size={24} strokeWidth={1.8} className={failed ? '' : 'animate-spin'} />
          </span>
          <p className="mt-space-lg text-[16px] font-semibold text-[#282b31]">
            {failed ? '生成暂时中断' : '正在生成视觉稿'}
          </p>
          <p className="mt-space-sm max-w-[280px] text-[12px] leading-relaxed text-[#7b7e86]">
            {failed ? '请在右侧 Agent 面板重新生成。' : prompt || '正在组织版式、主题、素材与可编辑图层…'}
          </p>
          <div className="mt-space-xl h-[5px] w-[220px] overflow-hidden rounded-full bg-[#edf0f4]">
            <div className={`h-full rounded-full bg-gradient-to-r from-[#35b7d2] to-[#7b6de8] ${failed ? 'w-1/3 opacity-40' : 'w-2/3 animate-pulse'}`} />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-space-sm border-t border-[#eef0f2] p-space-lg">
          {['版式结构', '视觉风格', '图层语义'].map((item) => (
            <span key={item} className="rounded-[8px] bg-[#f5f6f8] px-space-sm py-space-md text-center text-[10px] text-[#8b8e95]">{item}</span>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function GeneratedVisualCanvas() {
  const {
    visualDraft,
    visualReady,
    visualDocument,
    updateVisualDocument,
    duplicateVisualDocument,
    generationStatus,
    agentPrompt,
    selectedNodeId,
    selectNode,
    zoom,
    setZoom,
    pan,
    setPan,
  } = useEditor()
  const viewportRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{
    pointerId: number
    x: number
    y: number
    panX: number
    panY: number
  } | null>(null)
  const [editingCopy, setEditingCopy] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const {
    title,
    subtitle,
    themeName,
    motif,
    copyCount,
  } = visualDocument

  const visualSelected = selectedNodeId.startsWith('visual-')

  useEffect(() => {
    if (visualDraft && !selectedNodeId.startsWith('visual-')) {
      selectNode('visual-root')
    }
  }, [selectedNodeId, selectNode, visualDraft])

  const beginPan = (event: PointerEvent<HTMLDivElement>) => {
    const blankPrimary = event.button === 0 && event.target === event.currentTarget
    const middleButton = event.button === 1
    if (!blankPrimary && !middleButton) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      panX: pan.x,
      panY: pan.y,
    }
  }

  const movePan = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return
    setPan({
      x: drag.current.panX + event.clientX - drag.current.x,
      y: drag.current.panY + event.clientY - drag.current.y,
    })
  }

  const endPan = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return
    drag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const wheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (!event.ctrlKey && !event.metaKey) {
      setPan({ x: pan.x - event.deltaX, y: pan.y - event.deltaY })
      return
    }

    const nextZoom = Math.min(2, Math.max(0.35, zoom * (event.deltaY > 0 ? 0.9 : 1.1)))
    const rect = viewportRef.current?.getBoundingClientRect()
    if (rect) {
      const cursorX = event.clientX - (rect.left + rect.width / 2)
      const cursorY = event.clientY - (rect.top + rect.height / 2)
      const ratio = nextZoom / zoom
      setPan({
        x: cursorX - (cursorX - pan.x) * ratio,
        y: cursorY - (cursorY - pan.y) * ratio,
      })
    }
    setZoom(nextZoom)
  }

  const cycleTheme = () => {
    const current = THEME_ORDER.indexOf(themeName)
    updateVisualDocument({
      themeName: THEME_ORDER[(current + 1) % THEME_ORDER.length],
    })
  }
  const cycleMotif = () => {
    const current = MOTIF_ORDER.indexOf(motif)
    updateVisualDocument({
      motif: MOTIF_ORDER[(current + 1) % MOTIF_ORDER.length],
    })
  }

  return (
    <div
      ref={viewportRef}
      aria-label="AI 生成视觉画布"
      data-visual-draft={visualDraft ? 'true' : 'false'}
      className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-[#e9e9ea]"
      style={{ touchAction: 'none' }}
      onPointerDown={beginPan}
      onPointerMove={movePan}
      onPointerUp={endPan}
      onPointerCancel={endPan}
      onWheel={wheel}
    >
      {visualReady && generationStatus === 'running' && (
        <div className="absolute left-1/2 top-space-lg z-[70] flex -translate-x-1/2 items-center gap-space-sm rounded-full border border-[#cfe0fb] bg-white/95 px-space-lg py-space-sm text-[11.5px] font-medium text-[#3979ea] shadow-[0_8px_24px_rgba(28,57,98,.12)] backdrop-blur">
          <LoaderCircle size={13} className="animate-spin" />
          Agent 正在更新画布
        </div>
      )}
      <div
        className="relative flex w-max items-start gap-space-3xl pt-space-4xl"
        style={{
          transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
          transformOrigin: 'center center',
        }}
      >
        {!visualReady ? (
          <GeneratingBoard prompt={agentPrompt} status={generationStatus} />
        ) : (
          <>
        <div className="relative shrink-0">
          <div className="mb-space-md flex items-center gap-space-sm text-[12px] font-medium text-[#72747a]">
            <span>原始视觉稿</span>
            <span className="rounded-full bg-white/70 px-space-sm py-space-xs text-[9px] text-[#96989e]">参考</span>
          </div>
          <Poster
            motif="prism"
            subtitle="巅峰之夜 · 不见不散"
            themeName="royal"
            title="直播活动盛典"
          />
        </div>

        <div className="relative shrink-0">
          <div className="mb-space-md flex items-center gap-space-sm text-[12px] font-medium text-[#0875c9]">
            <Sparkles size={14} />
            <span>AI 生成方案</span>
            <span className="rounded-full bg-[#e5f2ff] px-space-sm py-space-xs text-[9px]">可编辑</span>
          </div>

          <div
            onPointerDown={(event) => {
              event.stopPropagation()
              selectNode('visual-root')
            }}
            className={`relative border-[1.5px] ${
              visualSelected ? 'border-[#0d99ff]' : 'border-transparent'
            }`}
          >
            {visualSelected && (
              <>
                <SelectHandle position="tl" />
                <SelectHandle position="tr" />
                <SelectHandle position="bl" />
                <SelectHandle position="br" />
                <div className="absolute -top-[72px] left-1/2 z-50 flex -translate-x-1/2 items-center gap-space-xs whitespace-nowrap rounded-[10px] border border-[#d9dadd] bg-white p-space-xs shadow-[0_8px_28px_rgba(36,41,51,.16)]">
                  <ActionButton
                    icon={PencilLine}
                    onClick={() => setEditingCopy((value) => !value)}
                    pressed={editingCopy}
                  >
                    修改文案
                  </ActionButton>
                  <ActionButton icon={Image} onClick={cycleMotif}>换图</ActionButton>
                  <ActionButton icon={Palette} onClick={cycleTheme}>调整风格</ActionButton>
                  <ActionButton icon={Copy} onClick={duplicateVisualDocument}>复制方案</ActionButton>
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setExportOpen((value) => !value)}
                      className="flex items-center gap-space-xs rounded-[7px] px-space-md py-space-sm text-[12px] font-medium text-[#41434a] transition-colors hover:bg-[#f4f5f7]"
                    >
                      <Download size={15} strokeWidth={1.8} />
                      导出
                      <ChevronDown size={12} />
                    </button>
                    {exportOpen && (
                      <div className="absolute right-0 top-[38px] z-[80] w-[112px] rounded-[8px] border border-[#d9dadd] bg-white p-space-xs shadow-[0_10px_26px_rgba(36,41,51,.16)]">
                        <button type="button" onClick={() => { exportVisualDocument(visualDocument, 'png'); setExportOpen(false) }} className="w-full rounded-[6px] px-space-sm py-space-sm text-left text-[11.5px] hover:bg-[#f4f5f7]">PNG 图片</button>
                        <button type="button" onClick={() => { exportVisualDocument(visualDocument, 'jpeg'); setExportOpen(false) }} className="w-full rounded-[6px] px-space-sm py-space-sm text-left text-[11.5px] hover:bg-[#f4f5f7]">JPG 图片</button>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}

            {editingCopy && (
              <div
                onPointerDown={(event) => event.stopPropagation()}
                className="absolute left-1/2 top-space-lg z-50 w-[286px] -translate-x-1/2 rounded-[12px] border border-[#dedfe2] bg-white p-space-lg shadow-[0_12px_38px_rgba(24,29,38,.22)]"
              >
                <div className="flex items-center justify-between">
                  <strong className="text-[12px] text-[#292b30]">修改画面文案</strong>
                  <button
                    type="button"
                    aria-label="关闭文案编辑"
                    onClick={() => setEditingCopy(false)}
                    className="rounded-[6px] p-space-xs text-[#777a82] hover:bg-[#f3f4f5]"
                  >
                    <X size={14} />
                  </button>
                </div>
                <label className="mt-space-md block text-[10px] text-[#73767d]">
                  主标题
                  <input
                    value={title}
                    onChange={(event) => updateVisualDocument({ title: event.target.value })}
                    className="mt-space-xs h-[34px] w-full rounded-[7px] border border-[#dcdde0] px-space-sm text-[12px] text-[#292b30] outline-none focus:border-[#0d99ff]"
                  />
                </label>
                <label className="mt-space-sm block text-[10px] text-[#73767d]">
                  副标题
                  <input
                    value={subtitle}
                    onChange={(event) => updateVisualDocument({ subtitle: event.target.value })}
                    className="mt-space-xs h-[34px] w-full rounded-[7px] border border-[#dcdde0] px-space-sm text-[12px] text-[#292b30] outline-none focus:border-[#0d99ff]"
                  />
                </label>
              </div>
            )}

            <Poster
              editable
              motif={motif}
              onSelect={selectNode}
              selectedNodeId={selectedNodeId}
              subtitle={subtitle}
              themeName={themeName}
              title={title}
            />
          </div>

          <div className="mt-space-sm flex items-center justify-between text-[10px] text-[#85878d]">
            <span>{THEMES[themeName].name} · {MOTIF_ORDER.indexOf(motif) + 1}/3 构图</span>
            <span>375 × 830</span>
          </div>
        </div>

        {Array.from({ length: copyCount }).map((_, index) => (
          <div key={index} className="relative shrink-0">
            <div className="mb-space-md flex items-center gap-space-sm text-[12px] font-medium text-[#72747a]">
              <Copy size={13} />
              <span>方案副本 {index + 1}</span>
            </div>
            <Poster
              motif={motif}
              subtitle={subtitle}
              themeName={themeName}
              title={title}
            />
          </div>
        ))}
          </>
        )}
      </div>
    </div>
  )
}
