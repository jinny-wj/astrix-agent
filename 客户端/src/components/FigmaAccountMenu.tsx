import {
  Check,
  ChevronDown,
  ExternalLink,
  LoaderCircle,
  LogOut,
  RefreshCw,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import {
  consumeFigmaAuthResult,
  disconnectFigma,
  FIGMA_AUTH_RESULT_MESSAGES,
  getFigmaAuthSession,
  startFigmaOAuth,
  type FigmaAuthSession,
} from '../services/figmaAuth'

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; session: FigmaAuthSession }
  | { status: 'error'; message: string }

const FIGMA_APPS_URL = 'https://www.figma.com/developers/apps'
const CALLBACK_URL =
  'http://127.0.0.1:5273/api/auth/figma/callback'

function FigmaMark() {
  return (
    <svg viewBox="0 0 12 18" className="h-[15px] w-[10px]" aria-hidden="true">
      <path d="M3 0h3v6H3a3 3 0 0 1 0-6z" fill="#f24e1e" />
      <path d="M6 0h3a3 3 0 0 1 0 6H6V0z" fill="#ff7262" />
      <path d="M6 6h3a3 3 0 0 1 0 6H6V6z" fill="#1abcfe" />
      <path d="M3 6h3v6H3a3 3 0 0 1 0-6z" fill="#a259ff" />
      <path d="M3 12h3v3a3 3 0 1 1-3-3z" fill="#0acf83" />
    </svg>
  )
}

function OAuthSetupDialog({ onClose }: { onClose: () => void }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="figma-oauth-title"
      className="fixed inset-0 z-50 grid place-items-center bg-[#111827]/25 px-5 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose()
      }}
    >
      <div className="w-full max-w-[520px] rounded-[20px] border border-white/80 bg-white p-6 shadow-[0_26px_90px_rgba(27,39,67,0.2)]">
        <div className="flex items-start justify-between gap-5">
          <div>
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-[12px] bg-[#f3f5f9]">
              <FigmaMark />
            </div>
            <h2
              id="figma-oauth-title"
              className="text-[19px] font-semibold tracking-[-0.02em] text-[#20242d]"
            >
              配置 Figma OAuth
            </h2>
            <p className="mt-2 text-[13px] leading-6 text-[#778092]">
              授权页会像你截图里一样在浏览器顶层打开。Client Secret
              只保存在本机服务端，不会进入前端构建。
            </p>
          </div>
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            className="rounded-full p-1.5 text-[#8c93a0] hover:bg-[#f2f4f8] hover:text-[#353a45]"
          >
            <X size={18} />
          </button>
        </div>

        <ol className="mt-5 space-y-3">
          {[
            <>
              在 Figma Developer Apps 新建一个 OAuth App，选择
              <span className="font-medium text-[#313641]"> 私有应用 </span>
              即可先在团队内测试。
            </>,
            <>
              添加回调地址：
              <code className="ml-1 break-all rounded bg-[#f3f5f8] px-1.5 py-1 text-[11px] text-[#3f4653]">
                {CALLBACK_URL}
              </code>
            </>,
            <>
              将 Client ID / Secret 写入当前应用目录的
              <code className="mx-1 rounded bg-[#f3f5f8] px-1.5 py-1 text-[11px] text-[#3f4653]">
                .env.local
              </code>
              ，格式见
              <code className="ml-1 rounded bg-[#f3f5f8] px-1.5 py-1 text-[11px] text-[#3f4653]">
                .env.example
              </code>
              。改完后必须重启开发服务。
            </>,
          ].map((content, index) => (
            <li
              key={index}
              className="flex gap-3 rounded-[12px] border border-[#e8ebf1] bg-[#fbfcfe] p-3.5 text-[12.5px] leading-6 text-[#5c6575]"
            >
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#eaf2ff] text-[11px] font-semibold text-[#2c6bed]">
                {index + 1}
              </span>
              <span>{content}</span>
            </li>
          ))}
        </ol>

        <div className="mt-5 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-[10px] border border-[#e2e6ed] px-4 py-2.5 text-[13px] font-medium text-[#596273] hover:bg-[#f7f8fa]"
          >
            稍后配置
          </button>
          <a
            href={FIGMA_APPS_URL}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 rounded-[10px] bg-[#2164ed] px-4 py-2.5 text-[13px] font-medium text-white hover:bg-[#1858d7]"
          >
            打开 Figma Apps
            <ExternalLink size={14} />
          </a>
        </div>
      </div>
    </div>
  )
}

export default function FigmaAccountMenu({ openRequest = 0 }: { openRequest?: number }) {
  const [loadState, setLoadState] = useState<LoadState>({ status: 'loading' })
  const [menuOpen, setMenuOpen] = useState(false)
  const [setupOpen, setSetupOpen] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [authMessage, setAuthMessage] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const handledOpenRequest = useRef(0)
  useEffect(() => {
    if (!openRequest) setMenuOpen(false)
  }, [openRequest])

  useEffect(() => {
    if (loadState.status !== 'ready') return
    const user = loadState.session.authenticated ? loadState.session.user : null
    const host = window.designStudioHost ?? window.designStudioAgentHost
    host?.updateProfile?.(user ? { name: user.name, avatarUrl: user.avatarUrl } : null)
  }, [loadState])

  useEffect(() => {
    if (!openRequest || handledOpenRequest.current === openRequest || loadState.status !== 'ready') return
    handledOpenRequest.current = openRequest
    if (loadState.session.authenticated) setMenuOpen(true)
    else if (loadState.session.configured) startFigmaOAuth()
    else setSetupOpen(true)
  }, [openRequest, loadState])

  const loadSession = async () => {
    try {
      const session = await getFigmaAuthSession()
      setLoadState({ status: 'ready', session })
    } catch (error) {
      setLoadState({
        status: 'error',
        message: error instanceof Error ? error.message : '读取授权状态失败',
      })
    }
  }

  useEffect(() => {
    const result = consumeFigmaAuthResult()
    if (result && window.opener && window.name === 'design-studio-figma-auth') {
      window.opener.postMessage({ type: 'design-studio:figma-auth', result }, window.location.origin)
      window.close()
    }
    if (result && result !== 'connected') {
      setAuthMessage(FIGMA_AUTH_RESULT_MESSAGES[result] ?? 'Figma 授权没有完成。')
    }
    void loadSession()
    const onFocus = () => { void loadSession() }
    const onAuthResult = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.data?.type !== 'design-studio:figma-auth') return
      setAuthMessage(event.data.result === 'connected' ? '' : FIGMA_AUTH_RESULT_MESSAGES[event.data.result] ?? 'Figma 授权没有完成。')
      void loadSession()
    }
    window.addEventListener('focus', onFocus)
    window.addEventListener('message', onAuthResult)
    return () => {
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('message', onAuthResult)
    }
  }, [])

  useEffect(() => {
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', closeOnOutsideClick)
    return () => document.removeEventListener('mousedown', closeOnOutsideClick)
  }, [])

  const disconnect = async () => {
    setDisconnecting(true)
    try {
      await disconnectFigma()
      await window.designStudioHost?.clearFigmaWebSession?.()
      setMenuOpen(false)
      await loadSession()
    } finally {
      setDisconnecting(false)
    }
  }

  const switchAccount = async () => {
    setMenuOpen(false)
    await window.designStudioHost?.clearFigmaWebSession?.()
    startFigmaOAuth()
  }

  if (loadState.status === 'loading') {
    return (
      <div className="flex h-9 items-center gap-2 rounded-[11px] border border-[#e5e8ee] bg-white/85 px-3 text-[12px] text-[#838b99]">
        <LoaderCircle size={13} className="animate-spin" />
        Figma
      </div>
    )
  }

  if (loadState.status === 'error') {
    return (
      <button
        type="button"
        title={loadState.message}
        onClick={() => void loadSession()}
        className="flex h-9 items-center gap-2 rounded-[11px] border border-[#f0d9d9] bg-white/85 px-3 text-[12px] text-[#b85f5f]"
      >
        <FigmaMark />
        重试连接
      </button>
    )
  }

  const { session } = loadState
  if (!session.authenticated || !session.user) {
    return (
      <>
        <div className="flex items-center gap-2">
          <button
            type="button"
            title={authMessage || undefined}
            onClick={() => {
              if (session.configured) startFigmaOAuth()
              else setSetupOpen(true)
            }}
            className={`flex h-9 items-center gap-2 rounded-[11px] border bg-white/88 px-3 text-[12px] font-medium shadow-sm transition ${
              authMessage
                ? 'border-[#f0d9d9] text-[#b85f5f] hover:bg-white'
                : 'border-[#dfe5ee] text-[#3c4656] hover:border-[#c7d6f4] hover:bg-white'
            }`}
          >
            <FigmaMark />
            {session.configured
              ? authMessage
                ? '重新连接 Figma'
                : '连接 Figma'
              : '配置 Figma OAuth'}
          </button>
          {authMessage ? (
            <span className="max-w-[220px] truncate text-[11px] text-[#b85f5f]">
              {authMessage}
            </span>
          ) : null}
        </div>
        {setupOpen && <OAuthSetupDialog onClose={() => setSetupOpen(false)} />}
      </>
    )
  }

  const { user } = session
  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setMenuOpen((open) => !open)}
        className="flex h-9 max-w-[240px] items-center gap-2 rounded-[11px] border border-[#e0e5ed] bg-white/90 px-2.5 text-left shadow-sm transition hover:bg-white"
      >
        {user.avatarUrl ? (
          <img
            src={user.avatarUrl}
            alt=""
            className="h-6 w-6 shrink-0 rounded-full object-cover"
          />
        ) : (
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#20242d] text-[9px] font-semibold text-white">
            {user.name.slice(0, 2).toUpperCase()}
          </span>
        )}
        <span className="min-w-0 truncate text-[12px] font-medium text-[#313641]">
          {user.email || user.name}
        </span>
        <ChevronDown size={13} className="shrink-0 text-[#8c94a2]" />
      </button>

      {menuOpen && (
        <div className="absolute right-0 top-[44px] z-40 w-[310px] rounded-[15px] border border-[#e1e5ec] bg-white p-3.5 shadow-[0_18px_55px_rgba(37,48,72,0.18)]">
          <div className="flex items-center justify-between text-[12px] text-[#8992a0]">
            <span>已授权 Figma 账号</span>
            <span className="flex items-center gap-1 text-[#36a269]">
              <Check size={12} />
              已连接
            </span>
          </div>
          <div className="mt-3 flex items-center gap-3 rounded-[11px] bg-[#f7f9fc] p-3">
            {user.avatarUrl ? (
              <img
                src={user.avatarUrl}
                alt=""
                className="h-9 w-9 rounded-full object-cover"
              />
            ) : (
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#20242d] text-[11px] font-semibold text-white">
                {user.name.slice(0, 2).toUpperCase()}
              </span>
            )}
            <div className="min-w-0">
              <div className="truncate text-[13px] font-semibold text-[#2a2f38]">
                {user.name}
              </div>
              <div className="mt-0.5 truncate text-[11px] text-[#87909f]">
                {user.email || '已授权账号'}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={switchAccount}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-[10px] px-3 py-2.5 text-[12px] font-medium text-[#3c4656] hover:bg-[#f4f6fa]"
          >
            <RefreshCw size={14} />
            切换账号
          </button>
          <button
            type="button"
            disabled={disconnecting}
            onClick={() => void disconnect()}
            className="flex w-full items-center justify-center gap-2 rounded-[10px] px-3 py-2.5 text-[12px] font-medium text-[#d05f5f] hover:bg-[#fff5f5] disabled:opacity-50"
          >
            {disconnecting ? (
              <LoaderCircle size={14} className="animate-spin" />
            ) : (
              <LogOut size={14} />
            )}
            解绑
          </button>
        </div>
      )}
    </div>
  )
}
