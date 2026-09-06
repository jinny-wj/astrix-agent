/**
 * Shared write-command protocol for Design Studio ↔ Figma Plugin Bridge.
 * REST cannot create ordinary design nodes; the plugin executes these commands
 * inside the open Figma file via Plugin API.
 */

export type FigmaSolidColor = {
  r: number
  g: number
  b: number
  a?: number
}

export type FigmaSelectedNode = {
  id: string
  name: string
  type: string
  parentId?: string
  visible: boolean
  locked: boolean
  opacity?: number
  x?: number
  y?: number
  width?: number
  height?: number
  characters?: string
  fills?: FigmaSolidColor[] | 'MIXED'
  supports: {
    text: boolean
    fill: boolean
    opacity: boolean
    resize: boolean
    move: boolean
    visibility: boolean
    rename: boolean
  }
}

export type FigmaSelectionSnapshot = {
  sessionId: string
  /** Figma file key, used by desktop tabs to avoid crossing file sessions. */
  fileKey?: string
  documentName?: string
  pageId: string
  pageName: string
  revision: number
  updatedAt: number
  nodes: FigmaSelectedNode[]
}

export type FigmaEditIntent =
  | { kind: 'replace-text'; value: string }
  | { kind: 'set-fill-color'; color: FigmaSolidColor }
  | { kind: 'set-opacity'; value: number }
  | {
      kind: 'resize'
      width?: { mode: 'set' | 'delta'; value: number }
      height?: { mode: 'set' | 'delta'; value: number }
    }
  | {
      kind: 'move'
      x?: { mode: 'set' | 'delta'; value: number }
      y?: { mode: 'set' | 'delta'; value: number }
    }
  /** Uniformly scales a node; 1.2 means enlarge by 20%. */
  | { kind: 'scale'; factor: number }
  | { kind: 'set-visible'; value: boolean }
  | { kind: 'rename'; value: string }

type FigmaWriteCommandMeta = {
  id: string
  /** Commands without a session id are broadcast-compatible legacy commands. */
  sessionId?: string
  /** Guards against applying an instruction after the user changed selection. */
  selectionRevision?: number
  /** Guards desktop tabs against writing into a different open Figma file. */
  fileKey?: string
}

export type FigmaWriteCommand = FigmaWriteCommandMeta & (
  | {
      type: 'ping'
    }
  | {
      type: 'create-frame'
      name: string
      x: number
      y: number
      width: number
      height: number
      parentId?: string
      fills?: FigmaSolidColor[]
    }
  | {
      type: 'create-text'
      name?: string
      characters: string
      x: number
      y: number
      fontSize?: number
      parentId?: string
      fills?: FigmaSolidColor[]
    }
  | {
      type: 'set-characters'
      nodeId: string
      characters: string
    }
  | {
      type: 'set-fills'
      nodeId: string
      fills: FigmaSolidColor[]
    }
  | {
      type: 'patch-nodes'
      targets: Array<{
        nodeId: string
        expectedType: string
        patches: FigmaEditIntent[]
        /** Human-readable description of the patches for this node. */
        summary?: string
      }>
      /**
       * `selection` requires the plugin's current Figma selection to match.
       * `nodes` writes by node id in the open file, used when the user picked
       * layers in the OAuth preview rather than in the plugin selection.
       */
      lock?: 'selection' | 'nodes'
      executionMode?: 'atomic' | 'best-effort'
      summary: string
    }
  | {
      type: 'clone-into-frame'
      name: string
      x: number
      y: number
      width: number
      height: number
      sourceNodeIds?: string[]
      fills?: FigmaSolidColor[]
      labels?: Array<{
        characters: string
        x: number
        y: number
        fontSize?: number
        name?: string
        fills?: FigmaSolidColor[]
      }>
    }
  | {
      type: 'notify'
      message: string
    }
)

export type FigmaInstructionScope = 'all' | 'individual'

export type FigmaNodeInstruction = {
  nodeId: string
  message: string
}

export type FigmaInstructionTarget = {
  id: string
  /** Optional UI snapshot fields; the server verifies them when supplied. */
  name?: string
  type?: string
  instruction?: string
}

/**
 * Natural-language write request accepted by `/api/figma-bridge/instructions`.
 *
 * - `all` applies one message to every node in the revision-locked selection.
 * - `individual` applies an explicit message to each listed selected node.
 *
 * `nodeIds` is optional in `all` mode for legacy callers. When supplied, the
 * server requires it to match the complete selection, which prevents a stale
 * UI from silently widening a batch operation.
 */
export type FigmaInstructionRequest = {
  sessionId: string
  selectionRevision: number
  expectedFileKey?: string
  scope?: FigmaInstructionScope
  executionMode?: 'atomic' | 'best-effort'
  message?: string
  nodeIds?: string[]
  targets?: FigmaInstructionTarget[]
  instructions?: FigmaNodeInstruction[]
}

export type FigmaNodeWriteResult = {
  nodeId: string
  nodeName?: string
  ok: boolean
  status?: 'success' | 'error' | 'rolled-back' | 'skipped'
  patchCount?: number
  changedPatchKinds?: FigmaEditIntent['kind'][]
  summary?: string
  message?: string
}

export type FigmaInstructionAccepted = {
  ok: true
  commandId: string
  scope: FigmaInstructionScope
  summary: string
  queueSize: number
  nodeResults: FigmaNodeWriteResult[]
}

export type FigmaWriteCommandResult = {
  id: string
  ok: boolean
  sessionId?: string
  nodeId?: string
  changedNodeIds?: string[]
  nodeResults?: FigmaNodeWriteResult[]
  partial?: boolean
  succeededCount?: number
  failedCount?: number
  summary?: string
  message?: string
  completedAt?: number
}

export type BridgeQueueSnapshot = {
  pending: FigmaWriteCommand[]
  recent: FigmaWriteCommandResult[]
  pluginConnectedAt: string | null
  selection: FigmaSelectionSnapshot | null
}
