import type { FigmaWorkspaceIntent } from '../config/figma'

export type DesktopWorkspaceContext = {
  tabId: string
  intent: FigmaWorkspaceIntent | null
  intentRevision: number
  fileKey: string | null
  nodeId: string | null
  url?: string | null
  title?: string | null
}

export type DesignStudioAgentHost = {
  hidePanel?: () => void
  onUiAction?: (listener: (action: string) => void) => () => void
  updateProfile?: (profile: { name: string; avatarUrl?: string } | null) => void
  installBridge?: () => void
  getIntent(): Promise<FigmaWorkspaceIntent | null>
  getContext(): Promise<DesktopWorkspaceContext | null>
  onIntent(listener: (intent: unknown) => void): () => void
  onContext(listener: (context: unknown) => void): () => void
  openNewCanvas?(intent?: { skill?: string; prompt?: string }): void
}

declare global {
  interface Window {
    designStudioAgentHost?: DesignStudioAgentHost
    designStudioHost?: {
      updateProfile?: (profile: { name: string; avatarUrl?: string } | null) => void
      onChromeAction?: (listener: (action: string) => void) => () => void
      openFigmaLayer?: (payload: unknown) => void
      clearFigmaWebSession?: () => Promise<boolean>
    onOpenStudio?: (
        listener: (payload: {
          url?: string
          title?: string
          prompt?: string
          skill?: string
        }) => void,
      ) => () => void
    }
  }
}

export {}
