import {
  AlertCircle,
  ExternalLink,
  FileImage,
  FileInput,
  Link2,
  LoaderCircle,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Settings2,
  X,
} from 'lucide-react'
import {
  type FormEvent,
  type MouseEvent,
  type ReactNode,
  useEffect,
  useId,
  useState,
} from 'react'
import {
  openFigmaDesign,
  openFigmaInBrowser,
  openNewFileFromHomepage,
} from '../config/figma'
import {
  type RecentFigmaFile,
  useRecentFigmaFiles,
} from '../hooks/useRecentFigmaFiles'
import { getFigmaAuthSession, startFigmaOAuth } from '../services/figmaAuth'
import {
  getFigmaLibraryConfig,
  saveFigmaLibraryConfig,
  syncFigmaLibrary,
  type LibraryConfig,
  type SyncedLibraryFile,
} from '../services/figmaLibrary'
import {
  parseFigmaDesignUrl,
  rememberRecentFigmaFile,
} from '../services/figmaRecents'

function formatDate(value: string | undefined) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

function NewFileThumbnail() {
  return (
    <div className="new-project-thumbnail flex h-full w-full flex-col items-center justify-center gap-3">
      <span className="grid h-10 w-10 place-items-center rounded-full bg-[#25282d] text-white">
        <Plus size={23} strokeWidth={1.7} />
      </span>
      <span className="text-[15px] font-semibold text-[#25282d]">新建设计稿</span>
    </div>
  )
}

function RecentFileThumbnail({ file }: { file: RecentFigmaFile }) {
  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden bg-[linear-gradient(135deg,#f8faff,#f4f5f8)]">
      <div className="flex h-12 w-12 items-center justify-center rounded-[14px] border border-white bg-white/80 text-[#6d7890] shadow-sm">
        <FileImage size={23} strokeWidth={1.5} />
      </div>
      {file.thumbnailUrl && (
        <img
          src={file.thumbnailUrl}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          className="absolute inset-0 h-full w-full object-contain"
        />
      )}
    </div>
  )
}

function StatusCard({
  children,
  action,
}: {
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex aspect-[1.79/1] min-w-0 flex-col items-center justify-center rounded-[15px] border border-dashed border-[#dfe3ea] bg-[#fafbfd] px-6 text-center text-[13px] leading-5 text-[#818997]">
      {children}
      {action}
    </div>
  )
}

function OpenFigmaDialog({
  onClose,
  onImport,
  onOpenExternal,
}: {
  onClose: () => void
  onImport: (url: string) => void
  onOpenExternal: (url: string) => void
}) {
  const titleId = useId()
  const inputId = useId()
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    try {
      const parsed = parseFigmaDesignUrl(url)
      onImport(parsed.url)
    } catch (validationError) {
      setError(
        validationError instanceof Error
          ? validationError.message
          : '请输入有效的 Figma Design 文件链接。',
      )
    }
  }

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-50 grid place-items-center bg-[#111827]/30 px-5 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose()
      }}
    >
      <form
        onSubmit={submit}
        aria-labelledby={titleId}
        className="w-full max-w-[480px] rounded-[18px] border border-white/80 bg-white p-6 shadow-[0_26px_90px_rgba(27,39,67,0.22)]"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2
              id={titleId}
              className="text-[18px] font-semibold tracking-[-0.02em] text-[#20242d]"
            >
              打开 Figma 设计稿
            </h2>
            <p className="mt-1.5 text-[12.5px] leading-5 text-[#7d8695]">
              粘贴真实 Figma Design 文件链接，读取后会在工作台显示图层和画布。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="rounded-full p-1.5 text-[#8c93a0] hover:bg-[#f2f4f8] hover:text-[#353a45]"
          >
            <X size={18} />
          </button>
        </div>

        <label
          htmlFor={inputId}
          className="mt-5 block text-[12.5px] font-medium text-[#3e4653]"
        >
          Figma Design 链接
        </label>
        <div className="relative mt-2">
          <Link2
            size={16}
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#979eaa]"
          />
          <input
            id={inputId}
            autoFocus
            value={url}
            onChange={(event) => {
              setUrl(event.target.value)
              if (error) setError('')
            }}
            placeholder="https://www.figma.com/design/..."
            spellCheck={false}
            className="h-11 w-full rounded-[10px] border border-[#dde2e9] bg-white pl-10 pr-3 text-[13px] text-[#2f3540] outline-none transition focus:border-[#3378ef] focus:ring-2 focus:ring-[#3378ef]/15"
          />
        </div>

        <div
          role="alert"
          aria-live="polite"
          className={[
            'mt-2.5 flex min-h-5 items-start gap-1.5 text-[12px] leading-5 text-[#d54d4d]',
            error ? 'visible' : 'invisible',
          ].join(' ')}
        >
          <AlertCircle size={14} className="mt-[2px] shrink-0" />
          <span>{error || '无错误'}</span>
        </div>

        <div className="mt-4 flex justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-[9px] border border-[#dfe3ea] px-4 py-2.5 text-[13px] font-medium text-[#606978] hover:bg-[#f7f8fa]"
          >
            取消
          </button>
          <button
            type="button"
            disabled={!url.trim()}
            onClick={() => {
              try {
                const parsed = parseFigmaDesignUrl(url)
                onOpenExternal(parsed.url)
              } catch (validationError) {
                setError(
                  validationError instanceof Error
                    ? validationError.message
                    : '请输入有效的 Figma Design 文件链接。',
                )
              }
            }}
            className="flex items-center gap-1.5 rounded-[9px] border border-[#dfe3ea] px-4 py-2.5 text-[13px] font-medium text-[#606978] hover:bg-[#f7f8fa] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ExternalLink size={14} />
            在工作台打开
          </button>
          <button
            type="submit"
            disabled={!url.trim()}
            className="flex items-center gap-1.5 rounded-[9px] bg-[#2164ed] px-4 py-2.5 text-[13px] font-medium text-white hover:bg-[#1858d7] disabled:cursor-not-allowed disabled:bg-[#b8c7e5]"
          >
            <FileInput size={14} />
            读取到工作台
          </button>
        </div>
      </form>
    </div>
  )
}

function TeamConfigDialog({
  teamIds,
  onClose,
  onSaved,
}: {
  teamIds: string[]
  onClose: () => void
  onSaved: (config: LibraryConfig) => void
}) {
  const titleId = useId()
  const [value, setValue] = useState(teamIds.join('\n'))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      const ids = value
        .split(/[,\s]+/)
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => {
          if (/^\d{5,32}$/.test(item)) return item
          const match = item.match(/\/team\/(\d{5,32})(?:\/|$)/)
          if (match) return match[1]
          throw new Error(`无法识别 Team ID：${item}`)
        })
      const config = await saveFigmaLibraryConfig([...new Set(ids)])
      onSaved(config)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#111827]/30 px-5 backdrop-blur-[2px]" role="presentation">
      <section role="dialog" aria-modal="true" aria-labelledby={titleId} className="w-full max-w-[500px] rounded-[18px] border border-white/80 bg-white p-6 shadow-[0_26px_90px_rgba(27,39,67,0.22)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id={titleId} className="text-[18px] font-semibold text-[#20242d]">团队文件同步</h2>
            <p className="mt-1.5 text-[12.5px] leading-5 text-[#7d8695]">
              粘贴 Figma 团队链接或 Team ID。打开过团队页后也会自动记住，不必先断开登录。
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭团队设置" className="rounded-full p-1.5 text-[#8c93a0] hover:bg-[#f2f4f8]">
            <X size={18} />
          </button>
        </div>
        <label className="mt-5 block text-[12.5px] font-medium text-[#3e4653]" htmlFor={`${titleId}-ids`}>Team ID / Team URL</label>
        <textarea
          id={`${titleId}-ids`}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          rows={4}
          placeholder="123456789012345678"
          className="mt-2 w-full resize-none rounded-[10px] border border-[#dde2e9] p-3 text-[13px] outline-none focus:border-[#3378ef] focus:ring-2 focus:ring-[#3378ef]/15"
        />
        <p className="mt-2 min-h-5 text-[12px] text-[#d54d4d]">{error}</p>
        <div className="mt-3 flex justify-end gap-2.5">
          <button type="button" onClick={onClose} className="rounded-[9px] border border-[#dfe3ea] px-4 py-2.5 text-[13px] text-[#606978]">取消</button>
          <button type="button" disabled={saving} onClick={() => void save()} className="rounded-[9px] bg-[#2164ed] px-4 py-2.5 text-[13px] font-medium text-white disabled:opacity-60">
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </section>
    </div>
  )
}

export default function RecentFigma() {
  const [connected, setConnected] = useState<boolean | null>(null)
  const { status, files, metadataStatus, refresh, source } =
    useRecentFigmaFiles({ enabled: connected === true })
  const [openDialog, setOpenDialog] = useState(false)
  const [libraryFiles, setLibraryFiles] = useState<SyncedLibraryFile[]>([])
  const [librarySyncing, setLibrarySyncing] = useState(false)
  const [libraryError, setLibraryError] = useState('')
  const [libraryHint, setLibraryHint] = useState('')
  const [teamIdsConfigured, setTeamIdsConfigured] = useState(false)
  const [teamIds, setTeamIds] = useState<string[]>([])
  const [teamConfigOpen, setTeamConfigOpen] = useState(false)
  const [openingKey, setOpeningKey] = useState('')

  useEffect(() => {
    void getFigmaAuthSession()
      .then((session) => setConnected(Boolean(session.authenticated && session.user)))
      .catch(() => setConnected(false))
  }, [])

  useEffect(() => {
    void getFigmaLibraryConfig()
      .then((config) => {
        setTeamIdsConfigured(config.configured)
        setTeamIds(config.teamIds)
      })
      .catch(() => setTeamIdsConfigured(false))
  }, [])

  const createStudioFile = () => {
    const { surface, url } = openNewFileFromHomepage({ prompt: '' })
    if (surface === 'figma-tab') openFigmaInBrowser(url)
  }

  const openRecentFile = (
    event: MouseEvent<HTMLAnchorElement>,
    file: RecentFigmaFile,
  ) => {
    event.preventDefault()
    void importIntoWorkspace(file)
  }

  const openLibraryFile = (
    event: MouseEvent<HTMLAnchorElement>,
    file: SyncedLibraryFile,
  ) => {
    event.preventDefault()
    void importIntoWorkspace({
      key: file.key,
      url: file.url,
      title: file.name,
    })
  }

  const importIntoWorkspace = async ({
    key,
    url,
    title,
  }: Pick<RecentFigmaFile, 'key' | 'url' | 'title'>) => {
    setOpeningKey(key)
    setLibraryError('')
    try {
      rememberRecentFigmaFile(url, title)
      const launched = openFigmaDesign({ kind: 'existing', url, fileName: title })
      if (launched.surface === 'figma-tab') openFigmaInBrowser(launched.url)
    } catch (error) {
      setLibraryError(
        error instanceof Error ? error.message : '暂时无法读取 Figma 文件。',
      )
    } finally {
      setOpeningKey('')
    }
  }

  const syncTeamLibrary = async () => {
    setLibrarySyncing(true)
    setLibraryError('')
    setLibraryHint('')
    try {
      const session = await getFigmaAuthSession()
      if (!session.configured) {
        setLibraryError('请先在 .env 配置 Figma OAuth Client。')
        return
      }
      if (!session.authenticated) {
        startFigmaOAuth('/')
        return
      }
      if (!teamIdsConfigured) {
        setTeamConfigOpen(true)
        return
      }

      const result = await syncFigmaLibrary()
      setLibraryFiles(result.files)
      for (const file of result.files.slice(0, 12)) {
        rememberRecentFigmaFile(file.url, file.name)
      }
      await refresh()
      setLibraryHint(
        result.truncated
          ? `已同步前 ${result.files.length} 个文件（已截断）`
          : `已同步 ${result.files.length} 个团队文件`,
      )
      if (result.errors.length > 0) {
        setLibraryError(result.errors[0]?.message ?? '部分项目同步失败')
      }
    } catch (error) {
      setLibraryError(
        error instanceof Error ? error.message : '团队文件同步失败',
      )
    } finally {
      setLibrarySyncing(false)
    }
  }

  const isSyncing =
    connected === true
    && (
      status === 'loading'
      || metadataStatus === 'loading'
      || librarySyncing
    )
  const statusLabel =
    connected === null
      ? '确认授权'
      : connected === false
        ? '未连接'
        : librarySyncing
          ? '同步团队文件中'
          : status === 'unavailable'
            ? '扩展未连接'
            : status === 'ready' && files.length === 0
              ? '暂无记录'
              : status === 'ready'
                ? source === 'extension'
                  ? `已同步 ${files.length} 个`
                  : `本机记录 ${files.length} 个`
                : '同步中'

  const displayFiles: RecentFigmaFile[] =
    libraryFiles.length > 0
      ? libraryFiles.map((file) => ({
          key: file.key,
          url: file.url,
          title: file.name,
          lastOpenedAt: file.lastModified ?? new Date().toISOString(),
          thumbnailUrl: file.thumbnailUrl,
          lastModified: file.lastModified,
        }))
      : files

  return (
    <section id="recent-figma" className="project-section mx-auto mt-[calc(var(--space-4xl)+var(--space-2xl))] w-full max-w-[1104px] scroll-mt-6 pb-space-2xl">
      <div className="flex flex-wrap items-center justify-between gap-5">
        <div className="flex min-w-0 items-center gap-[12px]">
          <h2 className="whitespace-nowrap text-[22px] font-semibold tracking-tight text-[#202124]">
            我的项目
          </h2>
          <span
            className={[
              'flex items-center gap-[5px] whitespace-nowrap rounded-full border px-[10px] py-[4px] text-[12px] font-medium',
              status === 'unavailable' && !libraryFiles.length
                ? 'border-[#e3d9c7] bg-[#fffaf2] text-[#98713b]'
                : 'border-[#bfd5ff] bg-[#f7faff] text-[#3d76f3]',
            ].join(' ')}
          >
            {isSyncing && (
              <LoaderCircle size={12} strokeWidth={2.2} className="animate-spin" />
            )}
            {statusLabel}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-4 text-[13px] font-medium text-[#637083]">
          <button
            type="button"
            onClick={() => {
              if (connected) setOpenDialog(true)
              else startFigmaOAuth()
            }}
            className="transition-colors hover:text-[#1758dd]"
          >
            打开设计稿
          </button>
          {connected ? (
            <>
              <button
                type="button"
                onClick={() => void syncTeamLibrary()}
                disabled={librarySyncing}
                className="transition-colors hover:text-[#1758dd] disabled:opacity-60"
              >
                同步团队文件
              </button>
              <button
                type="button"
                onClick={() => setTeamConfigOpen(true)}
                className="flex items-center gap-1.5 transition-colors hover:text-[#1758dd]"
              >
                <Settings2 size={13} />
                团队设置
              </button>
              <button
                type="button"
                onClick={() => void refresh()}
                className="flex items-center gap-1.5 transition-colors hover:text-[#1758dd]"
              >
                <RefreshCw size={13} />
                重新同步
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => startFigmaOAuth()}
              className="transition-colors hover:text-[#1758dd]"
            >
              连接 Figma
            </button>
          )}
        </div>
      </div>

      {(libraryHint || libraryError) && (
        <div className="mt-3 text-[12.5px] leading-5">
          {libraryHint && <p className="text-[#4b6cb7]">{libraryHint}</p>}
          {libraryError && <p className="text-[#b42318]">{libraryError}</p>}
        </div>
      )}

      <div
        className="project-grid mt-6 grid grid-cols-1 items-start gap-x-5 gap-y-8 sm:grid-cols-2 xl:grid-cols-4"
        aria-live="polite"
      >
        <button
          type="button"
          onClick={() => createStudioFile()}
          aria-label="新建设计稿"
          className="project-create-card group flex min-w-0 flex-col text-left"
        >
          <div className="h-full w-full overflow-hidden rounded-[20px]">
            <NewFileThumbnail />
          </div>
        </button>

        {connected === false && (
          <StatusCard
            action={(
              <button
                type="button"
                onClick={() => startFigmaOAuth()}
                className="mt-3 rounded-[8px] border border-[#dce2ec] bg-white px-3 py-1.5 text-[12px] font-medium text-[#53657f] hover:border-[#c9d5e7]"
              >
                连接并选择账号
              </button>
            )}
          >
            连接 Figma 并授权后，才会显示最近文件。
          </StatusCard>
        )}

        {connected === true && status === 'loading' && libraryFiles.length === 0 && (
          <StatusCard>
            <LoaderCircle size={20} className="mb-2 animate-spin text-[#5f83cf]" />
            正在读取最近 Figma 文件…
          </StatusCard>
        )}

        {connected === true && status === 'unavailable' && libraryFiles.length === 0 && (
          <StatusCard
            action={(
              <button
                type="button"
                onClick={() => void refresh()}
                className="mt-3 rounded-[8px] border border-[#dce2ec] bg-white px-3 py-1.5 text-[12px] font-medium text-[#53657f] hover:border-[#c9d5e7]"
              >
                重试连接
              </button>
            )}
          >
            还没有最近文件。可点「同步团队文件」拉取当前账号可见项目。
          </StatusCard>
        )}

        {connected === true && status === 'ready' && displayFiles.length === 0 && (
          <StatusCard>
            还没有文件。通过本页打开一次 Figma，或点「同步团队文件」。
          </StatusCard>
        )}

        {connected === true && displayFiles.map((file) => {
          const displayTime = formatDate(file.lastModified || file.lastOpenedAt)
          const timePrefix = file.lastModified ? '更新于' : '最近打开'

          const opening = openingKey === file.key

          return (
            <article key={file.key} className="project-file-card group min-w-0 text-left">
              <button type="button" disabled={opening} onClick={() => void importIntoWorkspace(file)}
                className="block w-full disabled:cursor-wait" aria-label={`读取 ${file.title} 到工作台`}>
                <div className="project-cover relative w-full overflow-hidden">
                  <RecentFileThumbnail file={file} />
                  {opening && <span className="absolute inset-0 grid place-items-center bg-white/80"><LoaderCircle size={22} className="animate-spin text-[#2769ed]" /></span>}
                </div>
              </button>
              <div className="project-card-info">
                <div className="flex items-center gap-2">
                  <button type="button" disabled={opening} onClick={() => void importIntoWorkspace(file)}
                    className="min-w-0 flex-1 truncate text-left text-[15px] font-semibold text-[#202124] hover:text-[#2164ed]">
                    {file.title}
                  </button>
                  <details className="project-card-menu">
                    <summary aria-label={`${file.title} 的更多操作`}><MoreHorizontal size={18} /></summary>
                    <div className="project-menu-items">
                      <button type="button" disabled={opening} onClick={(event) => {
                        event.currentTarget.closest('details')?.removeAttribute('open')
                        void importIntoWorkspace(file)
                      }}><FileInput size={14} />读取到工作台</button>
                      <a href={file.url} target="_blank" rel="noopener noreferrer" onClick={(event) => {
                        event.currentTarget.closest('details')?.removeAttribute('open')
                        const library = libraryFiles.find((item) => item.key === file.key)
                        if (library) openLibraryFile(event, library)
                        else openRecentFile(event, file)
                      }}><ExternalLink size={14} />在 Figma 中打开</a>
                    </div>
                  </details>
                </div>
                <p className="mt-2 truncate text-[12px] text-[#969aa3]">{displayTime ? `${timePrefix}：${displayTime}` : '暂无更新时间'}</p>
              </div>
            </article>
          )
        })}
      </div>

      {openDialog && (
        <OpenFigmaDialog
          onClose={() => setOpenDialog(false)}
          onImport={(url) => {
            setOpenDialog(false)
            const parsed = rememberRecentFigmaFile(url)
            void importIntoWorkspace({
              key: parsed.key,
              url: parsed.url,
              title: '未命名设计稿',
            })
          }}
          onOpenExternal={(url) => {
            setOpenDialog(false)
            const parsed = rememberRecentFigmaFile(url)
            void importIntoWorkspace({
              key: parsed.key,
              url: parsed.url,
              title: '未命名设计稿',
            })
          }}
        />
      )}
      {teamConfigOpen && (
        <TeamConfigDialog
          teamIds={teamIds}
          onClose={() => setTeamConfigOpen(false)}
          onSaved={(config) => {
            setTeamIds(config.teamIds)
            setTeamIdsConfigured(config.configured)
            setTeamConfigOpen(false)
            if (config.reauthorize) startFigmaOAuth('/')
          }}
        />
      )}
    </section>
  )
}
