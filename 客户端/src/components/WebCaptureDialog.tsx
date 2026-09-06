import { Link2, X } from 'lucide-react'
import { useState } from 'react'
import { openFigmaInBrowser, openNewFigmaDesign } from '../config/figma'
import type { AgentAttachment } from '../types/agentComposer'

function parseWebUrl(value: string) {
  const input = value.trim()
  if (!input) throw new Error('请粘贴要捕获的网页链接。')
  const withProtocol = /^https?:\/\//i.test(input) ? input : `https://${input}`
  let url: URL
  try {
    url = new URL(withProtocol)
  } catch {
    throw new Error('链接格式无效。')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('只支持 http / https 网页。')
  }
  return url.toString()
}

export async function captureWebpageAsFigmaDraft(pageUrl: string) {
  const response = await fetch('/api/web-capture', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: pageUrl }),
  })
  const payload = await response.json() as {
    error?: string
    prompt?: string
    image?: AgentAttachment | null
  }
  if (!response.ok || !payload.prompt) {
    throw new Error(payload.error || '网页捕获失败')
  }
  const launched = openNewFigmaDesign({
    skill: 'visual-draft-generation',
    prompt: payload.prompt,
    attachments: payload.image ? [payload.image] : undefined,
  })
  if (launched.surface === 'figma-tab') void openFigmaInBrowser(launched.url)
  return launched
}

export default function WebCaptureDialog({
  onClose,
}: {
  onClose: () => void
}) {
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = () => {
    if (busy) return
    void (async () => {
      setBusy(true)
      setError('')
      try {
        const url = parseWebUrl(value)
        await captureWebpageAsFigmaDraft(url)
        onClose()
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : '无法捕获该网页')
      } finally {
        setBusy(false)
      }
    })()
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#111827]/30 px-5 backdrop-blur-[2px]">
      <section className="w-full max-w-[420px] rounded-[18px] border border-white/80 bg-white p-5 shadow-[0_26px_90px_rgba(27,39,67,0.22)]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[16px] font-semibold text-[#20242d]">网页捕获</h2>
            <p className="mt-1 text-[12.5px] leading-5 text-[#7d8695]">
              读取页面的标题、摘要和 og 图，交给真实 Figma 新文件和右侧 Agent。这不是整页截图，也不会还原 DOM 结构。
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭网页捕获" className="rounded-full p-1.5 text-[#8c93a0] hover:bg-[#f2f4f8]">
            <X size={16} />
          </button>
        </div>
        <label className="mt-4 block text-[12px] font-medium text-[#3e4653]" htmlFor="web-capture-url">
          网页链接
        </label>
        <input
          id="web-capture-url"
          value={value}
          onChange={(event) => {
            setValue(event.target.value)
            setError('')
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit()
          }}
          placeholder="https://example.com"
          className="mt-2 w-full rounded-[10px] border border-[#e2e6ed] px-3 py-2 text-[13px] outline-none focus:border-[#2164ed]"
        />
        {error ? <p className="mt-2 text-[12px] text-[#b42318]">{error}</p> : null}
        <button
          type="button"
          disabled={busy}
          onClick={submit}
          className="mt-4 inline-flex items-center gap-2 rounded-[9px] bg-[#2164ed] px-3.5 py-2 text-[12.5px] font-medium text-white hover:bg-[#1858d7] disabled:opacity-60"
        >
          <Link2 size={14} />
          {busy ? '正在读取网页…' : '打开 Figma 并交给 Agent'}
        </button>
      </section>
    </div>
  )
}
