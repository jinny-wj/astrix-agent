import { Box, Check, ChevronDown, Plus } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import {
  addCustomModel,
  listStudioModels,
  readSelectedModel,
  writeSelectedModel,
  type StudioModel,
} from '../config/models'

function AutoMark() {
  const gradientId = useId().replace(/:/g, '')
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4 shrink-0" aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="2" y1="14" x2="14" y2="2">
          <stop offset="0%" stopColor="#5b8cff" />
          <stop offset="42%" stopColor="#7b5cff" />
          <stop offset="72%" stopColor="#ff7ab0" />
          <stop offset="100%" stopColor="#ffb347" />
        </linearGradient>
      </defs>
      <path
        d="M8 1.6 14.4 13.2H1.6L8 1.6z"
        fill={`url(#${gradientId})`}
      />
    </svg>
  )
}

function ModelIcon({ model }: { model: StudioModel }) {
  if (model.group === 'auto') return <AutoMark />
  return <Box size={15} strokeWidth={1.8} className="shrink-0 text-[#6f7784]" />
}

export default function ModelSwitcher({
  variant = 'chip',
}: {
  variant?: 'chip' | 'plain'
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const [selected, setSelected] = useState<StudioModel>(() => readSelectedModel())
  const [models, setModels] = useState<StudioModel[]>(() => listStudioModels())

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
        setAdding(false)
        setDraft('')
      }
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  useEffect(() => {
    if (adding) inputRef.current?.focus()
  }, [adding])

  const selectModel = (model: StudioModel) => {
    setSelected(writeSelectedModel(model.id))
    setOpen(false)
    setAdding(false)
    setDraft('')
  }

  const submitCustom = () => {
    const model = addCustomModel(draft)
    if (!model) return
    setModels(listStudioModels())
    setSelected(model)
    setAdding(false)
    setDraft('')
    setOpen(false)
  }

  const autoModels = models.filter((model) => model.group === 'auto')
  const onlineModels = models.filter((model) => model.group === 'online')

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="切换模型"
        onClick={() => setOpen((value) => !value)}
        className={
          variant === 'chip'
            ? 'flex h-9 items-center gap-space-sm rounded-[8px] border border-[#e5e8eb] bg-white px-space-md text-[12px] font-medium text-[#30383e] hover:bg-[#f7f8f9]'
            : 'flex items-center gap-[3px] text-[12px] text-[#6e6e75] hover:text-ink'
        }
      >
        {variant === 'chip' ? <Box size={14} strokeWidth={1.8} /> : null}
        {selected.label}
        <ChevronDown
          size={13}
          strokeWidth={1.9}
          className={variant === 'chip' ? 'text-[#929aa6]' : undefined}
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute bottom-[calc(100%+8px)] left-0 z-50 w-[268px] rounded-[14px] border border-[#e6e9ef] bg-white p-2 shadow-[0_16px_48px_rgba(32,42,64,0.16)]"
        >
          <div className="flex items-center justify-between px-2 pb-1.5 pt-1">
            <span className="text-[13px] font-semibold text-[#20242d]">模型切换</span>
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="flex items-center gap-0.5 text-[12px] font-medium text-[#3877f6] hover:text-[#1758dd]"
            >
              <Plus size={13} strokeWidth={2.2} />
              添加模型
            </button>
          </div>

          <p className="px-2 pb-1 pt-2 text-[11px] font-medium text-[#8b93a1]">自动</p>
          {autoModels.map((model) => (
            <button
              key={model.id}
              type="button"
              role="menuitemradio"
              aria-checked={selected.id === model.id}
              onClick={() => selectModel(model)}
              className="flex w-full items-center gap-2.5 rounded-[10px] px-2 py-2 text-left text-[13px] text-[#2d3340] hover:bg-[#f5f7fb]"
            >
              <ModelIcon model={model} />
              <span className="min-w-0 flex-1 truncate font-medium">{model.label}</span>
              {selected.id === model.id ? (
                <Check size={15} strokeWidth={2.2} className="text-[#3877f6]" />
              ) : null}
            </button>
          ))}

          <p className="px-2 pb-1 pt-2 text-[11px] font-medium text-[#8b93a1]">在线推理</p>
          {onlineModels.map((model) => (
            <button
              key={model.id}
              type="button"
              role="menuitemradio"
              aria-checked={selected.id === model.id}
              onClick={() => selectModel(model)}
              className="flex w-full items-center gap-2.5 rounded-[10px] px-2 py-2 text-left text-[13px] text-[#2d3340] hover:bg-[#f5f7fb]"
            >
              <ModelIcon model={model} />
              <span className="min-w-0 flex-1 truncate font-medium">{model.label}</span>
              {selected.id === model.id ? (
                <Check size={15} strokeWidth={2.2} className="text-[#3877f6]" />
              ) : null}
            </button>
          ))}

          {adding && (
            <form
              className="mt-1 flex gap-1.5 px-1 pb-1"
              onSubmit={(event) => {
                event.preventDefault()
                submitCustom()
              }}
            >
              <input
                ref={inputRef}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="模型名称"
                className="h-8 min-w-0 flex-1 rounded-[8px] border border-[#e5e8eb] px-2 text-[12px] text-[#30383e] outline-none placeholder:text-[#9aa3b0] focus:border-[#3877f6]"
              />
              <button
                type="submit"
                disabled={!draft.trim()}
                className="h-8 rounded-[8px] bg-[#3877f6] px-2.5 text-[12px] font-medium text-white disabled:opacity-40"
              >
                添加
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  )
}
