export type SyncedLibraryFile = {
  key: string
  name: string
  url: string
  thumbnailUrl?: string
  lastModified?: string
  projectId: string
  projectName: string
  teamId: string
}

export type LibrarySyncResult = {
  teamIds: string[]
  files: SyncedLibraryFile[]
  truncated: boolean
  errors: Array<{ scope: string; message: string; code?: string }>
}

export type LibraryConfig = {
  teamIds: string[]
  configured: boolean
  maxFiles: number
  reauthorize?: boolean
}

const TEAM_ID_RE = /^\d{5,32}$/

export function extractFigmaTeamIds(value: string): string[] {
  const ids: string[] = []
  const seen = new Set<string>()
  const patterns = [
    /\/(?:files\/)?team\/(\d{5,32})(?=[/?#]|$)/gi,
    /[?&]team[_-]?id=(\d{5,32})(?=&|$)/gi,
  ]
  for (const pattern of patterns) {
    for (const match of value.matchAll(pattern)) {
      const id = match[1]
      if (!TEAM_ID_RE.test(id) || seen.has(id)) continue
      seen.add(id)
      ids.push(id)
    }
  }
  return ids
}

export async function getFigmaLibraryConfig(): Promise<LibraryConfig> {
  const response = await fetch('/api/auth/figma/library/config', {
    credentials: 'same-origin',
    cache: 'no-store',
  })
  if (!response.ok) {
    throw new Error('无法读取团队文件同步配置')
  }
  return response.json() as Promise<LibraryConfig>
}

export async function saveFigmaLibraryConfig(
  teamIds: string[],
  options?: { merge?: boolean },
): Promise<LibraryConfig> {
  const response = await fetch('/api/auth/figma/library/config', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      teamIds,
      merge: options?.merge === true,
    }),
  })
  const body = (await response.json().catch(() => null)) as
    | (LibraryConfig & { message?: string })
    | null
  if (!response.ok || !body) {
    throw new Error(body?.message ?? '无法保存团队文件同步配置')
  }
  return body
}

export async function syncFigmaLibrary(
  teamIds?: string[],
): Promise<LibrarySyncResult> {
  const query =
    teamIds && teamIds.length > 0
      ? `?${new URLSearchParams({ teamIds: teamIds.join(',') }).toString()}`
      : ''
  const response = await fetch(`/api/auth/figma/library/sync${query}`, {
    credentials: 'same-origin',
    cache: 'no-store',
  })

  const body = (await response.json().catch(() => null)) as
    | (LibrarySyncResult & { message?: string })
    | null

  if (!response.ok && response.status !== 207) {
    throw new Error(body?.message ?? '团队文件同步失败')
  }

  if (!body || !Array.isArray(body.files)) {
    throw new Error('团队文件同步响应无效')
  }

  return {
    teamIds: body.teamIds ?? [],
    files: body.files,
    truncated: Boolean(body.truncated),
    errors: Array.isArray(body.errors) ? body.errors : [],
  }
}

export async function rememberFigmaTeamIdsFromUrl(url: string) {
  const teamIds = extractFigmaTeamIds(url)
  if (teamIds.length === 0) return null
  try {
    return await saveFigmaLibraryConfig(teamIds, { merge: true })
  } catch {
    return null
  }
}
