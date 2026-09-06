import {
  ArrowLeft,
  FileInput,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  clearQueuedFigmaImport,
  readQueuedFigmaImport,
} from '../../config/workspace'
import { useRouter } from '../../router'
import {
  FigmaApiError,
  importFigmaFileWithOAuth,
} from '../../services/figmaApi'
import { getFigmaAuthSession, startFigmaOAuth } from '../../services/figmaAuth'
import { rememberRecentFigmaFile } from '../../services/figmaRecents'
import { useEditor } from '../../state/editorStore'

type ImportState =
  | { status: 'idle' }
  | { status: 'checking'; title?: string }
  | { status: 'loading'; title?: string }
  | { status: 'auth-required'; title?: string; message: string }
  | { status: 'error'; title?: string; message: string }

const OAUTH_ERRORS: Record<string, string> = {
  access_denied: '你取消了 Figma 授权，文件还没有被读取。',
  invalid_state: '本次授权已失效，请重新连接 Figma。',
  exchange_failed: 'Figma 授权没有完成，请重新尝试。',
}

function importedFigmaUrl(key: string, fileName: string) {
  const encodedName = encodeURIComponent(fileName.trim() || 'Untitled')
  return `https://www.figma.com/design/${encodeURIComponent(key)}/${encodedName}`
}

function removeOAuthResultFromUrl() {
  const url = new URL(window.location.href)
  if (!url.searchParams.has('figma_auth')) return
  url.searchParams.delete('figma_auth')
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
}

export default function FigmaAutoImport() {
  const { navigate } = useRouter()
  const { setFigmaDocument } = useEditor()
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<ImportState>({ status: 'idle' })

  useEffect(() => {
    const pending = readQueuedFigmaImport()
    if (!pending) {
      removeOAuthResultFromUrl()
      setState({ status: 'idle' })
      return
    }

    const authResult = new URLSearchParams(window.location.search).get('figma_auth')
    const oauthError = authResult ? OAUTH_ERRORS[authResult] : undefined
    if (oauthError) {
      setState({
        status: 'error',
        title: pending.title,
        message: oauthError,
      })
      removeOAuthResultFromUrl()
      return
    }

    const controller = new AbortController()
    let cancelled = false
    setState({ status: 'checking', title: pending.title })

    const run = async () => {
      try {
        const session = await getFigmaAuthSession()
        if (cancelled) return

        if (!session.configured) {
          setState({
            status: 'error',
            title: pending.title,
            message: '当前环境还没有配置 Figma OAuth。',
          })
          return
        }

        if (!session.authenticated) {
          setState({
            status: 'auth-required',
            title: pending.title,
            message: '连接一次 Figma 后，会自动回来继续读取这个文件。',
          })
          return
        }

        setState({ status: 'loading', title: pending.title })
        const imported = await importFigmaFileWithOAuth({
          urlOrKey: pending.url,
          signal: controller.signal,
        })
        if (cancelled) return

        setFigmaDocument(imported)
        rememberRecentFigmaFile(
          importedFigmaUrl(imported.key, imported.file.name),
          imported.file.name,
        )
        clearQueuedFigmaImport()
        removeOAuthResultFromUrl()
        setState({ status: 'idle' })
      } catch (error) {
        if (cancelled || controller.signal.aborted) return
        if (error instanceof FigmaApiError && error.status === 401) {
          setState({
            status: 'auth-required',
            title: pending.title,
            message: 'Figma 授权已过期，重新连接后会继续读取这个文件。',
          })
          return
        }
        setState({
          status: 'error',
          title: pending.title,
          message: error instanceof Error
            ? error.message
            : '读取 Figma 文件失败，请重试。',
        })
      }
    }

    void run()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [attempt, setFigmaDocument])

  if (state.status === 'idle') return null

  const isBusy = state.status === 'checking' || state.status === 'loading'
  const title = state.title || 'Figma 设计稿'

  return (
    <div className="absolute inset-0 z-30 grid place-items-center bg-[#f5f5f5]/95 px-5 backdrop-blur-[2px]">
      <div className="w-full max-w-[430px] rounded-[18px] border border-white bg-white p-6 text-center shadow-[0_24px_70px_rgba(39,46,61,0.14)]">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-[14px] bg-[#f1f6ff] text-[#2769ed]">
          {isBusy
            ? <LoaderCircle size={23} className="animate-spin" />
            : state.status === 'auth-required'
              ? <ShieldCheck size={23} />
              : <FileInput size={23} />}
        </div>

        <h2 className="mt-4 truncate text-[17px] font-semibold tracking-[-0.02em] text-[#20242d]">
          {isBusy
            ? state.status === 'checking'
              ? '正在确认 Figma 连接'
              : '正在读取 Figma 文件'
            : state.status === 'auth-required'
              ? '连接 Figma 后继续'
              : '暂时无法读取文件'}
        </h2>
        <p className="mt-2 truncate text-[13px] font-medium text-[#4d5665]">
          {title}
        </p>
        <p className="mx-auto mt-2 max-w-[340px] text-[12.5px] leading-5 text-[#858e9d]">
          {isBusy
            ? '正在获取文件结构、图片和图层信息，请稍候。'
            : state.message}
        </p>

        {!isBusy && (
          <div className="mt-5 flex items-center justify-center gap-2.5">
            <button
              type="button"
              onClick={() => {
                clearQueuedFigmaImport()
                removeOAuthResultFromUrl()
                navigate('home')
              }}
              className="flex items-center gap-1.5 rounded-[9px] border border-[#dfe3ea] px-4 py-2.5 text-[13px] font-medium text-[#606978] hover:bg-[#f7f8fa]"
            >
              <ArrowLeft size={14} />
              返回首页
            </button>
            {state.status === 'auth-required' ? (
              <button
                type="button"
                onClick={() => startFigmaOAuth('/editor')}
                className="flex items-center gap-1.5 rounded-[9px] bg-[#2164ed] px-4 py-2.5 text-[13px] font-medium text-white hover:bg-[#1858d7]"
              >
                <ShieldCheck size={14} />
                连接 Figma
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setAttempt((value) => value + 1)}
                className="flex items-center gap-1.5 rounded-[9px] bg-[#2164ed] px-4 py-2.5 text-[13px] font-medium text-white hover:bg-[#1858d7]"
              >
                <RefreshCw size={14} />
                重新读取
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
