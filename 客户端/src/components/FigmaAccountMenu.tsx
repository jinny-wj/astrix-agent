import {
  Check,
  ChevronDown,
  LoaderCircle,
  LogOut,
  RefreshCw,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import {
  consumeFigmaAuthResult,
  disconnectFigma,
  FIGMA_AUTH_RESULT_MESSAGES,
  getFigmaAuthSession,
  onFigmaAuthSessionChange,
  startFigmaOAuth,
  type FigmaAuthSession,
} from '../services/figmaAuth'

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; session: FigmaAuthSession }
  | { status: 'error'; message: string }

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

export default function FigmaAccountMenu({ openRequest = 0 }: { openRequest?: number }) {
  const [loadState, setLoadState] = useState<LoadState>({ status: 'loading' })
  const [menuOpen, setMenuOpen] = useState(false)
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
    else startFigmaOAuth()
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
    const stopObservingSession = onFigmaAuthSessionChange(() => { void loadSession() })
    const onAuthResult = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.data?.type !== 'design-studio:figma-auth') return
      setAuthMessage(event.data.result === 'connected' ? '' : FIGMA_AUTH_RESULT_MESSAGES[event.data.result] ?? 'Figma 授权没有完成。')
    }
    window.addEventListener('message', onAuthResult)
    return () => {
      stopObservingSession()
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
    startFigmaOAuth(undefined, true)
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
            onClick={() => startFigmaOAuth()}
            className={`flex h-9 items-center gap-2 rounded-[11px] border bg-white/88 px-3 text-[12px] font-medium shadow-sm transition ${
              authMessage
                ? 'border-[#f0d9d9] text-[#b85f5f] hover:bg-white'
                : 'border-[#dfe5ee] text-[#3c4656] hover:border-[#c7d6f4] hover:bg-white'
            }`}
          >
            <FigmaMark />
            {authMessage ? '重新连接 Figma' : '连接 Figma'}
          </button>
          {authMessage ? (
            <span className="max-w-[220px] truncate text-[11px] text-[#b85f5f]">
              {authMessage}
            </span>
          ) : null}
        </div>
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
            className="mt-2 flex w-full items-center justify-start gap-2 rounded-[10px] px-3 py-2.5 text-[12px] font-medium text-[#3c4656] hover:bg-[#f4f6fa]"
          >
            <RefreshCw size={14} />
            切换账号
          </button>
          <button
            type="button"
            disabled={disconnecting}
            onClick={() => void disconnect()}
            className="flex w-full items-center justify-start gap-2 rounded-[10px] px-3 py-2.5 text-[12px] font-medium text-[#d05f5f] hover:bg-[#fff5f5] disabled:opacity-50"
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
