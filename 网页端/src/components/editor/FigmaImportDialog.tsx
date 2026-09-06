import {
  AlertCircle,
  Eye,
  EyeOff,
  KeyRound,
  Link2,
  LogIn,
  LoaderCircle,
  ShieldCheck,
  X,
} from 'lucide-react'
import {
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { queueFigmaImport } from '../../config/workspace'
import {
  getFigmaAuthSession,
  startFigmaOAuth,
} from '../../services/figmaAuth'

export type FigmaImportPayload = {
  url: string
  authMode: 'oauth' | 'token'
  token?: string
}

export type FigmaImportDialogProps = {
  open: boolean
  onClose: () => void
  onImport: (input: FigmaImportPayload) => Promise<void>
}

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message
  return '读取 Figma 文件失败，请检查文件权限、链接与访问令牌后重试。'
}

/**
 * 读取 Figma 文件所需凭证的独立对话框。
 * Token 只存在于组件内存中，并会在对话框关闭时清除。
 */
export default function FigmaImportDialog({
  open,
  onClose,
  onImport,
}: FigmaImportDialogProps) {
  const titleId = useId()
  const descriptionId = useId()
  const urlId = useId()
  const tokenId = useId()
  const errorId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const urlInputRef = useRef<HTMLInputElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const loadingRef = useRef(false)
  const onCloseRef = useRef(onClose)

  const [url, setUrl] = useState('')
  const [token, setToken] = useState('')
  const [tokenVisible, setTokenVisible] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [authStatus, setAuthStatus] = useState<
    'loading' | 'connected' | 'disconnected'
  >('loading')

  loadingRef.current = loading
  onCloseRef.current = onClose

  const resetAndClose = () => {
    if (loading) return
    setUrl('')
    setToken('')
    setTokenVisible(false)
    setError('')
    onClose()
  }

  useEffect(() => {
    if (!open) return

    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const focusTimer = window.setTimeout(() => urlInputRef.current?.focus(), 0)
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !loadingRef.current) {
        event.preventDefault()
        setUrl('')
        setToken('')
        setTokenVisible(false)
        setError('')
        onCloseRef.current()
      }
    }
    document.addEventListener('keydown', handleEscape)

    return () => {
      window.clearTimeout(focusTimer)
      document.removeEventListener('keydown', handleEscape)
      document.body.style.overflow = previousOverflow
      previousFocusRef.current?.focus()
    }
  }, [open])

  useEffect(() => {
    if (open) return
    setUrl('')
    setToken('')
    setTokenVisible(false)
    setLoading(false)
    setError('')
  }, [open])

  useEffect(() => {
    if (!open) return
    let active = true
    setAuthStatus('loading')
    void getFigmaAuthSession()
      .then((session) => {
        if (active) {
          setAuthStatus(session.authenticated ? 'connected' : 'disconnected')
        }
      })
      .catch(() => {
        if (active) setAuthStatus('disconnected')
      })
    return () => {
      active = false
    }
  }, [open])

  const handleDialogKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return

    const focusableElements = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? [],
    )
    if (focusableElements.length === 0) {
      event.preventDefault()
      dialogRef.current?.focus()
      return
    }

    const firstElement = focusableElements[0]
    const lastElement = focusableElements[focusableElements.length - 1]
    if (event.shiftKey && document.activeElement === firstElement) {
      event.preventDefault()
      lastElement.focus()
    } else if (!event.shiftKey && document.activeElement === lastElement) {
      event.preventDefault()
      firstElement.focus()
    }
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const normalizedUrl = url.trim()
    const normalizedToken = token.trim()

    if (
      !normalizedUrl
      || (authStatus !== 'connected' && !normalizedToken)
    ) {
      setError(
        authStatus === 'connected'
          ? '请填写 Figma 文件链接或 Key。'
          : '请连接 Figma 账号，或填写个人访问令牌。',
      )
      return
    }

    setLoading(true)
    setError('')
    try {
      await onImport({
        url: normalizedUrl,
        authMode: authStatus === 'connected' ? 'oauth' : 'token',
        token: authStatus === 'connected' ? undefined : normalizedToken,
      })
      setUrl('')
      setToken('')
      setTokenVisible(false)
      onClose()
    } catch (importError) {
      setError(getErrorMessage(importError))
    } finally {
      setLoading(false)
    }
  }

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[#151519]/45 px-4 py-8 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) resetAndClose()
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        onKeyDown={handleDialogKeyDown}
        className="w-full max-w-[480px] overflow-hidden rounded-[18px] border border-white/70 bg-white shadow-[0_24px_80px_rgba(18,18,24,0.22)] outline-none"
      >
        <div className="flex items-start gap-4 border-b border-hairline px-6 pb-5 pt-6">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] bg-[#f4f4f6]">
            <svg
              aria-hidden="true"
              viewBox="0 0 12 18"
              className="h-[24px] w-[16px]"
            >
              <path d="M3 0h3v6H3a3 3 0 0 1 0-6z" fill="#f24e1e" />
              <path d="M6 0h3a3 3 0 0 1 0 6H6V0z" fill="#ff7262" />
              <path d="M6 6h3a3 3 0 0 1 0 6H6V6z" fill="#1abcfe" />
              <path d="M3 6h3v6H3a3 3 0 0 1 0-6z" fill="#a259ff" />
              <path d="M3 12h3v3a3 3 0 1 1-3-3z" fill="#0acf83" />
            </svg>
          </div>

          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-[18px] font-semibold tracking-[-0.01em] text-ink">
              读取 Figma 文件
            </h2>
            <p id={descriptionId} className="mt-1 text-[13px] leading-5 text-[#73737a]">
              输入文件链接或 Key，通过 Figma API 将页面和图层读取到本地编辑器。
            </p>
          </div>

          <button
            type="button"
            onClick={resetAndClose}
            disabled={loading}
            aria-label="关闭读取 Figma 文件对话框"
            className="-mr-1 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] text-[#8a8a91] transition-colors hover:bg-[#f4f4f6] hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
          >
            <X size={17} strokeWidth={1.9} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 pb-6 pt-5">
          <div>
            <label htmlFor={urlId} className="text-[13px] font-medium text-[#343439]">
              Figma 文件链接或 Key
            </label>
            <div className="relative mt-2">
              <Link2
                aria-hidden="true"
                size={16}
                strokeWidth={1.8}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#96969d]"
              />
              <input
                ref={urlInputRef}
                id={urlId}
                type="text"
                value={url}
                onChange={(event) => {
                  setUrl(event.target.value)
                  if (error) setError('')
                }}
                disabled={loading}
                autoComplete="off"
                spellCheck={false}
                placeholder="https://www.figma.com/design/… 或文件 Key"
                className="h-11 w-full rounded-[10px] border border-[#dedee2] bg-white pl-10 pr-3 text-[13px] text-ink outline-none transition focus:border-[#0d99ff] focus:ring-2 focus:ring-[#0d99ff]/15 disabled:bg-[#f7f7f8]"
              />
            </div>
          </div>

          {authStatus === 'connected' ? (
            <div className="mt-4 flex items-start gap-2 rounded-[9px] bg-[#f2faf5] px-3 py-3 text-[12px] leading-[18px] text-[#39704d]">
              <ShieldCheck
                aria-hidden="true"
                size={16}
                strokeWidth={1.9}
                className="mt-[1px] shrink-0 text-[#32a260]"
              />
              <span>
                已连接 Figma 账号。文件将通过服务端 OAuth 会话读取，访问令牌不会进入浏览器。
              </span>
            </div>
          ) : authStatus === 'loading' ? (
            <div className="mt-4 flex items-center gap-2 rounded-[9px] bg-[#f7f8fa] px-3 py-3 text-[12px] text-[#6d7480]">
              <LoaderCircle size={15} className="animate-spin" />
              正在检查 Figma 授权状态…
            </div>
          ) : (
            <>
              <div className="mt-4 flex items-center justify-between gap-3">
                <label htmlFor={tokenId} className="text-[13px] font-medium text-[#343439]">
                  个人访问令牌
                </label>
                <button
                  type="button"
                  onClick={() => {
                    const normalizedUrl = url.trim()
                    if (!normalizedUrl) {
                      setError('请先填写 Figma 文件链接或 Key，授权回来后会自动继续读取。')
                      urlInputRef.current?.focus()
                      return
                    }
                    queueFigmaImport({ url: normalizedUrl })
                    startFigmaOAuth('/editor')
                  }}
                  className="flex items-center gap-1.5 text-[12px] font-medium text-[#2164ed] hover:text-[#164fc4]"
                >
                  <LogIn size={13} />
                  连接 Figma 账号
                </button>
              </div>
              <div className="relative mt-2">
                <KeyRound
                  aria-hidden="true"
                  size={16}
                  strokeWidth={1.8}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#96969d]"
                />
                <input
                  id={tokenId}
                  type={tokenVisible ? 'text' : 'password'}
                  value={token}
                  onChange={(event) => {
                    setToken(event.target.value)
                    if (error) setError('')
                  }}
                  disabled={loading}
                  autoComplete="new-password"
                  spellCheck={false}
                  placeholder="figd_••••••••••••"
                  aria-describedby={error ? `${descriptionId} ${errorId}` : descriptionId}
                  className="h-11 w-full rounded-[10px] border border-[#dedee2] bg-white pl-10 pr-11 text-[13px] text-ink outline-none transition focus:border-[#0d99ff] focus:ring-2 focus:ring-[#0d99ff]/15 disabled:bg-[#f7f7f8]"
                />
                <button
                  type="button"
                  onClick={() => setTokenVisible((visible) => !visible)}
                  disabled={loading}
                  aria-label={tokenVisible ? '隐藏访问令牌' : '显示访问令牌'}
                  aria-pressed={tokenVisible}
                  className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-[7px] text-[#8a8a91] hover:bg-[#f4f4f6] hover:text-ink disabled:opacity-40"
                >
                  {tokenVisible ? (
                    <EyeOff size={16} strokeWidth={1.8} />
                  ) : (
                    <Eye size={16} strokeWidth={1.8} />
                  )}
                </button>
              </div>
              <div className="mt-3 flex items-start gap-2 rounded-[9px] bg-[#f5f8f6] px-3 py-2.5 text-[12px] leading-[18px] text-[#51705d]">
                <ShieldCheck
                  aria-hidden="true"
                  size={15}
                  strokeWidth={1.9}
                  className="mt-[1px] shrink-0 text-[#3f9b62]"
                />
                <span>
                  访问令牌仅在本次读取期间保存在内存中，关闭窗口后立即清除。
                </span>
              </div>
            </>
          )}

          <div
            id={errorId}
            role="alert"
            aria-live="polite"
            className={[
              'mt-3 flex min-h-[20px] items-start gap-2 text-[12px] leading-5 text-[#d93f36]',
              error ? 'visible' : 'invisible',
            ].join(' ')}
          >
            <AlertCircle aria-hidden="true" size={15} strokeWidth={1.9} className="mt-0.5 shrink-0" />
            <span>{error || '无错误'}</span>
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={resetAndClose}
              disabled={loading}
              className="h-10 rounded-[9px] border border-[#dedee2] bg-white px-4 text-[13px] font-medium text-[#4d4d53] transition-colors hover:bg-[#f7f7f8] disabled:cursor-not-allowed disabled:opacity-50"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={
                loading
                || authStatus === 'loading'
                || !url.trim()
                || (authStatus !== 'connected' && !token.trim())
              }
              className="flex h-10 min-w-[116px] items-center justify-center gap-2 rounded-[9px] bg-[#1d1d1f] px-4 text-[13px] font-medium text-white transition-colors hover:bg-[#343438] disabled:cursor-not-allowed disabled:bg-[#c7c7cc]"
            >
              {loading && (
                <LoaderCircle
                  aria-hidden="true"
                  size={15}
                  strokeWidth={2}
                  className="animate-spin"
                />
              )}
              {loading ? '正在读取…' : '读取文件'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  )
}
