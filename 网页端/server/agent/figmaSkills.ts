import { formatSelectionPrompt } from '../../src/services/figmaLayer'
import type { FigmaSelectionSnapshot } from '../../src/types/figmaWrite'
import type { AgentUiMessage } from './types'

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function selectionPromptBlock(selection: FigmaSelectionSnapshot | null | undefined) {
  const body = formatSelectionPrompt(selection)
  return body ? `当前对准的 Figma 图层：\n${body}` : ''
}

export function* yieldSelectionContext(
  selection: FigmaSelectionSnapshot | null | undefined,
): Generator<AgentUiMessage> {
  const nodes = selection?.nodes ?? []
  if (nodes.length === 0) return
  const names = nodes.map((node) => node.name).join('、')
  yield {
    id: makeId('layer'),
    kind: 'tool',
    provider: 'Figma',
    tool: '读取图层',
    action: `已对准 ${names}`,
    status: 'success',
    nodeId: nodes[0]?.id,
    note: nodes.map((node) => `${node.type} · ${node.id}`).join('，'),
    preview: true,
  }
}
