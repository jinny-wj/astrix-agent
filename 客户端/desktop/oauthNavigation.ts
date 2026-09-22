/** Only the real Figma site and our local callback may stay inside the auth window. */
export function canNavigateFigmaOAuth(value: string, localOrigin: string) {
  try {
    const url = new URL(value)
    if (url.username || url.password) return false
    return url.origin === localOrigin
      || (url.protocol === 'https:' && url.port === ''
        && ['www.figma.com', 'figma.com'].includes(url.hostname))
  } catch {
    return false
  }
}

/** Only official authentication and app-management destinations may leave this window. */
export function canOpenFigmaAuthInBrowser(value: string) {
  try {
    const url = new URL(value)
    return !url.username && !url.password && url.origin === 'https://www.figma.com'
      && ['/oauth', '/switch_user', '/developers/apps'].includes(url.pathname)
  } catch { return false }
}

export function browserOAuthStartUrl(value: string, localOrigin: string) {
  const url = new URL(value)
  if (url.origin !== localOrigin || url.username || url.password || url.pathname !== '/api/auth/figma/start') {
    throw new Error('Invalid local OAuth start URL')
  }
  url.searchParams.delete('direct')
  url.searchParams.set('handoff', '1')
  url.searchParams.set('desktop', '1')
  return url.toString()
}
