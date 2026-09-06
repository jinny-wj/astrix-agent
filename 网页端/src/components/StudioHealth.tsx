import { Bell, Settings, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { startFigmaOAuth } from '../services/figmaAuth'
import { importFigmaFile, importFigmaFileWithOAuth } from '../services/figmaApi'
import { saveFigmaLibraryConfig } from '../services/figmaLibrary'
import { loadStudioHealth, type StudioHealth } from '../services/studioHealth'

function StatusRow({
  ok,
  title,
  detail,
  action,
}: {
  ok: boolean
  title: string
  detail: string
  action?: { label: string; onClick: () => void }
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-[12px] border border-[#eceff4] bg-[#fbfcfe] px-3.5 py-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-[13px] font-medium text-[#2a2f38]">
          <span className={`h-2 w-2 rounded-full ${ok ? 'bg-[#22a06b]' : 'bg-[#d97706]'}`} />
          {title}
        </div>
        <p className="mt-1 text-[12px] leading-5 text-[#6b7382]">{detail}</p>
      </div>
      {action ? (
        <button
          type="button"
          onClick={action.onClick}
          className="shrink-0 rounded-[8px] border border-[#dfe5ee] bg-white px-2.5 py-1.5 text-[12px] font-medium text-[#3c4656] hover:bg-[#f7f8fa]"
        >
          {action.label}
        </button>
      ) : null}
    </div>
  )
}

function countNodes(node: { children?: Array<{ children?: unknown[] }> } | undefined): number {
  if (!node) return 0
  return 1 + (node.children ?? []).reduce((sum, child) => (
    sum + countNodes(child as { children?: Array<{ children?: unknown[] }> })
  ), 0)
}

export function StudioHealthBanner() {
  const [health, setHealth] = useState<StudioHealth | null>(null)

  useEffect(() => {
    void loadStudioHealth().then(setHealth).catch(() => setHealth(null))
  }, [])

  if (!health) return null
  if (health.figma.authenticated) return null
  const detail = health.figma.configured
    ? '连接 Figma 后即可打开真实文件，团队页会自动记住，登录状态会保留到下次启动。'
    : '先在当前应用目录配置 .env.local 里的 Figma OAuth，然后连接账号。'

  return (
    <div className="mx-auto mt-space-lg max-w-[1002px] rounded-[14px] border border-[#ead7b0] bg-[#fffaf0] px-space-lg py-space-md text-[13px] leading-6 text-[#6b4f1d]">
      <strong className="text-[#4a3612]">还没有连接 Figma：</strong>
      {detail}
    </div>
  )
}

export function StudioSettingsDialog({
  onClose,
}: {
  onClose: () => void
}) {
  const [health, setHealth] = useState<StudioHealth | null>(null)
  const [teamValue, setTeamValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [patUrl, setPatUrl] = useState('')
  const [patToken, setPatToken] = useState('')
  const [patMessage, setPatMessage] = useState('')
  const [patLoading, setPatLoading] = useState(false)

  const refresh = async () => {
    const next = await loadStudioHealth()
    setHealth(next)
    setTeamValue(next.library.teamIds.join('\n'))
  }

  useEffect(() => {
    void refresh().catch(() => {})
  }, [])

  const saveTeams = async () => {
    setSaving(true)
    setMessage('')
    try {
      const ids = teamValue
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
      setMessage(config.reauthorize ? '已保存。若团队文件同步失败，请再连接一次 Figma。' : '团队已保存，登录状态保持不变。')
      await refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const probeFile = async () => {
    setPatLoading(true)
    setPatMessage('')
    try {
      const result = patToken.trim()
        ? await importFigmaFile({ urlOrKey: patUrl, token: patToken.trim() })
        : await importFigmaFileWithOAuth({ urlOrKey: patUrl })
      const nodes = countNodes(result.file.document)
      setPatMessage(
        `只读探测成功：${result.file.name} · ${nodes} 个节点。这不是写回，OAuth/PAT 都不能改画布。`,
      )
    } catch (error) {
      setPatMessage(error instanceof Error ? error.message : '读取失败')
    } finally {
      setPatLoading(false)
    }
  }

  const agentOnline = health?.agent.servers.find((item) => item.online && item.id !== 'shell')

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#111827]/30 px-5 backdrop-blur-[2px]" role="presentation">
      <section className="max-h-[90vh] w-full max-w-[560px] overflow-y-auto rounded-[18px] border border-white/80 bg-white p-6 shadow-[0_26px_90px_rgba(27,39,67,0.22)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[18px] font-semibold text-[#20242d]">工作台设置</h2>
            <p className="mt-1.5 text-[12.5px] leading-5 text-[#7d8695]">
              登录后可打开和读取真实 Figma 文件。浏览团队页时会自动记住团队，Agent 改图层时在当前文件运行 Design Studio Bridge。
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭设置" className="rounded-full p-1.5 text-[#8c93a0] hover:bg-[#f2f4f8]">
            <X size={18} />
          </button>
        </div>

        <div className="mt-4 space-y-2.5">
          <StatusRow
            ok={Boolean(agentOnline)}
            title="真实 Agent"
            detail={
              agentOnline
                ? `${agentOnline.name} 可用：${agentOnline.detail}`
                : 'Codex / Claude / Hermes 都未登录或额度不可用。默认不会回退到演示壳伪造结果。'
            }
          />
          <StatusRow
            ok={Boolean(health?.figma.authenticated)}
            title="Figma 账号"
            detail={
              health?.figma.authenticated
                ? `已登录 ${health.figma.email ?? '当前账号'}，打开/新建文件将使用此账号。`
                : health?.figma.configured
                  ? 'OAuth 已配置，但当前浏览器会话未授权。'
                  : '尚未配置 FIGMA_OAUTH_CLIENT_ID / SECRET。'
            }
            action={
              health?.figma.configured
                ? { label: health.figma.authenticated ? '切换账号' : '连接 Figma', onClick: () => startFigmaOAuth() }
                : undefined
            }
          />
          <StatusRow
            ok={Boolean(health?.library.configured)}
            title="团队文件"
            detail={health?.library.configured ? `已记住 ${health.library.teamIds.length} 个团队。` : '打开 Figma 团队页后会自动记住，也可以在下方粘贴团队链接。'}
          />
          <StatusRow
            ok={Boolean(health?.bridge.connected)}
            title="Figma Bridge"
            detail={health?.bridge.note ?? '在当前 Figma 文件运行 Design Studio Bridge 后，Agent 才能改图层。画布右下角可一键重开。'}
          />
        </div>

        <label className="mt-5 block text-[12.5px] font-medium text-[#3e4653]" htmlFor="studio-team-ids">
          Team ID / 团队链接
        </label>
        <textarea
          id="studio-team-ids"
          value={teamValue}
          onChange={(event) => setTeamValue(event.target.value)}
          rows={3}
          placeholder="123456789012345678 或 https://www.figma.com/files/team/..."
          className="mt-2 w-full rounded-[10px] border border-[#e2e6ed] px-3 py-2 text-[13px] outline-none focus:border-[#2164ed]"
        />
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-[12px] text-[#8a93a2]">{message}</p>
          <button
            type="button"
            disabled={saving}
            onClick={() => void saveTeams()}
            className="rounded-[9px] bg-[#2164ed] px-3.5 py-2 text-[12.5px] font-medium text-white hover:bg-[#1858d7] disabled:opacity-60"
          >
            保存 Team ID
          </button>
        </div>

        <div className="mt-5 border-t border-[#eef1f5] pt-4">
          <h3 className="text-[13px] font-medium text-[#2a2f38]">只读探测（OAuth 或 PAT）</h3>
          <p className="mt-1 text-[12px] leading-5 text-[#7d8695]">
            用来验证当前凭证能不能读到真实文件。成功也不等于能写回。
          </p>
          <input
            value={patUrl}
            onChange={(event) => setPatUrl(event.target.value)}
            placeholder="https://www.figma.com/design/..."
            className="mt-3 w-full rounded-[10px] border border-[#e2e6ed] px-3 py-2 text-[13px] outline-none focus:border-[#2164ed]"
          />
          <input
            value={patToken}
            onChange={(event) => setPatToken(event.target.value)}
            placeholder="可选：Personal Access Token。留空则使用当前 OAuth 会话"
            type="password"
            autoComplete="off"
            className="mt-2 w-full rounded-[10px] border border-[#e2e6ed] px-3 py-2 text-[13px] outline-none focus:border-[#2164ed]"
          />
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-[12px] leading-5 text-[#8a93a2]">{patMessage}</p>
            <button
              type="button"
              disabled={patLoading || !patUrl.trim()}
              onClick={() => void probeFile()}
              className="shrink-0 rounded-[9px] border border-[#dfe5ee] bg-white px-3 py-2 text-[12.5px] font-medium text-[#3c4656] hover:bg-[#f7f8fa] disabled:opacity-50"
            >
              {patLoading ? '读取中…' : '探测文件'}
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}

export function StudioSettingsButton({
  kind = 'settings',
}: {
  kind?: 'settings' | 'notifications'
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={kind === 'notifications' ? '连接状态' : '工作台设置'}
        aria-label={kind === 'notifications' ? '连接状态' : '工作台设置'}
        className="hover:text-ink"
      >
        {kind === 'notifications' ? <Bell size={17} strokeWidth={1.8} /> : <Settings size={17} strokeWidth={1.8} />}
      </button>
      {open ? <StudioSettingsDialog onClose={() => setOpen(false)} /> : null}
    </>
  )
}
