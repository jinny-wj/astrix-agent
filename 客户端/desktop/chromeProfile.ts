export function sanitizeChromeProfile(value: unknown): { name: string; avatarUrl: string | null } | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const name = typeof record.name === 'string' ? record.name.slice(0, 80) : ''
  let avatarUrl: string | null = null
  if (typeof record.avatarUrl === 'string' && record.avatarUrl.length < 2048) {
    try {
      const url = new URL(record.avatarUrl)
      if (url.protocol === 'https:' && !url.username && !url.password) avatarUrl = url.href
    } catch { /* Keep the neutral placeholder for invalid avatars. */ }
  }
  return { name, avatarUrl }
}
