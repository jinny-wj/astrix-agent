import { useEffect, useMemo, useRef, useState } from 'react'
import {
  fetchFigmaNodeRendersWithOAuth,
  fetchFigmaNodesWithOAuth,
  findFigmaNode,
  FigmaApiError,
} from '../services/figmaApi'
import { getFigmaAuthSession } from '../services/figmaAuth'
import { getFigmaBridgeStatus } from '../services/figmaBridge'
import {
  attachLiveBridgeSession,
  resolveLayerTarget,
  selectionSnapshotFromLayers,
  targetedLayerFromNode,
  type TargetedLayer,
} from '../services/figmaLayer'
import { useEditor } from '../state/editorStore'
import type { DesktopWorkspaceContext } from '../types/desktop'
import type { FigmaSelectionSnapshot } from '../types/figmaWrite'

function readDesktopContext(value: unknown): DesktopWorkspaceContext | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  return {
    tabId: typeof record.tabId === 'string' ? record.tabId : 'home',
    intent:
      record.intent && typeof record.intent === 'object'
        ? record.intent as DesktopWorkspaceContext['intent']
        : null,
    intentRevision: typeof record.intentRevision === 'number' ? record.intentRevision : 0,
    fileKey: typeof record.fileKey === 'string' ? record.fileKey : null,
    nodeId: typeof record.nodeId === 'string' ? record.nodeId : null,
    url: typeof record.url === 'string' ? record.url : null,
    title: typeof record.title === 'string' ? record.title : null,
  }
}

export function useFigmaLayerTarget() {
  const {
    figmaDocument,
    selectedNodeId,
    selectedNodeIds,
    selectionEpoch,
    deselectNode,
  } = useEditor()
  const [desktop, setDesktop] = useState<DesktopWorkspaceContext | null>(null)
  const [oauthLayer, setOauthLayer] = useState<TargetedLayer | null>(null)
  const [bridgeSelection, setBridgeSelection] = useState<FigmaSelectionSnapshot | null>(null)
  const [needsAuth, setNeedsAuth] = useState(false)
  const [dismissed, setDismissed] = useState<{ key: string; ids: string[] }>({ key: '', ids: [] })
  const requestId = useRef(0)
  const fileKey = desktop?.fileKey ?? figmaDocument?.key
  const activeBridge = bridgeSelection && (!fileKey || bridgeSelection.fileKey === fileKey)
    && (!window.designStudioAgentHost || desktop?.fileKey)
    ? bridgeSelection : null
  const bridgeConnected = Boolean(activeBridge)

  useEffect(() => {
    const host = window.designStudioAgentHost
    if (!host?.getContext) return undefined
    const apply = (value: unknown) => setDesktop(readDesktopContext(value))
    void host.getContext().then(apply).catch(() => {})
    return host.onContext?.(apply)
  }, [])

  useEffect(() => {
    let cancelled = false
    let inFlight = false
    setBridgeSelection(null)
    const refreshBridge = async () => {
      if (inFlight || (window.designStudioAgentHost && !fileKey)) return
      inFlight = true
      try {
        const status = await getFigmaBridgeStatus(fileKey)
        if (cancelled) return
        setBridgeSelection(status.selection ?? null)
      } catch {
        if (cancelled) return
        setBridgeSelection(null)
      } finally {
        inFlight = false
      }
    }
    void refreshBridge()
    const timer = window.setInterval(() => void refreshBridge(), 800)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [fileKey])

  useEffect(() => {
    const fileKey = desktop?.fileKey
    const nodeId = desktop?.nodeId
    const current = ++requestId.current
    setOauthLayer(null)
    setNeedsAuth(false)
    if (!fileKey || !nodeId || bridgeConnected) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const session = await getFigmaAuthSession()
          if (current !== requestId.current) return
          if (!session.authenticated) {
            setNeedsAuth(true)
            setOauthLayer({
              id: nodeId,
              name: `图层 ${nodeId}`,
              type: 'NODE',
              fileKey,
            })
            return
          }
          setNeedsAuth(false)
          const [nodes, renders] = await Promise.all([
            fetchFigmaNodesWithOAuth({
              fileKey,
              nodeIds: [nodeId],
              signal: controller.signal,
            }),
            fetchFigmaNodeRendersWithOAuth({
              fileKey,
              nodeIds: [nodeId],
              signal: controller.signal,
            }).catch(() => ({}) as Record<string, string>),
          ])
          if (current !== requestId.current) return
          const document = nodes.nodes[nodeId]?.document
          setOauthLayer(
            document
              ? targetedLayerFromNode(document, {
                  fileKey,
                  thumbnailUrl: renders[nodeId] ?? renders[document.id],
                })
              : {
                  id: nodeId,
                  name: `图层 ${nodeId}`,
                  type: 'NODE',
                  fileKey,
                },
          )
        } catch (error) {
          if (current !== requestId.current) return
          if (error instanceof FigmaApiError && error.status === 401) {
            setNeedsAuth(true)
          }
          setOauthLayer({
            id: nodeId,
            name: `图层 ${nodeId}`,
            type: 'NODE',
            fileKey,
          })
        }
      })()
    }, 160)

    return () => {
      requestId.current += 1
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [desktop?.fileKey, desktop?.nodeId, bridgeConnected])

  const liveLayers = useMemo<TargetedLayer[]>(() => {
    const preview: TargetedLayer[] | null = figmaDocument
      ? (
          selectedNodeIds.length > 0
            ? selectedNodeIds
            : selectedNodeId
              ? [selectedNodeId]
              : []
        ).flatMap((id) => {
          const node = findFigmaNode(figmaDocument.file.document, id)
          return node
            ? [targetedLayerFromNode(node, { fileKey: figmaDocument.key })]
            : []
        })
      : null
    return resolveLayerTarget({ fileKey, preview, bridge: activeBridge,
      oauth: oauthLayer?.id === desktop?.nodeId ? oauthLayer : null })
  }, [activeBridge, fileKey, oauthLayer, desktop?.nodeId, figmaDocument, selectedNodeId, selectedNodeIds])

  const selectionKey = JSON.stringify([desktop?.tabId, fileKey,
    figmaDocument ? selectionEpoch : activeBridge ? [activeBridge.sessionId, activeBridge.revision] : desktop?.nodeId,
    liveLayers.map((layer) => layer.id)])

  const layers = useMemo(() => {
    return liveLayers.filter((layer) => dismissed.key !== selectionKey || !dismissed.ids.includes(layer.id))
  }, [liveLayers, dismissed, selectionKey])

  const snapshot = useMemo<FigmaSelectionSnapshot | null>(
    () => {
      // Preserve the file session on an empty canvas for explicit create requests,
      // without restoring nodes the user removed from the composer.
      if (!figmaDocument && activeBridge && liveLayers.length === 0) return activeBridge
      const preview = selectionSnapshotFromLayers(layers, {
        fileKey: desktop?.fileKey ?? figmaDocument?.key ?? bridgeSelection?.fileKey,
        documentName: desktop?.title ?? figmaDocument?.file.name,
      })
      return attachLiveBridgeSession(preview, activeBridge)
    },
    [activeBridge, bridgeSelection, liveLayers.length, layers, desktop?.fileKey, desktop?.title, figmaDocument],
  )

  return {
    layers,
    snapshot,
    bridgeConnected,
    needsAuth: needsAuth && Boolean(desktop?.nodeId || desktop?.fileKey),
    fileKey: desktop?.fileKey ?? figmaDocument?.key ?? null,
    dismiss(id: string) {
      setDismissed((current) => ({ key: selectionKey, ids: [...(current.key === selectionKey ? current.ids : []), id] }))
      if (figmaDocument) deselectNode(id)
    },
  }
}
