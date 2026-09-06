import {
  ArrowUp,
  AtSign,
  ImagePlus,
  Layers3,
  Monitor,
  Sparkles,
  X,
} from 'lucide-react'
import { useRef, useState } from 'react'
import { BRAND } from '../config/brand'
import { openNewFileFromHomepage, openFigmaInBrowser } from '../config/figma'
import { withAttachmentPrompt } from '../config/workspace'
import { uploadAgentAttachments } from '../services/agentApi'
import { filesToUploadPayload } from '../services/agentComposer'
import ModelSwitcher from './ModelSwitcher'

const PLACEHOLDER = BRAND.homePlaceholder
const OUTPUT_SPECS = ['Web · 1440', '直播封面 · 720×1280', '弹窗 · 840×1120', 'Banner · 584×160']

export default function PromptInput() {
  const [value, setValue] = useState('')
  const [specIndex, setSpecIndex] = useState(0)
  const [editable, setEditable] = useState(true)
  const [contextFiles, setContextFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const canSend = (value.trim().length > 0 || contextFiles.length > 0) && !busy

  const addContextFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return
    const next = Array.from(files).slice(0, 8)
    setContextFiles((current) => {
      const merged = [...current]
      for (const file of next) {
        const exists = merged.some((item) => (
          item.name === file.name
          && item.size === file.size
          && item.lastModified === file.lastModified
        ))
        if (!exists) merged.push(file)
      }
      return merged.slice(0, 8)
    })
    setError('')
  }

  const createDraft = () => {
    if (busy) return
    void (async () => {
      setBusy(true)
      setError('')
      try {
        const uploaded = contextFiles.length > 0
          ? await uploadAgentAttachments(await filesToUploadPayload(contextFiles))
          : []
        if (contextFiles.length > 0 && uploaded.length === 0) {
          throw new Error('参考文件没有上传成功，请重试。')
        }
        const prompt = withAttachmentPrompt(
          [
            value.trim() || '请按交付规格生成设计稿',
            `交付规格：${OUTPUT_SPECS[specIndex]}；输出：${editable ? '可编辑图层' : '导出图片'}。`,
          ].join('\n\n'),
          uploaded,
        )
        const { surface, url } = openNewFileFromHomepage({
          prompt,
          skill: 'visual-draft-generation',
          attachments: uploaded,
        })
        if (surface === 'figma-tab') void openFigmaInBrowser(url)
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : '参考文件上传失败')
      } finally {
        setBusy(false)
      }
    })()
  }

  return (
    <section className="mx-auto mt-space-2xl-plus max-w-[1002px]">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,.pdf,.txt,.md,.json,.csv"
        multiple
        className="hidden"
        onChange={(event) => {
          addContextFiles(event.target.files)
          event.currentTarget.value = ''
        }}
      />
      <div className="grid min-h-[176px] grid-rows-[minmax(98px,auto)_36px] gap-space-md overflow-hidden rounded-[24px] border border-[rgba(0,0,0,0.05)] bg-[var(--home-surface)] px-space-lg pb-space-lg pt-space-md shadow-[0_8px_28px_rgba(31,35,41,0.035)] transition focus-within:border-[rgba(0,161,194,0.28)] focus-within:shadow-[0_10px_32px_rgba(31,90,103,0.07)]">
        <div className="flex min-h-0 gap-space-md">
          <div className="flex w-[64px] shrink-0 justify-center pt-space-xs">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              title="添加参考图或上下文文件"
              aria-label="添加参考图"
              className="group flex h-[70px] w-[56px] -rotate-[7deg] flex-col items-center justify-center gap-space-xs rounded-[3px] bg-[rgba(0,0,0,0.05)] text-[rgba(83,100,113,0.72)] hover:bg-[rgba(0,0,0,0.08)]"
            >
              <ImagePlus size={17} strokeWidth={1.7} />
              <span className="text-[10px] font-normal">参考内容</span>
            </button>
          </div>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <textarea
              aria-label="描述设计需求"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={PLACEHOLDER}
              rows={3}
              className="scroll-clean h-full min-w-0 flex-1 resize-none border-0 bg-transparent pt-space-xs text-[14px] leading-[24px] text-[#0f1419] outline-none placeholder:text-[rgba(83,100,113,0.64)]"
            />
            {contextFiles.length > 0 ? (
              <div className="flex flex-wrap gap-1 pb-1">
                {contextFiles.map((file, index) => (
                  <span
                    key={`${file.name}-${file.size}-${file.lastModified}-${index}`}
                    className="inline-flex items-center gap-1 rounded-full bg-[#eef3ff] px-2 py-0.5 text-[11px] text-[#3b6fe0]"
                  >
                    {file.name}
                    <button
                      type="button"
                      aria-label={`移除 ${file.name}`}
                      onClick={() => setContextFiles((current) => current.filter((_, itemIndex) => (
                        itemIndex !== index
                      )))}
                    >
                      <X size={10} />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
            {error ? <p className="pb-1 text-[11px] text-[#b42318]">{error}</p> : null}
          </div>
        </div>

        <div className="flex min-w-0 items-center gap-space-md">
          <div className="scroll-clean flex min-w-0 flex-1 items-center gap-space-sm overflow-x-auto">
            <button
              type="button"
              onClick={createDraft}
              disabled={!canSend}
              title="按当前规格打开真实 Figma 新文件，并把需求交给 Agent"
              className="flex h-9 shrink-0 items-center gap-space-sm rounded-[8px] border border-[#dfe5e8] bg-white px-space-md text-[12px] font-medium text-[var(--home-accent)] hover:bg-[#f7fbfc] disabled:cursor-default disabled:text-[#b7bdc2]"
            >
              <Sparkles size={14} strokeWidth={1.8} />
              {busy ? '正在上传参考文件…' : '生成设计稿'}
            </button>
            <ModelSwitcher />
            <button
              type="button"
              onClick={() => setSpecIndex((index) => (index + 1) % OUTPUT_SPECS.length)}
              title="点击切换交付规格"
              className="flex h-9 shrink-0 items-center gap-space-sm rounded-[8px] border border-[#e5e8eb] bg-white px-space-md text-[12px] font-medium text-[#30383e] hover:bg-[#f7f8f9]"
            >
              <Monitor size={14} strokeWidth={1.8} />
              {OUTPUT_SPECS[specIndex]}
            </button>
            <button
              type="button"
              onClick={() => setEditable((current) => !current)}
              aria-pressed={editable}
              className="flex h-9 shrink-0 items-center gap-space-sm rounded-[8px] border border-[#e5e8eb] bg-white px-space-md text-[12px] font-medium text-[#30383e] hover:bg-[#f7f8f9]"
            >
              <Layers3 size={14} strokeWidth={1.8} />
              {editable ? '可编辑图层' : '导出图片'}
            </button>
            <button
              type="button"
              aria-label="添加上下文"
              onClick={() => fileInputRef.current?.click()}
              title="添加参考图、文案或规格文件"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] border border-[#e5e8eb] bg-white text-[#30383e] hover:bg-[#f7f8f9]"
            >
              <AtSign size={15} />
            </button>
          </div>
          <button
            type="button"
            aria-label="发送并创建可编辑视觉稿"
            disabled={!canSend}
            onClick={createDraft}
            className={[
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-all',
              canSend
                ? 'bg-[var(--home-accent)] text-white shadow-[0_6px_16px_rgba(0,161,194,0.24)] hover:-translate-y-0.5'
                : 'cursor-default bg-[#e4e7e9] text-[#b7bdc2]',
            ].join(' ')}
          >
            <ArrowUp size={18} strokeWidth={2.2} />
          </button>
        </div>
      </div>
    </section>
  )
}
