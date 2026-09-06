import { Box, ChevronDown, ChevronRight, Circle, Frame, Layers, Square, Type } from 'lucide-react'
import { useState } from 'react'
import { useEditor } from '../../state/editorStore'
import type { FigmaNode } from '../../types/figma'

/** 左侧图层栏：导入 Figma 后展示真实节点树。 */
export default function LayersPanel() {
  const [open, setOpen] = useState(true)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const {
    selectedNodeId,
    selectedNodeIds,
    selectNode,
    figmaDocument,
  } = useEditor()

  const row = (id: string, label: string, depth: number, Icon: typeof Type, expandable = false, defaultOpen = false) => {
    const isOpen = expanded[id] ?? defaultOpen
    const selected = selectedNodeIds.includes(id) || selectedNodeId === id
    return (
      <button
        key={id}
        onClick={(event) => {
          selectNode(id, { additive: event.shiftKey || event.metaKey })
          if (expandable) setExpanded((value) => ({ ...value, [id]: !(value[id] ?? defaultOpen) }))
        }}
        className={`flex h-8 w-full items-center gap-1.5 truncate px-2 text-left text-[12px] ${
          selected ? 'bg-[#e8f3ff] text-[#0875c9]' : 'text-[#505159] hover:bg-[#f5f5f6]'
        }`}
        style={{ paddingLeft: 8 + depth * 14 }}
      >
        {expandable ? (isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />) : <span className="w-[13px]" />}
        <Icon size={14} strokeWidth={1.7} className="shrink-0" />
        <span className="truncate">{label}</span>
      </button>
    )
  }

  const figmaIcon = (type: string) => {
    if (type === 'TEXT') return Type
    if (type === 'ELLIPSE') return Circle
    if (type === 'RECTANGLE' || type === 'VECTOR' || type === 'LINE') return Square
    if (type === 'COMPONENT' || type === 'COMPONENT_SET' || type === 'INSTANCE') return Box
    return Frame
  }

  const containsSelectedNode = (node: FigmaNode): boolean => {
    return selectedNodeIds.includes(node.id)
      || node.id === selectedNodeId
      || (node.children ?? []).some(containsSelectedNode)
  }

  const figmaRows = (node: FigmaNode, depth = 0): React.ReactNode => {
    const children = node.children ?? []
    const defaultOpen = depth < 2 || containsSelectedNode(node)
    const isOpen = expanded[node.id] ?? defaultOpen
    return (
      <div key={node.id}>
        {row(node.id, node.name || node.type, depth, figmaIcon(node.type), children.length > 0, defaultOpen)}
        {children.length > 0 && isOpen && children.map((child) => figmaRows(child, depth + 1))}
      </div>
    )
  }

  return (
    <aside className={`${open ? 'w-[224px]' : 'w-[64px]'} shrink-0 border-r border-hairline bg-white transition-[width]`}>
      <button onClick={() => setOpen((value) => !value)} className={`${open ? 'mx-2 mt-2 flex-row justify-start px-2' : 'mx-auto mt-[14px] flex-col'} flex w-[46px] items-center gap-[4px] rounded-[8px] py-[7px] text-[#5d5d64] hover:bg-[#f4f4f6]`}>
        <Layers size={19} strokeWidth={1.8} />
        <span className="text-[11.5px] leading-none">图层</span>
      </button>
      {open && (
        <div className="mt-2 overflow-y-auto border-t border-hairline py-1">
          {figmaDocument ? figmaRows(figmaDocument.file.document) : (
            <p className="px-3 py-4 text-[12px] leading-5 text-[#8a8a90]">
              导入 Figma 文件后，图层会出现在这里。
            </p>
          )}
        </div>
      )}
    </aside>
  )
}
