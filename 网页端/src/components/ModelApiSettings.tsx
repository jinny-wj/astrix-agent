import { useEffect, useRef, useState } from 'react'
import { getAgentStatus } from '../services/agentApi'
import { AGENT_BACKEND_CHANGED, readPreferredBackend, writePreferredBackend } from '../services/agentComposer'

export function ModelApiSettings() {
  const [selected, setSelected] = useState(() => readPreferredBackend() === 'codex')
  const [status, setStatus] = useState('正在检测本机 Codex…')
  const [busy, setBusy] = useState(false)
  const mounted = useRef(false)

  const check = async () => {
    setBusy(true)
    try {
      const value = await getAgentStatus()
      if (mounted.current) setStatus(value.servers.find(server => server.id === 'codex')?.detail ?? '未检测到可用的本机 Codex。')
    } catch {
      if (mounted.current) setStatus('无法读取本机 Codex 状态，请检查本地服务后重试。')
    } finally { if (mounted.current) setBusy(false) }
  }

  useEffect(() => {
    mounted.current = true
    const sync = () => setSelected(readPreferredBackend() === 'codex')
    window.addEventListener(AGENT_BACKEND_CHANGED, sync)
    void check()
    return () => { mounted.current = false; window.removeEventListener(AGENT_BACKEND_CHANGED, sync) }
  }, [])

  return (
    <section className="mt-5 rounded-[14px] border border-[#e2e8f2] bg-[#f8faff] p-4" aria-labelledby="model-connection-heading">
      <h3 id="model-connection-heading" className="text-[14px] font-semibold text-[#2a2f38]">AI 连接</h3>
      <div className="mt-3 rounded-[10px] border border-[#dfe5ee] bg-white p-3">
        <div className="flex items-center justify-between gap-3">
          <strong className="text-[13px] text-[#39425a]">本机 Codex · ChatGPT 登录额度</strong>
          {selected && <span className="text-[11px] text-[#7772aa]">当前设计助手</span>}
        </div>
        <p className="mt-2 text-[12px] leading-5 text-[#69758a]" role="status">{busy ? '正在检测本机登录…' : status}</p>
        <p className="mt-1 text-[12px] leading-5 text-[#7c8495]">使用运行此本地服务的电脑上已登录的 Codex，无需 API Key。未登录时在终端运行 <code>codex login</code> 并选择 ChatGPT 登录。</p>
        <p className="mt-1 text-[11.5px] leading-5 text-[#8a92a1]">检测不调用模型；对话使用本机 Codex 默认模型并消耗该账号额度，不自动切换 API。</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" aria-pressed={selected} onClick={() => { writePreferredBackend('codex'); setSelected(true) }} className="rounded-[8px] bg-[#6765d8] px-3 py-2 text-[12px] font-medium text-white">使用本机 Codex</button>
          <button type="button" disabled={busy} onClick={() => void check()} className="rounded-[8px] border border-[#dfe5ee] px-3 py-2 text-[12px] text-[#657089] disabled:opacity-50">重新检测登录</button>
        </div>
      </div>
      <div className="mt-2 rounded-[10px] border border-[#dfe5ee] bg-white p-3">
        <strong className="text-[13px] text-[#39425a]">自定义 API · 工作台</strong>
        <p className="mt-1.5 text-[12px] leading-5 text-[#7c8495]">在工作台配置并使用 OpenAI 兼容、Claude 或 Gemini 原生接口，支持官方、第三方与本机服务。此按钮进入工作台，不会把当前设计助手切换为 API。</p>
        <a href="/__local/settings" className="mt-2 inline-block text-[12px] font-medium text-[#6765d8]">进入工作台配置并使用 API →</a>
      </div>
    </section>
  )
}
