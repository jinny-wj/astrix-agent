export type FigmaAuthUser = {
  id: string
  name: string
  email: string
  avatarUrl: string
}

export type FigmaAuthSession = {
  configured: boolean
  authenticated: boolean
  user: FigmaAuthUser | null
}

const FIGMA_SESSION_CHANGED = 'design-studio:figma-session-changed'

export function onFigmaAuthSessionChange(listener: () => void) {
  const onMessage = (event: MessageEvent) => {
    if (event.origin === window.location.origin && event.data?.type === 'design-studio:figma-auth') {
      listener()
    }
  }
  const onVisible = () => {
    if (document.visibilityState === 'visible') listener()
  }
  window.addEventListener('focus', listener)
  window.addEventListener('message', onMessage)
  window.addEventListener(FIGMA_SESSION_CHANGED, listener)
  document.addEventListener('visibilitychange', onVisible)
  return () => {
    window.removeEventListener('focus', listener)
    window.removeEventListener('message', onMessage)
    window.removeEventListener(FIGMA_SESSION_CHANGED, listener)
    document.removeEventListener('visibilitychange', onVisible)
  }
}

export async function getFigmaAuthSession(): Promise<FigmaAuthSession> {
  const response = await fetch('/api/auth/figma/session', {
    credentials: 'same-origin',
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error('暂时无法读取 Figma 授权状态')
  }

  return response.json() as Promise<FigmaAuthSession>
}

function currentReturnTo() {
  const url = new URL(window.location.href)
  url.searchParams.delete('figma_auth')
  if (url.pathname === '/api/auth/figma' || url.pathname.startsWith('/api/auth/figma/')) {
    return '/'
  }
  return `${url.pathname}${url.search}${url.hash}`
}

export function startFigmaOAuth(returnTo = currentReturnTo(), selectAccount = false) {
  const safeReturnTo =
    returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/'
  const query = new URLSearchParams({ returnTo: safeReturnTo })
  if (selectAccount) query.set('select_account', '1')
  const url = `/api/auth/figma/start?${query.toString()}`
  if (window.designStudioHost || window.designStudioAgentHost) {
    window.location.assign(url)
    return
  }
  const popup = window.open(url, 'design-studio-figma-auth', 'popup,width=620,height=760')
  if (!popup) window.location.assign(url)
}

export const FIGMA_AUTH_RESULT_MESSAGES: Record<string, string> = {
  access_denied: '你取消了 Figma 授权。',
  invalid_state: '授权中断了，请再选一次账号。',
  exchange_failed: 'Figma 授权没有完成，请再试一次。',
  expired: '授权等待已超时，请重新连接 Figma。',
  unavailable: 'Figma 授权服务尚未就绪，请联系应用维护者完成连接配置。',
}

export function consumeFigmaAuthResult() {
  const url = new URL(window.location.href)
  const result = url.searchParams.get('figma_auth')
  if (!result) return null
  url.searchParams.delete('figma_auth')
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
  return result
}

export async function disconnectFigma() {
  const response = await fetch('/api/auth/figma/session', {
    method: 'DELETE',
    credentials: 'same-origin',
  })

  if (!response.ok) {
    throw new Error('解绑 Figma 账号失败')
  }
  window.dispatchEvent(new Event(FIGMA_SESSION_CHANGED))
}
