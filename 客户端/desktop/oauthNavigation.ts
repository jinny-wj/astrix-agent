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
