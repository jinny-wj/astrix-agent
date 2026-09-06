import { useEffect, useRef } from 'react'
import type { FigmaWorkspaceIntent } from '../config/figma'
import type { DesktopWorkspaceContext } from '../types/desktop'

function readIntent(value: unknown): FigmaWorkspaceIntent | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (record.kind === 'new') {
    return {
      kind: 'new',
      skill: typeof record.skill === 'string' ? record.skill : undefined,
      prompt: typeof record.prompt === 'string' ? record.prompt : undefined,
    }
  }
  if (record.kind === 'existing' && typeof record.url === 'string') {
    return {
      kind: 'existing',
      url: record.url,
      fileName: typeof record.fileName === 'string' ? record.fileName : undefined,
    }
  }
  return null
}

export function useDesktopAgentWorkspace(options: {
  onStart: (prompt: string, skill?: string) => void
}) {
  const onStartRef = useRef(options.onStart)
  onStartRef.current = options.onStart
  const startedRevision = useRef<number | null>(null)

  useEffect(() => {
    const host = window.designStudioAgentHost
    if (!host?.getContext) return undefined

    const apply = (value: unknown) => {
      const context = value as DesktopWorkspaceContext | null
      if (!context) return
      const intent = readIntent(context.intent)
      if (!intent || intent.kind !== 'new') return
      if (startedRevision.current === context.intentRevision) return
      const prompt = intent.prompt?.trim()
      const skill = intent.skill?.trim()
      if (!prompt && !skill) return
      startedRevision.current = context.intentRevision
      onStartRef.current(prompt || skill || '开始设计', skill)
    }

    void host.getContext().then(apply).catch(() => {})
    return host.onContext?.(apply)
  }, [])
}
