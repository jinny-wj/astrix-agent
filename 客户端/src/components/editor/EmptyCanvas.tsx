import { FileInput, Plus } from 'lucide-react'
import { useState } from 'react'
import { openFigmaInBrowser, openNewFigmaDesign } from '../../config/figma'
import {
  importFigmaFile,
  importFigmaFileWithOAuth,
} from '../../services/figmaApi'
import { rememberRecentFigmaFile } from '../../services/figmaRecents'
import { useEditor } from '../../state/editorStore'
import FigmaImportDialog from './FigmaImportDialog'

function importedFigmaUrl(key: string, fileName: string) {
  const encodedName = encodeURIComponent(fileName.trim() || 'Untitled')
  return `https://www.figma.com/design/${encodeURIComponent(key)}/${encodedName}`
}

/** 未导入 Figma 时的画布空态，替代会议议程 Demo 和海报模板。 */
export default function EmptyCanvas() {
  const { setFigmaDocument, workspaceMode } = useEditor()
  const [importOpen, setImportOpen] = useState(false)

  return (
    <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-[#f6f6f7] px-8">
      <div className="max-w-[420px] text-center">
        <p className="text-[15px] font-medium tracking-[-0.01em] text-[#1d1d1f]">
          {workspaceMode === 'code' ? '用真实 Figma 选区转代码' : '打开真实 Figma 文件'}
        </p>
        <p className="mt-2 text-[13px] leading-5 text-[#6e6e75]">
          本地会议议程和直播海报模板已经关掉。读取文件后可以选图层、导出，并在 Bridge 连上后写回原文件。
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => setImportOpen(true)}
            className="inline-flex h-10 items-center gap-2 rounded-[9px] bg-[#1d1d1f] px-4 text-[13px] font-medium text-white hover:bg-[#343438]"
          >
            <FileInput size={14} strokeWidth={1.9} />
            读取 Figma
          </button>
          <button
            type="button"
            onClick={() => {
              const launched = openNewFigmaDesign()
              if (launched.surface === 'figma-tab') openFigmaInBrowser(launched.url)
            }}
            className="inline-flex h-10 items-center gap-2 rounded-[9px] border border-[#dedee2] bg-white px-4 text-[13px] font-medium text-[#3d3d42] hover:bg-[#f7f7f8]"
          >
            <Plus size={14} strokeWidth={1.9} />
            新建 Figma 文件
          </button>
        </div>
      </div>
      <FigmaImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImport={async ({ url, token, authMode }) => {
          const result =
            authMode === 'oauth'
              ? await importFigmaFileWithOAuth({ urlOrKey: url })
              : await importFigmaFile({ urlOrKey: url, token: token ?? '' })
          setFigmaDocument(result)
          rememberRecentFigmaFile(
            importedFigmaUrl(result.key, result.file.name),
            result.file.name,
          )
        }}
      />
    </div>
  )
}
