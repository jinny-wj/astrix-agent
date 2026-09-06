import type { FigmaSelectionSnapshot, FigmaWriteCommand } from '../types/figmaWrite'

export async function enqueueFigmaWriteCommands(
  commands: FigmaWriteCommand | FigmaWriteCommand[],
) {
  const list = Array.isArray(commands) ? commands : [commands]
  const response = await fetch('/api/figma-bridge/commands', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ commands: list }),
  })
  if (!response.ok) {
    throw new Error('无法入队 Figma 写命令')
  }
  return response.json() as Promise<{ accepted: string[]; queueSize: number }>
}

export async function getFigmaBridgeStatus(fileKey?: string) {
  const query = fileKey ? `?fileKey=${encodeURIComponent(fileKey)}` : ''
  const response = await fetch(`/api/figma-bridge/status${query}`, { cache: 'no-store' })
  if (!response.ok) throw new Error('无法读取 Bridge 状态')
  return response.json() as Promise<{
    pending: FigmaWriteCommand[]
    recent: unknown[]
    pluginConnectedAt: string | null
    selection: FigmaSelectionSnapshot | null
    ok: boolean
    note?: string
  }>
}
