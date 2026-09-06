import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  session,
  shell,
  WebContentsView,
  type Session,
  type WebContents,
} from 'electron'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { startDesktopServer, type DesktopServer } from './server'
import { canNavigateFigmaOAuth } from './oauthNavigation'
import {
  DESKTOP_APP_ID,
  DESKTOP_PROTOCOL_VERSION,
} from '../server/desktopStatusPlugin'

const APP_NAME = '星序 Astrix'
const SERVER_ORIGIN = 'http://127.0.0.1:5273'
const HOME_TAB_ID = 'home'
const HOME_CHROME_HEIGHT = 48
const WORKSPACE_CHROME_HEIGHT = 88
const WORKSPACE_RAIL_WIDTH = 56
const DEFAULT_AGENT_WIDTH = 420
const MIN_FIGMA_WIDTH = 720
const MAX_RESTORED_TABS = 8
const FIGMA_PARTITION = 'persist:design-studio-figma'

const FIGMA_WEB_PREFS = {
  partition: FIGMA_PARTITION,
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: true,
  webSecurity: true,
} as const

type FigmaIntent =
  | { kind: 'new'; skill?: string; prompt?: string }
  | { kind: 'existing'; fileName?: string; url: string }

type OpenFigmaPayload = {
  url: string
  intent: FigmaIntent
}

type WorkspaceTab = {
  id: string
  kind: 'figma'
  title: string
  url: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  intent: FigmaIntent
  /** Changes only when a new homepage task is intentionally sent to this tab. */
  intentRevision: number
  view: WebContentsView
}

type PersistedWorkspace = {
  agentVisible?: boolean
  tabs?: Array<{
    title?: string
    url?: string
    intent?: FigmaIntent
  }>
}

import { sanitizeChromeProfile } from './chromeProfile'

let chromeProfile: ReturnType<typeof sanitizeChromeProfile> = null
let mainWindow: BrowserWindow | null = null
let homeView: WebContentsView | null = null
let agentView: WebContentsView | null = null
let activeTabId = HOME_TAB_ID
let agentVisible = true
let serverMode: 'embedded' | 'existing' = 'embedded'
let ownedServer: DesktopServer | null = null
let shellReady = false
let agentReady = false
let quitting = false

const tabs: WorkspaceTab[] = []
const visibleViews = new Set<WebContentsView>()
const authWindows = new Set<BrowserWindow>()
let pendingFigmaOpen: OpenFigmaPayload | null = null
let finishingOAuth = false
let continueOAuthInBrowser: (() => void) | null = null

function figmaBrowserSession() {
  return session.fromPartition(FIGMA_PARTITION)
}

const APP_SESSION_COOKIE = 'design_studio_figma_session'

async function copyPartitionCookies(
  from: Session,
  to: Session,
  url: string,
) {
  await from.cookies.flushStore()
  const cookies = await from.cookies.get({ url })
  await Promise.all(
    cookies.map(async (cookie) => {
      try {
        await to.cookies.set({
          url,
          name: cookie.name,
          value: cookie.value,
          path: cookie.path || '/',
          secure: Boolean(cookie.secure),
          httpOnly: Boolean(cookie.httpOnly),
          expirationDate: cookie.expirationDate,
          sameSite: cookie.sameSite === 'unspecified' ? 'lax' : cookie.sameSite,
        })
      } catch (error) {
        console.warn('Could not copy the Figma app cookie into the home session.', cookie.name, error)
      }
    }),
  )
}

async function waitForAppSessionCookie(from: Session) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const cookies = await from.cookies.get({
      url: SERVER_ORIGIN,
      name: APP_SESSION_COOKIE,
    })
    if (cookies.some((cookie) => cookie.value)) return true
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return false
}

async function appCookieHeader() {
  const cookies = await session.defaultSession.cookies.get({ url: SERVER_ORIGIN })
  if (cookies.length === 0) return ''
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ')
}

async function hasFigmaWebSession() {
  const cookies = await figmaBrowserSession().cookies.get({ url: 'https://www.figma.com' })
  return cookies.some((cookie) => {
    const name = cookie.name.toLowerCase()
    return name.includes('session') || name.includes('figma') || name.includes('auth')
  })
}

async function fetchOAuthAuthenticated() {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 1_200)
  try {
    const cookie = await appCookieHeader()
    const response = await fetch(`${SERVER_ORIGIN}/api/auth/figma/session`, {
      cache: 'no-store',
      signal: controller.signal,
      headers: cookie ? { Cookie: cookie } : undefined,
    })
    if (!response.ok) return false
    const payload = (await response.json()) as { authenticated?: boolean }
    return payload.authenticated === true
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}

async function clearFigmaWebSession() {
  const cookies = await figmaBrowserSession().cookies.get({ url: 'https://www.figma.com' })
  await Promise.all(
    cookies.map((cookie) =>
      figmaBrowserSession().cookies.remove('https://www.figma.com', cookie.name),
    ),
  )
}

async function ensureFigmaWebSession() {
  if (await hasFigmaWebSession()) return true
  if (!(await fetchOAuthAuthenticated())) return true
  openFigmaOAuthWindow(`${SERVER_ORIGIN}/api/auth/figma/start?returnTo=${encodeURIComponent('/')}`)
  return false
}

function flushPendingFigmaOpen() {
  if (!pendingFigmaOpen) return
  const next = pendingFigmaOpen
  pendingFigmaOpen = null
  void openFigmaWorkspaceAsync(next)
}

function appRoot() {
  return app.getAppPath()
}

function workspaceStatePath() {
  return join(app.getPath('userData'), 'workspace-state.json')
}

function preloadPath(fileName: string) {
  return join(appRoot(), 'dist-electron', fileName)
}

function isFigmaHostname(hostname: string) {
  const normalized = hostname.toLowerCase()
  return normalized === 'figma.com' || normalized.endsWith('.figma.com')
}

function normalizeFigmaUrl(value: unknown) {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value.trim())
    const hostname = url.hostname.toLowerCase()
    if (
      url.protocol !== 'https:'
      || (hostname !== 'figma.new' && !isFigmaHostname(hostname))
    ) {
      return null
    }
    return url.toString()
  } catch {
    return null
  }
}

function fileKeyFromUrl(value: string) {
  try {
    const url = new URL(value)
    if (!isFigmaHostname(url.hostname)) return null
    const segments = url.pathname.split('/').filter(Boolean)
    return ['design', 'file', 'proto', 'board', 'slides'].includes(
      segments[0]?.toLowerCase() ?? '',
    )
      ? segments[1] ?? null
      : null
  } catch {
    return null
  }
}

function normalizeFigmaNodeId(value: string | null | undefined) {
  if (!value) return null
  let decoded = value.trim()
  try {
    decoded = decodeURIComponent(decoded).trim()
  } catch {
    return null
  }
  if (!decoded) return null
  const urlForm = decoded.match(/^(\d+)-(\d+)$/)
  return urlForm ? `${urlForm[1]}:${urlForm[2]}` : decoded
}

function nodeIdFromUrl(value: string) {
  try {
    const url = new URL(value)
    const fromQuery = url.searchParams.get('node-id') ?? url.searchParams.get('node_id')
    if (fromQuery) return normalizeFigmaNodeId(fromQuery)

    const hash = url.hash.slice(1)
    if (!hash) return null
    const hashQuery = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : hash
    const hashParams = new URLSearchParams(hashQuery)
    return normalizeFigmaNodeId(
      hashParams.get('node-id') ?? hashParams.get('node_id'),
    )
  } catch {
    return null
  }
}

function sanitizeIntent(value: unknown, normalizedUrl: string): FigmaIntent {
  if (!value || typeof value !== 'object') {
    return { kind: 'existing', url: normalizedUrl }
  }
  const record = value as Record<string, unknown>
  if (record.kind === 'new') {
    return {
      kind: 'new',
      skill:
        typeof record.skill === 'string'
          ? record.skill.trim().slice(0, 80)
          : undefined,
      prompt:
        typeof record.prompt === 'string'
          ? record.prompt.trim().slice(0, 8_000)
          : undefined,
    }
  }
  return {
    kind: 'existing',
    url: normalizedUrl,
    fileName:
      typeof record.fileName === 'string'
        ? record.fileName.trim().slice(0, 160)
        : undefined,
  }
}

function sanitizeOpenPayload(value: unknown): OpenFigmaPayload | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const url = normalizeFigmaUrl(record.url)
  if (!url) return null
  return { url, intent: sanitizeIntent(record.intent, url) }
}

function addVisibleView(view: WebContentsView) {
  if (!mainWindow || visibleViews.has(view)) return
  mainWindow.contentView.addChildView(view)
  visibleViews.add(view)
}

function removeVisibleView(view: WebContentsView | null) {
  if (!view || !visibleViews.has(view)) return
  if (!mainWindow || mainWindow.isDestroyed()) {
    visibleViews.delete(view)
    return
  }
  mainWindow.contentView.removeChildView(view)
  visibleViews.delete(view)
}

function activeTab() {
  return tabs.find((tab) => tab.id === activeTabId) ?? null
}

function tabNavigationState(tab: WorkspaceTab) {
  const history = tab.view.webContents.navigationHistory
  tab.canGoBack = history.canGoBack()
  tab.canGoForward = history.canGoForward()
}

function shellState() {
  const active = activeTab()
  return {
    profile: chromeProfile,
    activeTabId,
    activeKind: active ? 'figma' : 'home',
    activeUrl: active?.url ?? `${SERVER_ORIGIN}/`,
    agentVisible,
    serverMode,
    tabs: [
      {
        id: HOME_TAB_ID,
        kind: 'home',
        title: '首页',
        url: `${SERVER_ORIGIN}/`,
        loading: false,
        canGoBack: false,
        canGoForward: false,
        closable: false,
      },
      ...tabs.map((tab) => ({
        id: tab.id,
        kind: tab.kind,
        title: tab.title,
        url: tab.url,
        loading: tab.loading,
        canGoBack: tab.canGoBack,
        canGoForward: tab.canGoForward,
        closable: true,
      })),
    ],
  }
}

function emitShellState() {
  if (!mainWindow || mainWindow.isDestroyed() || !shellReady) return
  mainWindow.webContents.send('desktop-shell:state', shellState())
}

function currentIntent() {
  return activeTab()?.intent ?? null
}

function emitAgentIntent() {
  if (!agentView || agentView.webContents.isDestroyed() || !agentReady) return
  agentView.webContents.send('desktop-agent:intent', currentIntent())
  agentView.webContents.send('desktop-agent:context', currentWorkspaceContext())
}

function currentWorkspaceContext() {
  const active = activeTab()
  if (!active) {
    return {
      tabId: HOME_TAB_ID,
      intent: null,
      intentRevision: 0,
      fileKey: null,
      nodeId: null,
      url: null,
      title: null,
    }
  }
  return {
    tabId: active.id,
    intent: active.intent,
    intentRevision: active.intentRevision,
    fileKey: fileKeyFromUrl(active.url),
    nodeId: nodeIdFromUrl(active.url),
    url: active.url,
    title: active.title,
  }
}

function persistWorkspace() {
  if (!app.isReady()) return
  const state: PersistedWorkspace = {
    agentVisible,
    tabs: tabs.slice(-MAX_RESTORED_TABS).map((tab) => ({
      title: tab.title,
      url: tab.url,
      intent: tab.intent,
    })),
  }
  try {
    mkdirSync(app.getPath('userData'), { recursive: true })
    writeFileSync(workspaceStatePath(), `${JSON.stringify(state, null, 2)}\n`, {
      mode: 0o600,
    })
  } catch {
    // Workspace restoration is a convenience; a write failure must not close the app.
  }
}

function readPersistedWorkspace(): PersistedWorkspace {
  try {
    if (!existsSync(workspaceStatePath())) return {}
    const value = JSON.parse(readFileSync(workspaceStatePath(), 'utf8')) as unknown
    return value && typeof value === 'object' ? (value as PersistedWorkspace) : {}
  } catch {
    return {}
  }
}

function layoutViews() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const [width, height] = mainWindow.getContentSize()
  const active = activeTab()

  if (!active) {
    for (const tab of tabs) removeVisibleView(tab.view)
    removeVisibleView(agentView)
    if (homeView) {
      addVisibleView(homeView)
      homeView.setBounds({
        x: 0,
        y: HOME_CHROME_HEIGHT,
        width,
        height: Math.max(0, height - HOME_CHROME_HEIGHT),
      })
    }
    return
  }

  removeVisibleView(homeView)
  for (const tab of tabs) {
    if (tab.id !== active.id) removeVisibleView(tab.view)
  }

  const availableHeight = Math.max(0, height - WORKSPACE_CHROME_HEIGHT)
  const maxAgentWidth = Math.max(0, width - WORKSPACE_RAIL_WIDTH - MIN_FIGMA_WIDTH)
  const panelWidth = agentVisible
    ? Math.max(320, Math.min(DEFAULT_AGENT_WIDTH, maxAgentWidth))
    : 0

  addVisibleView(active.view)
  active.view.setBounds({
    x: WORKSPACE_RAIL_WIDTH,
    y: WORKSPACE_CHROME_HEIGHT,
    width: Math.max(0, width - WORKSPACE_RAIL_WIDTH - panelWidth),
    height: availableHeight,
  })

  if (agentVisible && agentView && panelWidth > 0) {
    addVisibleView(agentView)
    agentView.setBounds({
      x: width - panelWidth,
      y: WORKSPACE_CHROME_HEIGHT,
      width: panelWidth,
      height: availableHeight,
    })
  } else {
    removeVisibleView(agentView)
  }
}

function activateTab(tabId: string) {
  if (tabId !== HOME_TAB_ID && !tabs.some((tab) => tab.id === tabId)) return
  activeTabId = tabId
  layoutViews()
  emitShellState()
  emitAgentIntent()
}

function recordRecentFigma(tab: WorkspaceTab) {
  if (!fileKeyFromUrl(tab.url)) return
  void fetch(`${SERVER_ORIGIN}/api/local/figma-recents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: tab.url, title: tab.title }),
  }).catch(() => {})
}

function extractFigmaTeamIds(value: string) {
  const ids: string[] = []
  const seen = new Set<string>()
  for (const match of value.matchAll(/\/(?:files\/)?team\/(\d{5,32})(?=[/?#]|$)/gi)) {
    const id = match[1]
    if (seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  return ids
}

function rememberTeamIdsFromUrl(url: string) {
  const teamIds = extractFigmaTeamIds(url)
  if (teamIds.length === 0) return
  void fetch(`${SERVER_ORIGIN}/api/auth/figma/library/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ teamIds, merge: true }),
  }).catch(() => {})
}

function pluginBridgeManifestPath() {
  const packaged = join(process.resourcesPath, 'figma-plugin-bridge', 'manifest.json')
  if (existsSync(packaged)) return packaged
  return join(appRoot(), 'figma-plugin-bridge', 'manifest.json')
}

function revealBridgePlugin() {
  const manifest = pluginBridgeManifestPath()
  if (!existsSync(manifest)) {
    void dialog.showMessageBox({
      type: 'warning',
      title: '找不到 Design Studio Bridge',
      message: '没有找到插件 manifest.json。',
      detail: '开发模式请确认 客户端/figma-plugin-bridge 目录存在。',
    })
    return
  }
  shell.showItemInFolder(manifest)
}

function updateTabLocation(tab: WorkspaceTab, url: string) {
  const normalized = normalizeFigmaUrl(url)
  if (normalized) tab.url = normalized
  tabNavigationState(tab)
  emitShellState()
  if (tab.id === activeTabId) emitAgentIntent()
  persistWorkspace()
  recordRecentFigma(tab)
  rememberTeamIdsFromUrl(tab.url)
}

function chromiumUserAgent(contents: WebContents) {
  return contents
    .getUserAgent()
    .replace(/\sElectron\/[^\s]+/g, '')
    .replace(new RegExp(`\\s${APP_NAME.replace(/\s/g, '\\s')}\/[^\\s]+`, 'g'), '')
}

function isSafeExternalUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'mailto:'
  } catch {
    return false
  }
}

function isLocalAppUrl(value: string) {
  try {
    return new URL(value).origin === SERVER_ORIGIN
  } catch {
    return false
  }
}

function isFigmaOAuthStartUrl(value: string) {
  try {
    const url = new URL(value)
    return url.origin === SERVER_ORIGIN
      && url.pathname === '/api/auth/figma/start'
  } catch {
    return false
  }
}

async function completeOAuthReturn(value: string, oauthWindow: BrowserWindow) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return
  }
  if (url.origin !== SERVER_ORIGIN || !url.searchParams.has('figma_auth')) return
  if (finishingOAuth || oauthWindow.isDestroyed()) return
  finishingOAuth = true
  try {
    const figmaSession = figmaBrowserSession()
    if (url.searchParams.get('figma_auth') === 'connected') {
      await waitForAppSessionCookie(figmaSession)
    }
    await copyPartitionCookies(figmaSession, session.defaultSession, SERVER_ORIGIN)
    const nextUrl = `${SERVER_ORIGIN}${url.pathname}${url.search}${url.hash}`
    const showInAgent = url.pathname === '/agent' || url.pathname.startsWith('/agent/')
    if (showInAgent) {
      if (agentView && !agentView.webContents.isDestroyed()) {
        void agentView.webContents.loadURL(nextUrl)
      }
      if (homeView && !homeView.webContents.isDestroyed()) {
        homeView.webContents.reload()
      }
    } else {
      if (homeView && !homeView.webContents.isDestroyed()) {
        void homeView.webContents.loadURL(nextUrl)
      }
      if (agentView && !agentView.webContents.isDestroyed()) {
        agentView.webContents.reload()
      }
    }
    flushPendingFigmaOpen()
  } finally {
    if (!oauthWindow.isDestroyed()) oauthWindow.close()
    finishingOAuth = false
  }
}

function openFigmaOAuthWindow(startUrl: string, browserOnly = false) {
  if (!isFigmaOAuthStartUrl(startUrl)) return
  const oauthWindow = new BrowserWindow({
    parent: mainWindow ?? undefined,
    width: 860,
    height: 900,
    minWidth: 480,
    minHeight: 600,
    show: false,
    title: '连接 Figma',
    backgroundColor: '#ffffff',
    webPreferences: {
      ...FIGMA_WEB_PREFS,
    },
  })
  let browserMode = browserOnly
  let fallbackPromptOpen = false
  const useBrowser = () => {
    if (oauthWindow.isDestroyed()) return
    browserMode = true
    const handoffUrl = new URL(startUrl)
    handoffUrl.searchParams.set('handoff', '1')
    void oauthWindow.loadURL(handoffUrl.toString()).catch(() => {})
    oauthWindow.show()
  }
  const offerBrowser = async () => {
    if (browserMode || fallbackPromptOpen || oauthWindow.isDestroyed()) return
    fallbackPromptOpen = true
    const result = await dialog.showMessageBox(oauthWindow, {
      type: 'info',
      title: '在浏览器中继续授权',
      message: '当前登录方式无法在客户端授权窗口中完成。',
      detail: '可切换到系统浏览器，授权完成后仍会自动连接客户端。不会绕过登录或安全检查。',
      buttons: ['使用浏览器', '留在此窗口'],
      defaultId: 0,
      cancelId: 1,
    })
    fallbackPromptOpen = false
    if (result.response === 0) useBrowser()
  }
  continueOAuthInBrowser = useBrowser
  authWindows.add(oauthWindow)
  oauthWindow.on('closed', () => {
    authWindows.delete(oauthWindow)
    if (continueOAuthInBrowser === useBrowser) continueOAuthInBrowser = null
  })

  const allowOAuthNavigation = (event: Electron.Event, value: string) => {
    if (browserMode ? isLocalAppUrl(value) : canNavigateFigmaOAuth(value, SERVER_ORIGIN)) return
    event.preventDefault()
    if (!browserMode) void offerBrowser()
  }

  oauthWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const target = new URL(url)
      if (browserMode && target.origin === 'https://www.figma.com' && target.pathname === '/oauth') {
        void shell.openExternal(url)
      } else if (!browserMode && target.protocol === 'https:') {
        // Federated sign-in should use the system browser, never a spoofed user agent.
        void offerBrowser()
      }
    } catch {
      // Block malformed popup URLs.
    }
    return { action: 'deny' }
  })
  oauthWindow.webContents.on('did-create-window', (window) => secureAuthWindow(window))

  const onOAuthLocation = (_event: unknown, value: string) => {
    void completeOAuthReturn(value, oauthWindow)
  }
  oauthWindow.webContents.on('will-navigate', allowOAuthNavigation)
  oauthWindow.webContents.on('will-redirect', allowOAuthNavigation)
  oauthWindow.webContents.on('did-navigate', onOAuthLocation)
  oauthWindow.webContents.on('did-finish-load', () => {
    void completeOAuthReturn(oauthWindow.webContents.getURL(), oauthWindow)
  })
  oauthWindow.webContents.on('did-navigate', (_event, _url, statusCode) => {
    if (statusCode >= 400) void offerBrowser()
  })
  oauthWindow.webContents.on('did-fail-load', (_event, errorCode, _description, _url, isMainFrame) => {
    if (isMainFrame && errorCode !== -3) void offerBrowser()
  })
  oauthWindow.once('ready-to-show', () => oauthWindow.show())
  if (browserOnly) useBrowser()
  else {
    const nativeUrl = new URL(startUrl)
    nativeUrl.searchParams.set('direct', '1')
    void oauthWindow.loadURL(nativeUrl.toString()).catch(() => { void offerBrowser() })
  }
}

function secureAuthWindow(window: BrowserWindow) {
  authWindows.add(window)
  window.on('closed', () => authWindows.delete(window))
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    try {
      if (new URL(url).protocol === 'https:') return
    } catch {
      // Fall through and block malformed URLs.
    }
    event.preventDefault()
  })
}

function secureFigmaContents(contents: WebContents) {
  contents.setUserAgent(chromiumUserAgent(contents))
  contents.on('will-navigate', (event, url) => {
    const normalized = normalizeFigmaUrl(url)
    if (normalized) return
    event.preventDefault()
    if (isSafeExternalUrl(url)) void shell.openExternal(url)
  })
  contents.setWindowOpenHandler(({ url }) => {
    const normalized = normalizeFigmaUrl(url)
    if (normalized) {
      const key = fileKeyFromUrl(normalized)
      if (key) {
        openFigmaWorkspace({
          url: normalized,
          intent: { kind: 'existing', url: normalized },
        })
        return { action: 'deny' }
      }
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          parent: mainWindow ?? undefined,
          width: 560,
          height: 760,
          show: true,
          webPreferences: {
            ...FIGMA_WEB_PREFS,
          },
        },
      }
    }

    try {
      const parsed = new URL(url)
      if (parsed.protocol === 'https:') {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            parent: mainWindow ?? undefined,
            width: 560,
            height: 760,
            show: true,
            webPreferences: {
              ...FIGMA_WEB_PREFS,
            },
          },
        }
      }
    } catch {
      // Block malformed popup URLs.
    }
    return { action: 'deny' }
  })
  contents.on('did-create-window', (window) => secureAuthWindow(window))
}

function makeFigmaView(tab: Omit<WorkspaceTab, 'view'>) {
  const view = new WebContentsView({
    webPreferences: {
      ...FIGMA_WEB_PREFS,
      webviewTag: false,
    },
  })
  view.setBackgroundColor('#f5f5f5')
  secureFigmaContents(view.webContents)

  const workspaceTab: WorkspaceTab = { ...tab, view }
  view.webContents.on('did-start-loading', () => {
    workspaceTab.loading = true
    emitShellState()
  })
  view.webContents.on('did-stop-loading', () => {
    workspaceTab.loading = false
    tabNavigationState(workspaceTab)
    emitShellState()
  })
  view.webContents.on('page-title-updated', (_event, title) => {
    const cleaned = title.replace(/\s*[–—-]\s*Figma\s*$/i, '').trim()
    if (cleaned) workspaceTab.title = cleaned.slice(0, 160)
    emitShellState()
    persistWorkspace()
    recordRecentFigma(workspaceTab)
  })
  view.webContents.on('did-navigate', (_event, url) => {
    updateTabLocation(workspaceTab, url)
  })
  view.webContents.on('did-navigate-in-page', (_event, url) => {
    updateTabLocation(workspaceTab, url)
  })
  view.webContents.on('did-fail-load', (
    _event,
    code,
    description,
    _validatedUrl,
    isMainFrame,
  ) => {
    if (!isMainFrame || code === -3) return
    workspaceTab.loading = false
    workspaceTab.title = `加载失败：${description}`
    emitShellState()
  })
  void view.webContents.loadURL(tab.url)
  return workspaceTab
}

function openFigmaWorkspace(payload: OpenFigmaPayload) {
  void openFigmaWorkspaceAsync(payload)
}

async function openFigmaWorkspaceAsync(payload: OpenFigmaPayload) {
  const normalizedPayload = sanitizeOpenPayload(payload)
  if (!normalizedPayload) return

  const ready = await ensureFigmaWebSession()
  if (!ready) {
    pendingFigmaOpen = normalizedPayload
    return
  }

  openFigmaWorkspaceNow(normalizedPayload)
}

function openFigmaWorkspaceNow(normalizedPayload: OpenFigmaPayload) {
  agentVisible = true
  const fileKey = fileKeyFromUrl(normalizedPayload.url)
  const reuseExisting = normalizedPayload.intent.kind !== 'new' && fileKey
    ? tabs.find((tab) => fileKeyFromUrl(tab.url) === fileKey)
    : null
  if (reuseExisting) {
    reuseExisting.intent = normalizedPayload.intent
    reuseExisting.intentRevision += 1
    activateTab(reuseExisting.id)
    emitAgentIntent()
    return
  }

  const title =
    normalizedPayload.intent.kind === 'existing'
      ? normalizedPayload.intent.fileName || 'Figma 设计稿'
      : '新建设计稿'
  const tab = makeFigmaView({
    id: randomUUID(),
    kind: 'figma',
    title,
    url: normalizedPayload.url,
    loading: true,
    canGoBack: false,
    canGoForward: false,
    intent: normalizedPayload.intent,
    intentRevision: 1,
  })
  tabs.push(tab)
  activateTab(tab.id)
  persistWorkspace()
}

function closeTab(tabId: string) {
  const index = tabs.findIndex((tab) => tab.id === tabId)
  if (index < 0) return
  const [tab] = tabs.splice(index, 1)
  removeVisibleView(tab.view)
  if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close()

  if (activeTabId === tabId) {
    const replacement = tabs[index] ?? tabs[index - 1]
    activeTabId = replacement?.id ?? HOME_TAB_ID
  }
  layoutViews()
  emitShellState()
  emitAgentIntent()
  persistWorkspace()
}

function closeActiveTabOrWindow() {
  const active = activeTab()
  if (active) closeTab(active.id)
  else mainWindow?.close()
}

function goBack() {
  const active = activeTab()
  if (active?.view.webContents.navigationHistory.canGoBack()) {
    active.view.webContents.navigationHistory.goBack()
  }
}

function goForward() {
  const active = activeTab()
  if (active?.view.webContents.navigationHistory.canGoForward()) {
    active.view.webContents.navigationHistory.goForward()
  }
}

function reloadActive() {
  const active = activeTab()
  const contents = active?.view.webContents ?? homeView?.webContents
  if (!contents) return
  if (contents.isLoading()) contents.stop()
  else contents.reload()
}

function toggleAgent() {
  if (!activeTab()) return
  agentVisible = !agentVisible
  layoutViews()
  emitShellState()
  persistWorkspace()
}

function configureFigmaSession() {
  const figmaSession = figmaBrowserSession()
  figmaSession.setPermissionRequestHandler((contents, permission, callback) => {
    const allowedPermissions = new Set([
      'clipboard-read',
      'clipboard-sanitized-write',
      'fullscreen',
    ])
    let trustedOrigin = false
    try {
      trustedOrigin = isFigmaHostname(new URL(contents.getURL()).hostname)
    } catch {
      trustedOrigin = false
    }
    callback(trustedOrigin && allowedPermissions.has(permission))
  })
}

function createHomeView() {
  const view = new WebContentsView({
    webPreferences: {
      preload: preloadPath('preload-home.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  })
  view.setBackgroundColor('#f7f8fa')
  view.webContents.on('will-navigate', (event, url) => {
    if (isFigmaOAuthStartUrl(url)) {
      event.preventDefault()
      openFigmaOAuthWindow(url)
      return
    }
    if (isLocalAppUrl(url)) return
    event.preventDefault()
    const normalized = normalizeFigmaUrl(url)
    if (normalized) {
      openFigmaWorkspace({
        url: normalized,
        intent: { kind: 'existing', url: normalized },
      })
    } else if (isSafeExternalUrl(url)) {
      void shell.openExternal(url)
    }
  })
  view.webContents.on('will-redirect', (event, url) => {
    if (!isFigmaOAuthStartUrl(url)) return
    event.preventDefault()
    openFigmaOAuthWindow(url)
  })
  view.webContents.setWindowOpenHandler(({ url }) => {
    const normalized = normalizeFigmaUrl(url)
    if (normalized) {
      openFigmaWorkspace({
        url: normalized,
        intent: { kind: 'existing', url: normalized },
      })
    } else if (isSafeExternalUrl(url)) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })
  void view.webContents.loadURL(`${SERVER_ORIGIN}/`)
  return view
}

function createAgentView() {
  const view = new WebContentsView({
    webPreferences: {
      preload: preloadPath('preload-agent.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  })
  view.setBackgroundColor('#ffffff')
  view.webContents.on('did-finish-load', () => {
    agentReady = true
    emitAgentIntent()
  })
  view.webContents.on('will-navigate', (event, url) => {
    if (isFigmaOAuthStartUrl(url)) {
      event.preventDefault()
      openFigmaOAuthWindow(url)
      return
    }
    if (isLocalAppUrl(url)) return
    event.preventDefault()
    if (isSafeExternalUrl(url)) void shell.openExternal(url)
  })
  view.webContents.on('will-redirect', (event, url) => {
    if (!isFigmaOAuthStartUrl(url)) return
    event.preventDefault()
    openFigmaOAuthWindow(url)
  })
  view.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  void view.webContents.loadURL(`${SERVER_ORIGIN}/agent`)
  return view
}

function restoreTabs() {
  const restored = readPersistedWorkspace()
  agentVisible = restored.agentVisible !== false
  for (const value of (restored.tabs ?? []).slice(-MAX_RESTORED_TABS)) {
    const url = normalizeFigmaUrl(value.url)
    if (!url) continue
    const intent = sanitizeIntent(value.intent, url)
    const tab = makeFigmaView({
      id: randomUUID(),
      kind: 'figma',
      title:
        typeof value.title === 'string' && value.title.trim()
          ? value.title.trim().slice(0, 160)
          : 'Figma 设计稿',
      url,
      loading: true,
      canGoBack: false,
      canGoForward: false,
      intent,
      intentRevision: 1,
    })
    tabs.push(tab)
  }
}

function destroyWorkspaceViews() {
  for (const view of [homeView, agentView, ...tabs.map((tab) => tab.view)]) {
    if (!view) continue
    removeVisibleView(view)
    if (!view.webContents.isDestroyed()) view.webContents.close()
  }
  homeView = null
  agentView = null
  tabs.splice(0, tabs.length)
  visibleViews.clear()
  activeTabId = HOME_TAB_ID
  shellReady = false
  agentReady = false
}

function registerIpc() {
  ipcMain.on('desktop-profile:update', (event, value: unknown) => {
    if (event.sender !== homeView?.webContents && event.sender !== agentView?.webContents) return
    chromeProfile = sanitizeChromeProfile(value)
    emitShellState()
  })
  ipcMain.on('desktop-home:open-figma', (event, payload: unknown) => {
    if (!homeView || event.sender !== homeView.webContents) return
    const sanitized = sanitizeOpenPayload(payload)
    if (sanitized) openFigmaWorkspace(sanitized)
  })

  ipcMain.handle('desktop-home:clear-figma-session', async (event) => {
    if (!homeView || event.sender !== homeView.webContents) return false
    await clearFigmaWebSession()
    pendingFigmaOpen = null
    return true
  })

  ipcMain.on('desktop-shell:action', (event, action: unknown, value: unknown) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) return
    if (action === 'go-home' || action === 'open-settings' || action === 'open-account') {
      activateTab(HOME_TAB_ID)
      homeView?.webContents.send('desktop-home:chrome-action', action)
      return
    }
    if (action === 'activate-tab' && typeof value === 'string') activateTab(value)
    else if (action === 'close-tab' && typeof value === 'string') closeTab(value)
    else if (action === 'new-figma') {
      openFigmaWorkspace({
        url: 'https://figma.new',
        intent: { kind: 'new' },
      })
    } else if (action === 'back') goBack()
    else if (action === 'forward') goForward()
    else if (action === 'reload') reloadActive()
    else if (action === 'toggle-agent') toggleAgent()
    else if (action === 'install-bridge') revealBridgePlugin()
    else if (action === 'focus-layers') {
      agentView?.webContents.send('desktop-agent:ui-action', 'close-menu')
      activeTab()?.view.webContents.focus()
    } else if (action === 'open-skills' && activeTab()) {
      agentVisible = true
      layoutViews()
      emitShellState()
      agentView?.webContents.send('desktop-agent:ui-action', 'skills')
      agentView?.webContents.focus()
    }
  })

  ipcMain.on('desktop-agent:hide', (event) => {
    if (!agentView || event.sender !== agentView.webContents) return
    agentVisible = false
    layoutViews()
    emitShellState()
  })

  ipcMain.handle('desktop-agent:get-intent', (event) => {
    if (!agentView || event.sender !== agentView.webContents) return null
    return currentIntent()
  })
  ipcMain.on('desktop-agent:install-bridge', (event) => {
    if (!agentView || event.sender !== agentView.webContents) return
    revealBridgePlugin()
  })
  ipcMain.handle('desktop-agent:get-context', (event) => {
    if (!agentView || event.sender !== agentView.webContents) return null
    return currentWorkspaceContext()
  })
  ipcMain.on('desktop-agent:open-new-canvas', (event, payload: unknown) => {
    if (!agentView || event.sender !== agentView.webContents) return
    const record = payload && typeof payload === 'object'
      ? payload as Record<string, unknown>
      : {}
    const intent = sanitizeIntent(
      { kind: 'new', skill: record.skill, prompt: record.prompt },
      'https://figma.new',
    )
    openFigmaWorkspace({
      url: 'https://figma.new',
      intent: intent.kind === 'new' ? intent : { kind: 'new' },
    })
  })
}

function buildApplicationMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: APP_NAME,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: '文件',
      submenu: [
        {
          label: '新建 Figma 设计稿',
          accelerator: 'CommandOrControl+T',
          click: () =>
            openFigmaWorkspace({
              url: 'https://figma.new',
              intent: { kind: 'new' },
            }),
        },
        {
          label: '安装 Design Studio Bridge',
          click: revealBridgePlugin,
        },
        {
          label: '连接 Figma（客户端窗口）',
          click: () => openFigmaOAuthWindow(`${SERVER_ORIGIN}/api/auth/figma/start?returnTo=%2F`),
        },
        {
          label: '在浏览器中继续 Figma 授权',
          accelerator: 'CommandOrControl+Shift+B',
          click: () => {
            if (continueOAuthInBrowser) continueOAuthInBrowser()
            else openFigmaOAuthWindow(`${SERVER_ORIGIN}/api/auth/figma/start?returnTo=%2F`, true)
          },
        },
        {
          label: '关闭当前标签',
          accelerator: 'CommandOrControl+W',
          click: closeActiveTabOrWindow,
        },
      ],
    },
    { role: 'editMenu' },
    {
      label: '显示',
      submenu: [
        {
          label: '刷新',
          accelerator: 'CommandOrControl+R',
          click: reloadActive,
        },
        {
          label: '后退',
          accelerator: 'CommandOrControl+[',
          click: goBack,
        },
        {
          label: '前进',
          accelerator: 'CommandOrControl+]',
          click: goForward,
        },
        { type: 'separator' },
        {
          label: '显示或隐藏 Agent',
          accelerator: 'CommandOrControl+\\',
          click: toggleAgent,
        },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' as const }]),
      ],
    },
    { role: 'windowMenu' },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createWorkspaceWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1180,
    minHeight: 720,
    show: false,
    backgroundColor: '#f7f8fa',
    title: APP_NAME,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 17 },
    webPreferences: {
      preload: preloadPath('preload-shell.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
    },
  })

  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault())
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('did-finish-load', () => {
    shellReady = true
    emitShellState()
  })
  mainWindow.on('resize', layoutViews)
  mainWindow.on('closed', () => {
    mainWindow = null
    destroyWorkspaceViews()
  })

  homeView = createHomeView()
  agentView = createAgentView()
  restoreTabs()
  layoutViews()

  void mainWindow.loadFile(join(appRoot(), 'desktop', 'renderer', 'shell.html'))
  mainWindow.once('ready-to-show', () => mainWindow?.show())
}

async function compatibleServerAlreadyRunning() {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 1_200)
  try {
    const response = await fetch(`${SERVER_ORIGIN}/api/desktop/status`, {
      cache: 'no-store',
      signal: controller.signal,
    })
    if (!response.ok) return false
    const payload = (await response.json()) as Record<string, unknown>
    return payload.ok === true
      && payload.app === DESKTOP_APP_ID
      && payload.protocolVersion === DESKTOP_PROTOCOL_VERSION
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}

async function ensureDesktopServer() {
  if (await compatibleServerAlreadyRunning()) {
    serverMode = 'existing'
    return
  }
  ownedServer = await startDesktopServer({
    appRoot: appRoot(),
    dataDirectory: join(app.getPath('userData'), 'data'),
    agentResourcesDirectory: app.isPackaged
      ? join(process.resourcesPath, 'agent-resources')
      : appRoot(),
  })
  serverMode = 'embedded'
}

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })

  app.on('before-quit', () => {
    quitting = true
    persistWorkspace()
    if (ownedServer) void ownedServer.close().catch(() => {})
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('activate', () => {
    if (!mainWindow && !quitting) createWorkspaceWindow()
  })

  void app.whenReady().then(async () => {
    // Keep the existing data/cookie directory when changing display branding.
    const existingUserData = app.getPath('userData')
    app.setName(APP_NAME)
    app.setPath('userData', existingUserData)
    // Set the running Dock tile explicitly; macOS can retain an older bundle icon.
    if (process.platform === 'darwin') {
      app.dock?.setIcon(join(appRoot(), 'desktop', 'renderer', 'assets', 'astrix-dock.png'))
    }
    app.userAgentFallback = app.userAgentFallback
      .replace(/\sElectron\/[^\s]+/g, '')
      .replace(new RegExp(`\\s${APP_NAME.replace(/\s/g, '\\s')}\/[^\\s]+`, 'g'), '')
    try {
      await ensureDesktopServer()
      configureFigmaSession()
      await copyPartitionCookies(
        figmaBrowserSession(),
        session.defaultSession,
        SERVER_ORIGIN,
      )
      registerIpc()
      buildApplicationMenu()
      createWorkspaceWindow()
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      await dialog.showMessageBox({
        type: 'error',
        title: `${APP_NAME} 无法启动`,
        message: '本地服务启动失败',
        detail:
          `${detail}\n\n请确认 127.0.0.1:5273 没有被其他程序占用，然后重新打开应用。`,
      })
      app.quit()
    }
  })
}
