import {
  Check,
  ChevronLeft,
  ChevronRight,
  Hash,
  Image as ImageIcon,
  Server,
  Spline,
  SquarePen,
  Smile,
} from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import type {
  AgentBackendKind,
  AgentContextItem,
  AgentInstruction,
  AgentMcpService,
  AgentServerInfo,
  AgentStatusSnapshot,
} from '../../../types/agentComposer'
import { makeId } from '../../../services/agentComposer'

export type ComposerPanel = 'root' | 'context' | 'instruction' | 'mcp' | 'server'

function StatusDot({ online }: { online?: boolean }) {
  if (!online) return null
  return (
    <span className="absolute -bottom-[1px] -right-[1px] h-[7px] w-[7px] rounded-full border border-white bg-[#22c55e]" />
  )
}

function MenuButton({
  icon,
  label,
  chevron,
  online,
  onClick,
}: {
  icon: ReactNode
  label: string
  chevron?: boolean
  online?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-[10px] px-[12px] py-[9px] text-left text-[13px] text-[#2f3036] hover:bg-[#f6f7f9]"
    >
      <span className="relative flex h-[18px] w-[18px] shrink-0 items-center justify-center text-[#5c5d64]">
        {icon}
        <StatusDot online={online} />
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {chevron ? <ChevronRight size={14} strokeWidth={1.8} className="text-[#c0c1c6]" /> : null}
    </button>
  )
}

function SubHeader({
  title,
  onBack,
}: {
  title: string
  onBack: () => void
}) {
  return (
    <div className="flex items-center gap-[6px] border-b border-[#eeeef1] px-[8px] py-[7px]">
      <button
        type="button"
        onClick={onBack}
        className="rounded-[6px] p-[4px] text-[#6b6c72] hover:bg-[#f4f5f7] hover:text-ink"
        aria-label="返回"
      >
        <ChevronLeft size={15} strokeWidth={1.9} />
      </button>
      <span className="text-[12.5px] font-medium text-[#2f3036]">{title}</span>
    </div>
  )
}

export default function PlusComposerMenu({
  panel,
  onPanel,
  onAddFiles,
  onEmoji,
  contextItems,
  selectedContextIds,
  onToggleContext,
  instructions,
  activeInstructionIds,
  onToggleInstruction,
  onSaveInstruction,
  onDeleteInstruction,
  status,
  enabledMcpIds,
  onToggleMcp,
  preferredBackend,
  onPickBackend,
}: {
  panel: ComposerPanel
  onPanel: (panel: ComposerPanel) => void
  onAddFiles: () => void
  contextItems: AgentContextItem[]
  onEmoji?: () => void
  selectedContextIds: Set<string>
  onToggleContext: (item: AgentContextItem) => void
  instructions: AgentInstruction[]
  activeInstructionIds: Set<string>
  onToggleInstruction: (id: string) => void
  onSaveInstruction: (item: AgentInstruction) => void
  onDeleteInstruction: (id: string) => void
  status: AgentStatusSnapshot | null
  enabledMcpIds: Set<string>
  onToggleMcp: (service: AgentMcpService) => void
  preferredBackend?: AgentBackendKind
  onPickBackend: (id: AgentBackendKind) => void
}) {
  const [draftTitle, setDraftTitle] = useState('')
  const [draftBody, setDraftBody] = useState('')
  const mcpOnline = Boolean(status?.mcp.some((item) => item.available))
  const serverOnline = Boolean(
    status?.servers.some((item) => item.online && item.id !== 'shell')
    || (status?.configured && status.backend !== 'local-shell'),
  )

  useEffect(() => {
    if (panel !== 'instruction') {
      setDraftTitle('')
      setDraftBody('')
    }
  }, [panel])

  const saveDraft = () => {
    const body = draftBody.trim()
    if (!body) return
    onSaveInstruction({
      id: makeId('ins'),
      title: draftTitle.trim() || '自定义指令',
      body,
    })
    setDraftTitle('')
    setDraftBody('')
  }

  return (
    <div
      role="menu"
      className="absolute bottom-[calc(100%+8px)] left-0 z-50 w-[248px] overflow-hidden rounded-[12px] border border-[#e7e8ec] bg-white shadow-[0_12px_40px_rgba(28,32,42,0.14)]"
    >
      {panel === 'root' && (
        <div className="py-[4px]">
          {onEmoji && <MenuButton icon={<Smile size={15} />} label="插入表情" onClick={onEmoji} />}
          <MenuButton
            icon={<ImageIcon size={15} strokeWidth={1.7} />}
            label="添加照片和文件"
            onClick={onAddFiles}
          />
          <MenuButton
            icon={<Hash size={15} strokeWidth={1.8} />}
            label="引用上下文"
            onClick={() => onPanel('context')}
          />
          <MenuButton
            icon={<SquarePen size={15} strokeWidth={1.7} />}
            label="添加指令"
            onClick={() => onPanel('instruction')}
          />
          <div className="my-[4px] h-px bg-[#eeeef1]" />
          <MenuButton
            icon={<Spline size={15} strokeWidth={1.7} />}
            label="MCP 服务"
            chevron
            online={mcpOnline}
            onClick={() => onPanel('mcp')}
          />
          <div className="my-[4px] h-px bg-[#eeeef1]" />
          <MenuButton
            icon={<Server size={15} strokeWidth={1.7} />}
            label="服务器状态"
            chevron
            online={serverOnline}
            onClick={() => onPanel('server')}
          />
        </div>
      )}

      {panel === 'context' && (
        <div>
          <SubHeader title="引用上下文" onBack={() => onPanel('root')} />
          <div className="max-h-[240px] overflow-y-auto py-[4px]">
            {contextItems.length === 0 ? (
              <p className="px-[12px] py-[10px] text-[12px] text-[#8a8a90]">
                还没有可引用的图层或文件。点选画布图层，或先打开一份设计稿。
              </p>
            ) : (
              groupedContext(contextItems).map((group) => (
                <div key={group.title}>
                  <p className="px-[12px] pb-[2px] pt-[8px] text-[10.5px] font-medium uppercase tracking-wide text-[#9a9aa2]">
                    {group.title}
                  </p>
                  {group.items.map((item) => {
                    const checked = selectedContextIds.has(item.id)
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => onToggleContext(item)}
                        className="flex w-full items-center gap-[8px] px-[12px] py-[7px] text-left hover:bg-[#f6f7f9]"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12.5px] text-[#2f3036]">{item.label}</span>
                          {item.detail ? (
                            <span className="block truncate text-[10.5px] uppercase text-[#8a8a90]">
                              {item.detail}
                            </span>
                          ) : null}
                        </span>
                        {checked ? <Check size={14} strokeWidth={2.2} className="text-[#3b6fe0]" /> : null}
                      </button>
                    )
                  })}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {panel === 'instruction' && (
        <div>
          <SubHeader title="添加指令" onBack={() => onPanel('root')} />
          <div className="max-h-[280px] space-y-[8px] overflow-y-auto px-[10px] py-[8px]">
            {instructions.map((item) => (
              <label
                key={item.id}
                className="flex cursor-pointer items-start gap-[8px] rounded-[8px] px-[4px] py-[4px] hover:bg-[#f6f7f9]"
              >
                <input
                  type="checkbox"
                  checked={activeInstructionIds.has(item.id)}
                  onChange={() => onToggleInstruction(item.id)}
                  className="mt-[3px]"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-[12.5px] text-[#2f3036]">{item.title}</span>
                  <span className="block text-[11px] leading-[1.4] text-[#8a8a90]">{item.body}</span>
                </span>
                {item.preset ? null : (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.preventDefault()
                      onDeleteInstruction(item.id)
                    }}
                    className="text-[11px] text-[#b42318] hover:underline"
                  >
                    删除
                  </button>
                )}
              </label>
            ))}
            <input
              value={draftTitle}
              onChange={(event) => setDraftTitle(event.target.value)}
              placeholder="指令标题"
              className="w-full rounded-[8px] border border-[#e7e8ec] px-[8px] py-[6px] text-[12px] outline-none focus:border-[#3b6fe0]"
            />
            <textarea
              value={draftBody}
              onChange={(event) => setDraftBody(event.target.value)}
              rows={3}
              placeholder="写一条会随每次请求发给 Codex 的指令"
              className="w-full resize-none rounded-[8px] border border-[#e7e8ec] px-[8px] py-[6px] text-[12px] outline-none focus:border-[#3b6fe0]"
            />
            <button
              type="button"
              disabled={!draftBody.trim()}
              onClick={saveDraft}
              className="w-full rounded-[8px] bg-[#3b6fe0] py-[6px] text-[12px] font-medium text-white disabled:opacity-40"
            >
              保存并用于本次请求
            </button>
          </div>
        </div>
      )}

      {panel === 'mcp' && (
        <div>
          <SubHeader title="MCP 服务" onBack={() => onPanel('root')} />
          <div className="max-h-[240px] overflow-y-auto py-[4px]">
            {(status?.mcp ?? []).length === 0 ? (
              <p className="px-[12px] py-[10px] text-[12px] text-[#8a8a90]">正在读取本机 MCP…</p>
            ) : (
              (status?.mcp ?? []).map((service) => {
                const checked = enabledMcpIds.has(service.id)
                return (
                  <button
                    key={service.id}
                    type="button"
                    onClick={() => onToggleMcp(service)}
                    className="flex w-full items-start gap-[8px] px-[12px] py-[8px] text-left hover:bg-[#f6f7f9]"
                  >
                    <span className="relative mt-[2px] h-[8px] w-[8px] shrink-0 rounded-full bg-[#d4d5da]">
                      {service.available ? (
                        <span className="absolute inset-0 rounded-full bg-[#22c55e]" />
                      ) : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-[6px] text-[12.5px] text-[#2f3036]">
                        {service.name}
                        {checked ? <Check size={13} strokeWidth={2.2} className="text-[#3b6fe0]" /> : null}
                      </span>
                      <span className="block text-[11px] text-[#8a8a90]">{service.description}</span>
                      <span className="block text-[10.5px] text-[#b0b0b6]">
                        {service.available ? '可用' : '本机未就绪'}
                        {service.source === 'codex-mcp' ? ' · Codex MCP' : ''}
                      </span>
                    </span>
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}

      {panel === 'server' && (
        <div>
          <SubHeader title="服务器状态" onBack={() => onPanel('root')} />
          <div className="py-[4px]">
            <p className="px-[12px] pb-[4px] pt-[6px] text-[11px] text-[#8a8a90]">
              当前生效：{status?.backend ?? '检测中'}
              {status?.model ? ` · ${status.model}` : ''}
            </p>
            {(status?.servers ?? []).map((server) => (
              <ServerRow
                key={server.id}
                server={server}
                preferred={preferredBackend === server.id || (!preferredBackend && Boolean(server.active))}
                onPick={() => onPickBackend(server.id)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function ServerRow({
  server,
  preferred,
  onPick,
}: {
  server: AgentServerInfo
  preferred: boolean
  onPick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      className="flex w-full items-start gap-[8px] px-[12px] py-[8px] text-left hover:bg-[#f6f7f9]"
    >
      <span className={`mt-[3px] h-[8px] w-[8px] shrink-0 rounded-full ${
        server.online ? 'bg-[#22c55e]' : 'bg-[#d4d5da]'
      }`} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-[6px] text-[12.5px] text-[#2f3036]">
          {server.name}
          {preferred ? (
            <span className="rounded-full bg-[#eef3ff] px-[6px] py-[1px] text-[10px] text-[#3b6fe0]">
              本次使用
            </span>
          ) : null}
        </span>
        <span className="block truncate text-[11px] text-[#8a8a90]">{server.detail}</span>
      </span>
    </button>
  )
}

function groupedContext(items: AgentContextItem[]) {
  const titles: Record<AgentContextItem['kind'], string> = {
    layer: '图层',
    file: '文件',
    skill: 'Skill',
    conversation: '会话',
  }
  const order: AgentContextItem['kind'][] = ['layer', 'file', 'skill', 'conversation']
  return order.flatMap((kind) => {
    const groupItems = items.filter((item) => item.kind === kind)
    return groupItems.length > 0 ? [{ title: titles[kind], items: groupItems }] : []
  })
}
