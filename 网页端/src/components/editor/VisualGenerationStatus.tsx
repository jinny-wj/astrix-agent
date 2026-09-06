import {
  Check,
  CheckCircle2,
  Layers3,
  LoaderCircle,
  Sparkles,
  WandSparkles,
} from 'lucide-react'
import { useEffect, useState } from 'react'

const VISUAL_PROMPT = '生成一张直播活动盛典视觉长图，突出舞台氛围、倒计时与嘉宾阵容。'

/** 新建设计稿首次打开时的轻量生成回放。 */
export default function VisualGenerationStatus() {
  const [complete, setComplete] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => setComplete(true), 1200)
    return () => window.clearTimeout(timer)
  }, [])

  return (
    <div className="p-space-lg" aria-live="polite">
      <div className="flex justify-end">
        <div className="max-w-[88%] rounded-xl bg-gradient-to-r from-[#4d87f7] to-[#6f7cf5] px-space-md py-space-sm text-[12.5px] font-medium leading-relaxed text-white shadow-sm">
          {VISUAL_PROMPT}
        </div>
      </div>

      <div
        className={[
          'mt-space-lg rounded-xl border p-space-md transition-colors duration-500',
          complete
            ? 'border-[#bce7cf] bg-[#f4fbf7]'
            : 'border-[#cfe0fb] bg-[#f7faff]',
        ].join(' ')}
      >
        <div className="flex items-start gap-space-sm">
          <span
            className={[
              'flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg',
              complete ? 'bg-[#def4e7] text-[#27a260]' : 'bg-[#e4efff] text-[#3979ea]',
            ].join(' ')}
          >
            {complete ? (
              <CheckCircle2 size={17} strokeWidth={2.1} />
            ) : (
              <LoaderCircle size={17} strokeWidth={2.1} className="animate-spin" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-space-sm">
              <p className="text-[13px] font-semibold text-ink">
                {complete ? '视觉稿已生成' : '正在生成视觉稿'}
              </p>
              <span
                className={[
                  'text-[11px] font-medium',
                  complete ? 'text-[#27955a]' : 'text-[#3979ea]',
                ].join(' ')}
              >
                {complete ? '完成' : '生成中'}
              </span>
            </div>
            <p className="mt-space-xs text-[11.5px] leading-relaxed text-[#777982]">
              {complete ? '已写入新画布，可直接选择图层继续修改。' : '正在组织版式、色彩与内容层级…'}
            </p>
          </div>
        </div>

        <div className="mt-space-md h-[4px] overflow-hidden rounded-full bg-[#dfe8f6]">
          <div
            className={[
              'h-full rounded-full bg-gradient-to-r from-[#3f82ee] to-[#836ff2] transition-all duration-700',
              complete ? 'w-full' : 'w-2/3 animate-pulse',
            ].join(' ')}
          />
        </div>
      </div>

      <div className="mt-space-md overflow-hidden rounded-xl border border-hairline bg-white shadow-card">
        <div className="flex items-center justify-between border-b border-hairline px-space-md py-space-sm">
          <div className="flex items-center gap-space-sm">
            <WandSparkles size={14} className="text-[#6b65e8]" strokeWidth={1.9} />
            <span className="text-[12px] font-semibold text-ink">直播活动盛典 · 视觉长图</span>
          </div>
          <span
            className={[
              'flex items-center gap-space-xs text-[10.5px]',
              complete ? 'text-[#27955a]' : 'text-[#8a8a90]',
            ].join(' ')}
          >
            {complete ? <Check size={11} strokeWidth={2.4} /> : <LoaderCircle size={11} className="animate-spin" />}
            {complete ? '可编辑' : '创建中'}
          </span>
        </div>

        <div className="flex gap-space-md p-space-md">
          <div
            className={[
              'relative flex h-[142px] w-[102px] shrink-0 flex-col overflow-hidden rounded-lg border border-[#6d52a8] bg-gradient-to-b from-[#211244] via-[#321354] to-[#180d2e] p-space-sm transition-opacity duration-500',
              complete ? 'opacity-100' : 'opacity-60',
            ].join(' ')}
          >
            <div className="absolute inset-x-0 top-1/4 h-[52px] bg-[radial-gradient(circle,rgba(154,79,255,0.48),transparent_68%)]" />
            <div className="relative flex items-center justify-between text-[#f7d97e]">
              <span className="flex items-center gap-space-xs text-[5px] font-semibold tracking-[0.2em]">
                <Sparkles size={6} fill="currentColor" />
                LIVE
              </span>
              <span className="flex h-[12px] items-center rounded-full border border-[#a991cf] px-space-xs text-[4.5px]">
                直播
              </span>
            </div>

            <div className="relative mt-space-sm text-center">
              <p className="text-[13px] font-black leading-none tracking-tight text-[#fff2bd]">
                直播
              </p>
              <p className="text-[10px] font-extrabold leading-tight text-white">活动盛典</p>
              <p className="mt-space-xs text-[4.5px] tracking-[0.16em] text-[#d9b9ff]">
                巅峰之夜 · 不见不散
              </p>
            </div>

            <div className="relative mt-space-sm grid grid-cols-3 gap-space-xs">
              {['02', '15', '30'].map((item) => (
                <span
                  key={item}
                  className="flex h-[18px] items-center justify-center rounded border border-[#8f6abe] bg-[#27133f] text-[6px] font-semibold text-[#ffe8a5]"
                >
                  {item}
                </span>
              ))}
            </div>

            <div className="relative mt-auto grid grid-cols-4 gap-space-xs">
              {[0, 1, 2, 3].map((item) => (
                <span
                  key={item}
                  className="h-[19px] rounded bg-gradient-to-b from-[#9b75bf] to-[#3b235c]"
                />
              ))}
            </div>
          </div>

          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center gap-space-sm">
              <span className="flex h-[26px] w-[26px] items-center justify-center rounded-lg bg-[#f0edff] text-[#665ee7]">
                <Layers3 size={14} strokeWidth={1.9} />
              </span>
              <div className="min-w-0">
                <p className="truncate text-[12px] font-semibold text-ink">视觉长图 01</p>
                <p className="text-[10.5px] text-[#92949c]">375 × 830</p>
              </div>
            </div>

            <div className="mt-space-md space-y-space-sm text-[11px] text-[#666872]">
              <p className="flex items-center gap-space-sm">
                <Check size={11} className="text-[#4d86ef]" strokeWidth={2.2} />
                12 个可编辑图层
              </p>
              <p className="flex items-center gap-space-sm">
                <Check size={11} className="text-[#4d86ef]" strokeWidth={2.2} />
                语义间距已应用
              </p>
              <p className="flex items-center gap-space-sm">
                <Check size={11} className="text-[#4d86ef]" strokeWidth={2.2} />
                视觉素材已分层
              </p>
            </div>

            <div className="mt-auto rounded-lg bg-[#f6f7f9] px-space-sm py-space-xs text-[10.5px] leading-relaxed text-[#777982]">
              {complete ? '点击画布元素即可修改内容与样式' : '画布与图层正在同步…'}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
