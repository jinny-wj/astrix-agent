import { useEffect, useRef, useState, type FormEvent } from 'react'
import { readSelectedModel } from '../config/models'
import {
  clearModelApiSettings,
  getModelApiSettings,
  hasDesktopModelApiSettings,
  saveModelApiSettings,
  testModelApiSettings,
} from '../services/modelApi'
import type { ModelApiDraft, ModelApiProvider, ModelApiPublicSettings } from '../types/modelApi'

const EMPTY_SETTINGS: ModelApiPublicSettings = {
  provider: 'openai', baseUrl: '', model: '', enabled: false, hasApiKey: false, configured: false,
}

const providerRoots: Record<ModelApiProvider, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
}

function origin(value: string): string | null {
  try { return new URL(value.trim()).origin } catch { return null }
}

const inputClass = 'mt-1.5 w-full rounded-[10px] border border-[#e2e6ed] bg-white px-3 py-2 text-[13px] text-[#2a2f38] outline-none focus:border-[#2164ed] disabled:bg-[#f6f7f9] disabled:text-[#8a93a2]'
const secondaryButtonClass = 'rounded-[9px] border border-[#dfe5ee] bg-white px-3 py-2 text-[12.5px] font-medium text-[#3c4656] hover:bg-[#f7f8fa] disabled:cursor-not-allowed disabled:opacity-50'

function validBaseUrl(value: string): boolean {
  try {
    const input = value.trim()
    const url = new URL(input)
    return ['https:', 'http:'].includes(url.protocol)
      && Boolean(url.hostname) && !url.username && !url.password && !url.hash && !/\p{Cc}/u.test(input)
  } catch {
    return false
  }
}

export function ModelApiSettings() {
  const desktopAvailable = hasDesktopModelApiSettings()
  const [settings, setSettings] = useState(EMPTY_SETTINGS)
  const [provider, setProvider] = useState<ModelApiProvider>('openai')
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [enabled, setEnabled] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [pending, setPending] = useState<'load' | 'save' | 'test' | 'clear' | null>(desktopAvailable ? 'load' : null)
  const [feedback, setFeedback] = useState<{ text: string; error: boolean } | null>(null)
  const [tested, setTested] = useState(false)
  const busyRef = useRef(desktopAvailable)
  const mountedRef = useRef(false)

  const applySettings = (next: ModelApiPublicSettings) => {
    setSettings(next)
    setProvider(next.provider ?? 'openai')
    setBaseUrl(next.baseUrl)
    setModel(next.model)
    setEnabled(next.enabled)
    setApiKey('')
  }

  useEffect(() => {
    mountedRef.current = true
    let cancelled = false
    if (desktopAvailable) {
      void getModelApiSettings().then((next) => {
        if (cancelled) return
        applySettings(next)
        setLoaded(true)
      }).catch(() => {
        if (!cancelled) setFeedback({ text: '无法读取 API 配置，请关闭设置后重试，或清除配置后重新填写。', error: true })
      }).finally(() => {
        if (!cancelled) {
          busyRef.current = false
          setPending(null)
        }
      })
    }
    return () => {
      cancelled = true
      mountedRef.current = false
    }
  }, [desktopAvailable])

  const complete = validBaseUrl(baseUrl) && Boolean(model.trim())
  const retainSavedKey = settings.hasApiKey && provider === (settings.provider ?? 'openai') && origin(baseUrl) === origin(settings.baseUrl)
  const disabled = !desktopAvailable || !loaded || pending !== null
  const clearDisabled = !desktopAvailable || pending !== null

  const changed = () => {
    setFeedback(null)
    setTested(false)
  }

  const draft = (): ModelApiDraft => ({
    provider,
    baseUrl: baseUrl.trim(),
    model,
    enabled,
    ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
  })

  const run = async (action: 'save' | 'test' | 'clear') => {
    if ((action === 'clear' ? clearDisabled : disabled) || busyRef.current) return
    if (action === 'save' && baseUrl.trim() && !validBaseUrl(baseUrl)) {
      setFeedback({ text: '服务地址格式无效。请使用完整 HTTP/HTTPS 地址，不附带网址账号或片段；支持合法查询参数。', error: true })
      return
    }
    if ((action === 'test' || (action === 'save' && enabled)) && !complete) return
    busyRef.current = true
    setPending(action)
    setFeedback(null)
    setTested(false)
    try {
      if (action === 'test') {
        const result = await testModelApiSettings(draft())
        if (!mountedRef.current) return
        setTested(result.ok)
        setFeedback({ text: result.message || (result.ok ? '连接测试成功。' : '连接测试失败，请检查配置。'), error: !result.ok })
      } else {
        const next = action === 'save'
          ? await saveModelApiSettings(draft())
          : await clearModelApiSettings()
        if (!mountedRef.current) return
        applySettings(next)
        setLoaded(true)
        setFeedback({
          text: action === 'clear'
            ? '配置已清除，Auto 将沿用本机 Agent。'
            : next.enabled
              ? `配置已保存并启用。模型选 Auto、服务器选自动选择时使用此配置。连接尚未测试。${readSelectedModel().id !== 'auto' ? '请将模型切换为 Auto 以使用此配置。' : ''}`
              : '配置草稿已保存；稍后可继续填写并启用。保存不会测试连接。',
          error: false,
        })
      }
    } catch {
      if (!mountedRef.current) return
      setFeedback({
        text: action === 'test'
          ? '连接测试失败，请检查服务地址、API Key 和模型 ID 后重试。'
          : action === 'clear'
            ? '清除配置失败，请重试。'
            : '保存配置失败，请检查填写内容后重试。',
        error: true,
      })
    } finally {
      busyRef.current = false
      if (mountedRef.current) setPending(null)
    }
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void run('save')
  }

  return (
    <section className="mt-5 rounded-[14px] border border-[#e2e8f2] bg-[#f8faff] p-4" aria-labelledby="model-api-heading" aria-busy={pending !== null}>
      <div className="flex items-center justify-between gap-3">
        <h3 id="model-api-heading" className="text-[14px] font-semibold text-[#2a2f38]">AI 模型 API</h3>
        {loaded ? (
          <span className="rounded-full bg-white px-2 py-0.5 text-[11px] text-[#6b7382]">
            {settings.enabled ? '已启用' : settings.configured ? '已保存 · 未启用' : '待配置'}
          </span>
        ) : null}
      </div>
      <p className="mt-1.5 text-[12px] leading-5 text-[#6b7382]">
        支持 OpenAI 兼容接口、Claude 原生 Messages 与 Gemini 原生 GenerateContent，可连接官方、第三方或本机服务。
        启用后，Auto 使用此 API 和模型；手动选定的 Agent 优先。未启用时，Auto 沿用本机 Agent。
        此入口用于文字对话；图像生成等功能仍使用对应工作流。
      </p>
      {!desktopAvailable ? (
        <p className="mt-3 text-[12px] leading-5 text-[#916319]" role="status">请在 Astrix 客户端中配置。</p>
      ) : (
        <form onSubmit={submit} className="mt-3">
          <fieldset disabled={disabled} className="min-w-0 space-y-3">
            <div>
              <label className="block text-[12.5px] font-medium text-[#3e4653]" htmlFor="model-api-provider">API 协议</label>
              <select id="model-api-provider" value={provider} className={inputClass} onChange={(event) => {
                const next = event.target.value as ModelApiProvider
                if (!baseUrl.trim() || Object.values(providerRoots).includes(baseUrl.trim().replace(/\/+$/, ''))) setBaseUrl(providerRoots[next])
                setProvider(next)
                setApiKey('')
                changed()
              }}>
                <option value="openai">OpenAI 兼容</option>
                <option value="anthropic">Claude 原生 Messages</option>
                <option value="gemini">Gemini 原生 GenerateContent</option>
              </select>
            </div>
            <div>
              <label className="block text-[12.5px] font-medium text-[#3e4653]" htmlFor="model-api-base-url">服务地址 Base URL</label>
              <input
                id="model-api-base-url"
                type="text"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                maxLength={2048}
                value={baseUrl}
                onChange={(event) => { setBaseUrl(event.target.value); changed() }}
                placeholder={providerRoots[provider]}
                aria-describedby="model-api-base-url-help"
                className={inputClass}
              />
              <p id="model-api-base-url-help" className="mt-1 text-[11.5px] leading-5 text-[#7d8695]">填写对应协议的根地址或完整接口地址，第三方代理请使用其提供的地址；模型 ID 单独填写。</p>
            </div>
            <div>
              <label className="block text-[12.5px] font-medium text-[#3e4653]" htmlFor="model-api-key">API Key</label>
              <input
                id="model-api-key"
                type="password"
                autoComplete="off"
                spellCheck={false}
                maxLength={8192}
                value={apiKey}
                onChange={(event) => { setApiKey(event.target.value); changed() }}
                placeholder={retainSavedKey ? '已保存，留空保留' : '免密服务可留空'}
                aria-describedby="model-api-key-help"
                className={inputClass}
              />
              <p id="model-api-key-help" className="mt-1 text-[11.5px] leading-5 text-[#7d8695]">
                {retainSavedKey ? '已有 API Key 不会显示；同一协议和来源留空保留。如需移除，请清除配置。' : settings.hasApiKey ? '协议或来源已改变，原 API Key 不会沿用。请填写对应服务的 Key；免密服务可留空。' : 'API Key 由客户端保存，不会显示原值；免密服务可留空。'}
              </p>
            </div>
            <div>
              <label className="block text-[12.5px] font-medium text-[#3e4653]" htmlFor="model-api-model">模型 ID</label>
              <input
                id="model-api-model"
                type="text"
                autoComplete="off"
                spellCheck={false}
                maxLength={512}
                value={model}
                onChange={(event) => { setModel(event.target.value); changed() }}
                placeholder="填写服务商提供的完整模型 ID"
                aria-describedby="model-api-model-help"
                className={inputClass}
              />
              <p id="model-api-model-help" className="mt-1 text-[11.5px] leading-5 text-[#7d8695]">按原样保存，请与服务商的模型 ID 完全一致。</p>
            </div>
            <label className="flex cursor-pointer items-start gap-2 text-[12.5px] leading-5 text-[#3e4653]" htmlFor="model-api-enabled">
              <input
                id="model-api-enabled"
                type="checkbox"
                checked={enabled}
                className="mt-1 accent-[#2164ed]"
                aria-describedby="model-api-enable-help"
                onChange={(event) => {
                  changed()
                  if (event.target.checked && !complete) {
                    setFeedback({ text: '启用前请补全有效的服务地址和模型 ID。可以先保存草稿。', error: true })
                    return
                  }
                  setEnabled(event.target.checked)
                }}
              />
              启用自定义 API 和模型
            </label>
            <p id="model-api-enable-help" className="text-[11.5px] leading-5 text-[#7d8695]">
              {enabled && !complete ? '配置尚未完整，请补全后保存，或先取消启用。' : '未启用时可以保存空白或部分配置。保存不会发送模型请求。'}
            </p>
          </fieldset>
          <p className="mt-3 text-[11.5px] leading-5 text-[#7d8695]">测试连接会向所填服务发送少量请求，可能产生少量费用；测试不会保存修改。</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="submit" disabled={disabled || (enabled && !complete)} className="rounded-[9px] bg-[#2164ed] px-3.5 py-2 text-[12.5px] font-medium text-white hover:bg-[#1858d7] disabled:cursor-not-allowed disabled:opacity-50">
              {pending === 'save' ? '保存中…' : '保存配置'}
            </button>
            <button type="button" onClick={() => void run('test')} disabled={disabled || !complete} className={secondaryButtonClass}>
              {pending === 'test' ? '测试中…' : '测试连接'}
            </button>
            <button type="button" onClick={() => void run('clear')} disabled={clearDisabled} className={secondaryButtonClass}>
              {pending === 'clear' ? '清除中…' : '清除配置'}
            </button>
          </div>
        </form>
      )}
      {pending === 'load' ? <p className="mt-3 text-[12px] text-[#7d8695]" role="status">正在读取配置…</p> : null}
      {feedback ? (
        <p className={`mt-3 text-[12px] leading-5 ${feedback.error ? 'text-[#b54725]' : tested ? 'text-[#16845b]' : 'text-[#53657d]'}`} role={feedback.error ? 'alert' : 'status'}>
          {feedback.text}
        </p>
      ) : null}
    </section>
  )
}
