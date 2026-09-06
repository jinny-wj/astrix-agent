import { beginNewWorkspaceFile, type WorkspaceDraft, type WorkspaceFile } from './workspace'
import { rememberFigmaTeamIdsFromUrl } from '../services/figmaLibrary'

/** 当前浏览器工作台默认打开的真实 Figma Design 文件。 */
export const FIGMA_DESIGN_URL =
  'https://www.figma.com/design/JGOGsieGjQvYFfeI06v51p?node-id=2-18'

/** Figma 官方的 Drafts 新建设计稿快捷入口。 */
export const FIGMA_NEW_DESIGN_URL = 'https://figma.new'

export const FIGMA_WORKSPACE_MESSAGE_SOURCE = 'design-studio-web'

export type FigmaWorkspaceIntent =
  | {
      kind: 'new'
      skill?: string
      prompt?: string
    }
  | {
      kind: 'existing'
      fileName?: string
      url: string
    }

export type FigmaWorkspaceLaunch = {
  surface: 'desktop-layer' | 'figma-tab'
  file: WorkspaceFile | null
  url: string
}

const WORKSPACE_INTENT_KEY = 'design-studio:figma-workspace-intent'

type DesktopFigmaHost = {
  openFigmaLayer: (payload: {
    url: string
    intent: FigmaWorkspaceIntent
  }) => void
}

type HostWindow = Window & {
  designStudioHost?: DesktopFigmaHost
}

function requestBrowserFigmaWorkspace(
  intent: FigmaWorkspaceIntent,
  url: string,
  requestId: string,
) {
  window.postMessage(
    {
      source: FIGMA_WORKSPACE_MESSAGE_SOURCE,
      type: 'OPEN_FIGMA_WORKSPACE',
      intent,
      url,
      requestId,
    },
    window.location.origin,
  )
}

export function pingBrowserExtension(timeoutMs = 800) {
  return new Promise<boolean>((resolve) => {
    const requestId =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `ping-${Date.now()}`

    const timer = window.setTimeout(() => {
      cleanup()
      resolve(false)
    }, timeoutMs)

    const cleanup = () => {
      window.clearTimeout(timer)
      window.removeEventListener('message', onReply)
    }

    const onReply = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) return
      const data = event.data as Record<string, unknown> | null
      if (!data || data.source !== 'design-studio-extension') return
      if (data.type !== 'EXTENSION_STATUS') return
      cleanup()
      resolve(Boolean(data.ok))
    }

    window.addEventListener('message', onReply)
    window.postMessage(
      {
        source: FIGMA_WORKSPACE_MESSAGE_SOURCE,
        type: 'PING_EXTENSION',
        requestId,
      },
      window.location.origin,
    )
  })
}

export function openFigmaInBrowser(url: string) {
  const intent = getPendingFigmaWorkspaceIntent()
  const requestId =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `open-${Date.now()}`

  return new Promise<boolean>((resolve) => {
    const timer = window.setTimeout(() => {
      cleanup()
      window.location.assign(url)
      resolve(false)
    }, 1_500)

    const cleanup = () => {
      window.clearTimeout(timer)
      window.removeEventListener('message', onReply)
    }

    const onReply = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) return
      const data = event.data as Record<string, unknown> | null
      if (!data || data.source !== 'design-studio-extension') return
      if (data.type !== 'FIGMA_WORKSPACE_READY') return
      if (data.requestId !== requestId) return
      cleanup()
      const ok = Boolean(data.ok)
      if (!ok) window.location.assign(url)
      resolve(ok)
    }

    window.addEventListener('message', onReply)
    if (intent) requestBrowserFigmaWorkspace(intent, url, requestId)
    else requestBrowserFigmaWorkspace({ kind: 'new' }, url, requestId)
  })
}

export function prepareFigmaWorkspace(intent: FigmaWorkspaceIntent) {
  sessionStorage.setItem(WORKSPACE_INTENT_KEY, JSON.stringify(intent))
}

export function getPendingFigmaWorkspaceIntent(): FigmaWorkspaceIntent | null {
  const serialized = sessionStorage.getItem(WORKSPACE_INTENT_KEY)
  if (!serialized) return null

  try {
    return JSON.parse(serialized) as FigmaWorkspaceIntent
  } catch {
    return null
  }
}

function launchFigmaWorkspace(
  url: string,
  intent: FigmaWorkspaceIntent,
  file: WorkspaceFile | null,
): FigmaWorkspaceLaunch {
  prepareFigmaWorkspace(intent)
  void rememberFigmaTeamIdsFromUrl(url)
  const desktopHost = (window as HostWindow).designStudioHost
  if (desktopHost?.openFigmaLayer) {
    desktopHost.openFigmaLayer({ url, intent })
    return { surface: 'desktop-layer', file, url }
  }
  return { surface: 'figma-tab', file, url }
}

/**
 * 浏览器同页进 figma.com（扩展挂 Agent）；桌面客户端在应用内创建 Figma 标签。
 */
export function activateFigmaLink(
  url: string,
  intent: FigmaWorkspaceIntent,
) {
  const file = intent.kind === 'new'
    ? beginNewWorkspaceFile({ prompt: intent.prompt ?? '', skill: intent.skill })
    : null
  return launchFigmaWorkspace(url, intent, file)
}

export function openFigmaSurface(
  url: string,
  intent: FigmaWorkspaceIntent,
) {
  const file = intent.kind === 'new'
    ? beginNewWorkspaceFile({ prompt: intent.prompt ?? '', skill: intent.skill })
    : null
  return launchFigmaWorkspace(url, intent, file)
}

export function openFigmaDesign(
  intent: Extract<FigmaWorkspaceIntent, { kind: 'existing' }> = {
    kind: 'existing',
    url: FIGMA_DESIGN_URL,
  },
) {
  return launchFigmaWorkspace(intent.url, intent, null)
}

export function openNewFigmaDesign({
  skill,
  prompt,
  attachments,
}: {
  skill?: string
  prompt?: string
  attachments?: WorkspaceDraft['attachments']
} = {}) {
  const draft: WorkspaceDraft = { prompt: prompt ?? '', skill, attachments }
  const intent: FigmaWorkspaceIntent = { kind: 'new', skill, prompt: draft.prompt }
  const file = beginNewWorkspaceFile(draft)
  return launchFigmaWorkspace(FIGMA_NEW_DESIGN_URL, intent, file)
}

/** 首页点功能：客户端嵌真实 Figma + 右侧 Agent；浏览器同页进 figma.com，扩展挂 Agent。 */
export function openNewFileFromHomepage(draft: WorkspaceDraft) {
  const file = beginNewWorkspaceFile(draft)
  const intent: FigmaWorkspaceIntent = {
    kind: 'new',
    skill: draft.skill,
    prompt: draft.prompt,
  }
  const launched = launchFigmaWorkspace(FIGMA_NEW_DESIGN_URL, intent, file)
  return { ...launched, file }
}
