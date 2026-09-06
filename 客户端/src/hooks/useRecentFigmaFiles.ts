import { useCallback, useEffect, useRef, useState } from 'react'
import { getFigmaAuthSession } from '../services/figmaAuth'
import {
  getRecentFigmaFileMetadata,
  requestRecentFigmaFiles,
  type CapturedRecentFigmaFile,
} from '../services/figmaRecents'

export type RecentFigmaFile = CapturedRecentFigmaFile & {
  thumbnailUrl?: string
  lastModified?: string
}

export type RecentFigmaFilesState =
  | {
      status: 'loading'
      files: []
      metadataStatus: 'idle'
      source: 'none'
    }
  | {
      status: 'unavailable'
      files: []
      metadataStatus: 'idle'
      source: 'none'
    }
  | {
      status: 'ready'
      files: RecentFigmaFile[]
      metadataStatus: 'idle' | 'loading' | 'ready' | 'unavailable'
      source: 'extension' | 'local'
    }

const INITIAL_STATE: RecentFigmaFilesState = {
  status: 'loading',
  files: [],
  metadataStatus: 'idle',
  source: 'none',
}

export function useRecentFigmaFiles(options?: { enabled?: boolean }) {
  const enabled = options?.enabled ?? true
  const [state, setState] = useState<RecentFigmaFilesState>(INITIAL_STATE)
  const requestVersion = useRef(0)

  const refresh = useCallback(async () => {
    if (!enabled) {
      setState(INITIAL_STATE)
      return
    }
    const version = ++requestVersion.current
    setState(INITIAL_STATE)

    const captured = await requestRecentFigmaFiles()
    if (requestVersion.current !== version) return

    if (captured.status === 'unavailable') {
      setState({
        status: 'unavailable',
        files: [],
        metadataStatus: 'idle',
        source: 'none',
      })
      return
    }

    const baseFiles: RecentFigmaFile[] = captured.files
    setState({
      status: 'ready',
      files: baseFiles,
      metadataStatus: 'idle',
      source: captured.source,
    })
    if (baseFiles.length === 0) return

    try {
      const session = await getFigmaAuthSession()
      if (
        requestVersion.current !== version
        || !session.authenticated
        || !session.user
      ) {
        return
      }

      setState({
        status: 'ready',
        files: baseFiles,
        metadataStatus: 'loading',
        source: captured.source,
      })

      const metadata = await getRecentFigmaFileMetadata(
        baseFiles.map((file) => file.key),
      )
      if (requestVersion.current !== version) return

      const metadataByKey = new Map(metadata.map((item) => [item.key, item]))
      setState({
        status: 'ready',
        files: baseFiles.map((file) => {
          const details = metadataByKey.get(file.key)
          return {
            ...file,
            title: details?.name || file.title,
            thumbnailUrl: details?.thumbnailUrl,
            lastModified: details?.lastModified,
          }
        }),
        metadataStatus: 'ready',
        source: captured.source,
      })
    } catch {
      if (requestVersion.current !== version) return
      setState({
        status: 'ready',
        files: baseFiles,
        metadataStatus: 'unavailable',
        source: captured.source,
      })
    }
  }, [enabled])

  useEffect(() => {
    void refresh()
    return () => {
      requestVersion.current += 1
    }
  }, [refresh])

  return { ...state, refresh }
}
