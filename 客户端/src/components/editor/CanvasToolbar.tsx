import { Download, Flame, LayoutTemplate, MessageSquare, Pencil, Scissors, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { useFigmaLayerTarget } from '../../hooks/useFigmaLayerTarget'
import { fetchFigmaNodeRendersWithOAuth } from '../../services/figmaApi'
import { useEditor } from '../../state/editorStore'

const TOOLS: Array<{
  key: string
  label: string
  Icon: typeof Scissors
  prompt?: string
  skill?: string
}> = [
  {
    key: 'split',
    label: '分割',
    Icon: Scissors,
    prompt: '分析当前选中图层的结构，给出可执行的拆分方案：哪些子图层应独立成组、如何命名。若已连接 Design Studio Bridge，说明哪些步骤可以直接改图层；不要假装已经拆完。',
  },
  {
    key: 'removebg',
    label: '移除背景',
    Icon: Sparkles,
    prompt: '当前没有像素抠图服务。如果选区有可改的填充或背景图层，请通过 Bridge 把背景填充改为透明或隐藏背景层；如果是位图，说明限制并给出在 Figma 里处理的步骤。不要伪造已抠图结果。',
  },
  { key: 'edit', label: '修改', Icon: Pencil },
  {
    key: 'annotate',
    label: '标注',
    Icon: MessageSquare,
    prompt: '检查当前选中图层，生成简洁的设计标注和交付说明。',
  },
  {
    key: 'prototype',
    label: '生成原型',
    Icon: LayoutTemplate,
    skill: 'code-from-figma',
    prompt: '根据当前 Figma 选区生成可交互的 React + Tailwind 原型代码，并说明关键状态。结果写在对话里，不要假装这是 IDE。',
  },
  {
    key: 'hotzone',
    label: 'AI热区',
    Icon: Flame,
    prompt: '分析当前画面的视觉热区、信息层级和可读性，给出优化建议。不要假装生成了热力图图片。',
  },
]

function downloadBlob(blob: Blob, filename: string) {
  const href = URL.createObjectURL(blob)
  const link = window.document.createElement('a')
  link.href = href
  link.download = filename
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(href), 1_000)
}

/**
 * 选中节点后浮现的 AI 操作条。对准当前 Figma 选区，导出走 REST 渲染。
 */
export default function CanvasToolbar() {
  const {
    startAgent,
    figmaDocument,
    selectedNodeId,
    selectedNodeIds,
  } = useEditor()
  const { snapshot } = useFigmaLayerTarget()
  const [exportOpen, setExportOpen] = useState(false)
  const [exportError, setExportError] = useState('')
  const [exporting, setExporting] = useState(false)

  const runTool = (tool: (typeof TOOLS)[number]) => {
    if (tool.key === 'edit') {
      startAgent(
        '请根据当前选区列出可改属性（文字、填充、透明度、尺寸、位置、显隐、名称），等我下一条具体指令。已连接 Bridge 时直接写回，否则只给可执行建议。',
        'layer-edit',
        snapshot,
      )
      return
    }
    startAgent(tool.prompt ?? tool.label, tool.skill, snapshot)
  }

  const exportImage = async (format: 'png' | 'jpeg') => {
    setExportError('')
    if (!figmaDocument) {
      setExportError('先读取 Figma 文件才能导出真实节点。')
      return
    }
    const ids = (selectedNodeIds.length > 0
      ? selectedNodeIds
      : selectedNodeId
        ? [selectedNodeId]
        : [])
      .filter(Boolean)
    const nodeIds = ids.length > 0
      ? ids
      : [figmaDocument.nodeId ?? figmaDocument.file.document.id]
    setExporting(true)
    try {
      const images = await fetchFigmaNodeRendersWithOAuth({
        fileKey: figmaDocument.key,
        nodeIds,
      })
      const remote = Object.values(images).find(Boolean)
      if (!remote) {
        setExportError('Figma 没有返回这张图。请确认已连接账号，且选中了可导出的图层。')
        return
      }
      const response = await fetch(remote)
      if (!response.ok) {
        window.open(remote, '_blank', 'noopener,noreferrer')
        setExportOpen(false)
        return
      }
      const source = await response.blob()
      const name = (figmaDocument.file.name || 'figma-export').replace(/[\\/:*?"<>|]/g, '-')
      if (format === 'png') {
        downloadBlob(source, `${name}.png`)
        setExportOpen(false)
        return
      }
      const bitmap = await createImageBitmap(source)
      const canvas = window.document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        window.open(remote, '_blank', 'noopener,noreferrer')
        return
      }
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(bitmap, 0, 0)
      const jpeg = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.92)
      })
      if (!jpeg) {
        window.open(remote, '_blank', 'noopener,noreferrer')
        return
      }
      downloadBlob(jpeg, `${name}.jpg`)
      setExportOpen(false)
    } catch {
      setExportError('导出失败。请确认已连接 Figma，或改用原文件里的导出。')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="flex shrink-0 items-center gap-[2px] whitespace-nowrap rounded-[10px] border border-hairline bg-white px-[8px] py-[7px] shadow-[0_4px_16px_rgba(16,18,27,0.09)]">
      {TOOLS.map((tool) => {
        const { key, label, Icon } = tool
        return (
        <button
          key={key}
          type="button"
          onClick={() => runTool(tool)}
          className="flex shrink-0 items-center gap-[5px] whitespace-nowrap rounded-[7px] px-[10px] py-[5px] text-[13px] text-[#3d3d42] transition-colors hover:bg-[#f4f4f6]"
        >
          <Icon size={14} strokeWidth={1.85} className="text-[#6e6e75]" />
          {label}
        </button>
        )
      })}
      <span className="mx-1 h-5 w-px bg-[#e5e5e7]" />
      <div className="relative">
        <button
          type="button"
          disabled={exporting}
          onClick={() => setExportOpen((value) => !value)}
          className="flex items-center gap-[5px] rounded-[7px] px-[10px] py-[5px] text-[13px] text-[#3d3d42] hover:bg-[#f4f4f6] disabled:opacity-50"
        >
          <Download size={14} /> {exporting ? '导出中' : '导出'}
        </button>
        {exportOpen && (
          <div className="absolute right-0 top-[36px] z-20 w-[148px] rounded-lg border border-hairline bg-white p-1 shadow-lg">
            <button
              type="button"
              onClick={() => void exportImage('png')}
              className="w-full rounded-md px-3 py-2 text-left text-xs hover:bg-[#f4f4f6]"
            >
              PNG（Figma 渲染）
            </button>
            <button
              type="button"
              onClick={() => void exportImage('jpeg')}
              className="w-full rounded-md px-3 py-2 text-left text-xs hover:bg-[#f4f4f6]"
            >
              JPG（由渲染转换）
            </button>
            {exportError ? (
              <p className="px-3 py-2 text-[11px] leading-4 text-[#b42318]">{exportError}</p>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}
