import { useRef, type PointerEvent, type WheelEvent } from 'react'
import type { AgendaItem } from '../../data/canvasDoc'
import { useEditor } from '../../state/editorStore'
import CanvasToolbar from './CanvasToolbar'

/** 选中框四角的白底蓝边控制手柄 */
function Handle({ position }: { position: 'tl' | 'tr' | 'bl' | 'br' }) {
  const offset: Record<typeof position, string> = {
    tl: '-top-[4px] -left-[4px]',
    tr: '-top-[4px] -right-[4px]',
    bl: '-bottom-[4px] -left-[4px]',
    br: '-bottom-[4px] -right-[4px]',
  }
  return (
    <span
      className={`absolute ${offset[position]} h-[7px] w-[7px] border border-[#0d99ff] bg-white`}
    />
  )
}

/** 单条议程卡片：左侧时间轴节点 + 文本块 + 右侧圆形头像与装饰 */
function AgendaRow({ item, index }: { item: AgendaItem; index: number }) {
  const { selectedNodeId, editingNodeId, selectNode, startEditing, stopEditing, updateNodeText } = useEditor()
  const id = `row-${index}`
  const selectable = (nodeId: string) => selectedNodeId === nodeId ? 'outline outline-1 outline-[#0d99ff] outline-offset-2' : ''
  const text = (field: 'time' | 'title' | 'speaker', className: string) => {
    const nodeId = `${id}-${field}`
    const value = item[field]
    if (editingNodeId === nodeId) {
      return <input autoFocus value={value} onChange={(event) => updateNodeText(nodeId, event.target.value)} onBlur={stopEditing} onKeyDown={(event) => event.key === 'Enter' && stopEditing()} onPointerDown={(event) => event.stopPropagation()} className={`${className} w-full rounded-sm bg-white px-1 outline outline-1 outline-[#0d99ff]`} />
    }
    return <div onPointerDown={(event) => { event.stopPropagation(); selectNode(nodeId) }} onDoubleClick={() => startEditing(nodeId)} className={`${className} ${selectable(nodeId)} cursor-text`}>{value}</div>
  }
  return (
    <div onPointerDown={(event) => { event.stopPropagation(); selectNode(id) }} className={`relative pl-[16px] ${selectable(id)}`}>
      {/* 时间轴节点 */}
      <span className="absolute left-0 top-[7px] h-[5px] w-[5px] rounded-full bg-[#3fa96a]" />
      {text('time', 'text-[5.5px] text-[#8d8f96]')}

      <div className="mt-[4px] flex items-start gap-[8px] rounded-[3px] bg-[#f7f8f9] px-[9px] py-[8px]">
        <div className="min-w-0 flex-1">
          {text('title', 'text-[7px] font-medium leading-[1.35] text-[#25272b]')}
          {text('speaker', 'mt-[4px] text-[6px] text-[#5f636b]')}
          <div className="mt-[4px] space-y-[2px]">
            {Array.from({ length: 5 }).map((_, i) => (
              <span
                key={i}
                className="block h-[1.5px] rounded bg-[#dcdee2]"
                style={{ width: `${94 - i * 7}%` }}
              />
            ))}
          </div>
        </div>

        {/* 头像 + 绿色环形与叶片装饰 */}
        <div className="relative h-[46px] w-[46px] shrink-0">
          <span className="absolute inset-0 rounded-full border-[1.6px] border-[#3fa96a]" />
          <div
            className="absolute inset-[3px] overflow-hidden rounded-full"
            style={{ background: item.tone }}
          >
            <svg viewBox="0 0 40 40" className="h-full w-full">
              <circle cx="20" cy="15" r="7" fill="rgba(255,255,255,0.34)" />
              <path d="M6 40c2.4-8.4 7.6-12 14-12s11.6 3.6 14 12z" fill="rgba(255,255,255,0.34)" />
            </svg>
          </div>
          {/* 右侧叶片 */}
          <svg viewBox="0 0 14 22" className="absolute -right-[7px] top-[9px] h-[16px] w-[10px]">
            <path d="M1 21C1 10 5 3 13 1c0 11-4 18-12 20z" fill="none" stroke="#3fa96a" strokeWidth="1.4" />
          </svg>
        </div>
      </div>
    </div>
  )
}

export default function Canvas() {
  const { document, selectedNodeId, selectNode, zoom, setZoom, pan, setPan } = useEditor()
  const drag = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null)

  const beginPan = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.target !== event.currentTarget) return
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y }
    selectNode('frame')
  }
  const movePan = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return
    setPan({ x: drag.current.panX + event.clientX - drag.current.x, y: drag.current.panY + event.clientY - drag.current.y })
  }
  const wheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (event.ctrlKey || event.metaKey) setZoom(zoom * (event.deltaY > 0 ? 0.9 : 1.1))
    else setPan({ x: pan.x - event.deltaX, y: pan.y - event.deltaY })
  }

  return (
    <div onPointerDown={beginPan} onPointerMove={movePan} onPointerUp={() => { drag.current = null }} onWheel={wheel} className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-[#f6f6f7]">
      <div className="relative select-none transition-transform duration-75" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
        {/* 选中态操作条位于选框上方，宽度随内容不换行 */}
        <div className="absolute -top-[52px] left-1/2 flex -translate-x-1/2 justify-center">
          <CanvasToolbar />
        </div>

        {/* 选中框：蓝色描边 + 四角手柄 */}
        <div onPointerDown={(event) => { event.stopPropagation(); selectNode('frame') }} className={`relative ${selectedNodeId === 'frame' ? 'border-[1.5px] border-[#0d99ff]' : 'border-[1.5px] border-transparent'}`}>
          <Handle position="tl" />
          <Handle position="tr" />
          <Handle position="bl" />
          <Handle position="br" />

          {/* 设计稿画板 */}
          <div className="scroll-clean h-[660px] w-[302px] overflow-hidden bg-white px-[12px] py-[14px]">
            <div className="space-y-[11px]">
              {document.map((item, index) => (
                <AgendaRow key={index} item={item} index={index} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
