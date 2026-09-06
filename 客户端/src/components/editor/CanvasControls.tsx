import { ArrowLeftRight, Maximize, Minus, Plus, RotateCcw, Squircle } from 'lucide-react'
import { useEditor } from '../../state/editorStore'

/**
 * 画布底部悬浮控件。
 * 左组为视图操作（重置 / 适应 / 全屏），右组为缩放增减，
 * 右上另有「沉浸模式」独立按钮。
 */
export default function CanvasControls() {
  const { zoom, setZoom, resetView, setPan } = useEditor()
  return (
    <>
      <div className="absolute bottom-[22px] right-[26px]">
        <button className="flex items-center gap-[6px] rounded-[9px] border border-hairline bg-white px-[12px] py-[8px] text-[12.5px] text-[#3d3d42] shadow-[0_2px_10px_rgba(16,18,27,0.07)] transition-colors hover:bg-[#f7f7f8]">
          <ArrowLeftRight size={13} strokeWidth={1.9} className="text-[#6e6e75]" />
          沉浸模式
        </button>
      </div>

      <div className="absolute bottom-[22px] left-1/2 flex -translate-x-1/2 items-center gap-[10px]">
        <div className="flex items-center gap-[2px] rounded-[9px] border border-hairline bg-white px-[6px] py-[6px] shadow-[0_2px_10px_rgba(16,18,27,0.07)]">
          {[RotateCcw, Squircle, Maximize].map((Icon, i) => (
            <button
              key={i}
              onClick={() => i === 0 ? resetView() : i === 1 ? (setZoom(0.88), setPan({ x: 0, y: 0 })) : setZoom(1)}
              title={['重置视图', '适应画布', '100%'][i]}
              className="rounded-[6px] p-[6px] text-[#5d5d64] transition-colors hover:bg-[#f4f4f6] hover:text-ink"
            >
              <Icon size={15} strokeWidth={1.8} />
            </button>
          ))}
        </div>

        <div className="flex items-center gap-[2px] rounded-[9px] border border-hairline bg-white px-[6px] py-[6px] shadow-[0_2px_10px_rgba(16,18,27,0.07)]">
          <button onClick={() => setZoom(zoom - 0.1)} className="rounded-[6px] p-[6px] text-[#5d5d64] transition-colors hover:bg-[#f4f4f6] hover:text-ink">
            <Minus size={15} strokeWidth={1.9} />
          </button>
          <span className="w-11 text-center text-[11px] tabular-nums text-[#55565d]">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom(zoom + 0.1)} className="rounded-[6px] p-[6px] text-[#5d5d64] transition-colors hover:bg-[#f4f4f6] hover:text-ink">
            <Plus size={15} strokeWidth={1.9} />
          </button>
        </div>
      </div>
    </>
  )
}
