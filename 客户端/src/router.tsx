import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'

export type Route = 'home' | 'creating' | 'editor' | 'agent' | 'workspace'

type RouterValue = {
  route: Route
  fileId: string | null
  figmaUrl: string | null
  navigate: (
    route: Route,
    options?: { fileId?: string | null; figmaUrl?: string | null },
  ) => void
}

const RouterContext = createContext<RouterValue | null>(null)

function pathFor(
  route: Route,
  fileId?: string | null,
  figmaUrl?: string | null,
) {
  if (route === 'home') return '/'
  if (route === 'editor' && fileId) return `/editor/${fileId}`
  if (route === 'creating' && fileId) {
    return `/creating?file=${encodeURIComponent(fileId)}`
  }
  if (route === 'workspace') {
    const params = new URLSearchParams()
    if (fileId) params.set('file', fileId)
    if (figmaUrl) params.set('figma', figmaUrl)
    const query = params.toString()
    return query ? `/workspace?${query}` : '/workspace'
  }
  return `/${route}`
}

function locationFromPath(): {
  route: Route
  fileId: string | null
  figmaUrl: string | null
} {
  const url = new URL(window.location.href)
  const pathname = url.pathname
  if (pathname.startsWith('/editor')) {
    const fileId = pathname.split('/').filter(Boolean)[1] ?? null
    return { route: 'editor', fileId, figmaUrl: null }
  }
  if (pathname.startsWith('/agent')) {
    return { route: 'agent', fileId: null, figmaUrl: null }
  }
  if (pathname.startsWith('/creating')) {
    return {
      route: 'creating',
      fileId: url.searchParams.get('file'),
      figmaUrl: url.searchParams.get('figma'),
    }
  }
  if (pathname.startsWith('/workspace')) {
    return {
      route: 'workspace',
      fileId: url.searchParams.get('file'),
      figmaUrl: url.searchParams.get('figma'),
    }
  }
  return { route: 'home', fileId: null, figmaUrl: null }
}

export function RouterProvider({ children }: { children: ReactNode }) {
  const [{ route, fileId, figmaUrl }, setLocation] = useState(locationFromPath)

  useEffect(() => {
    const handlePopState = () => setLocation(locationFromPath())
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  const navigate = useCallback((
    next: Route,
    options?: { fileId?: string | null; figmaUrl?: string | null },
  ) => {
    const nextFileId =
      next === 'editor' || next === 'creating' || next === 'workspace'
        ? options?.fileId ?? null
        : null
    const nextFigmaUrl = next === 'workspace' || next === 'creating'
      ? options?.figmaUrl ?? null
      : null
    const path = pathFor(next, nextFileId, nextFigmaUrl)
    if (`${window.location.pathname}${window.location.search}` !== path) {
      const completesCreation =
        window.location.pathname.startsWith('/creating') && next === 'workspace'
      if (completesCreation) window.history.replaceState({}, '', path)
      else window.history.pushState({}, '', path)
    }
    setLocation({ route: next, fileId: nextFileId, figmaUrl: nextFigmaUrl })
  }, [])

  return (
    <RouterContext.Provider value={{ route, fileId, figmaUrl, navigate }}>
      {children}
    </RouterContext.Provider>
  )
}

export function useRouter() {
  const ctx = useContext(RouterContext)
  if (!ctx) throw new Error('useRouter must be used within RouterProvider')
  return ctx
}
