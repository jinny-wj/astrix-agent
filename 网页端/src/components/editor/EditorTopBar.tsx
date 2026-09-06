import { FileInput, Home, Link2 } from 'lucide-react'
import { useState } from 'react'
import { useRouter } from '../../router'
import {
  importFigmaFile,
  importFigmaFileWithOAuth,
} from '../../services/figmaApi'
import { rememberRecentFigmaFile } from '../../services/figmaRecents'
import { CODE_FROM_FIGMA_PROMPT } from '../../config/workspace'
import { openFigmaDesign, openFigmaInBrowser } from '../../config/figma'
import { useFigmaLayerTarget } from '../../hooks/useFigmaLayerTarget'
import { useEditor } from '../../state/editorStore'
import { StudioSettingsButton } from '../StudioHealth'
import WebCaptureDialog from '../WebCaptureDialog'
import FigmaImportDialog from './FigmaImportDialog'
import { AppLogo } from '../TitleBar'

function importedFigmaUrl(key: string, fileName: string) {
  const encodedName = encodeURIComponent(fileName.trim() || 'Untitled')
  return `https://www.figma.com/design/${encodeURIComponent(key)}/${encodedName}`
}

/** Design / Code 与打开真实 Figma。 */
function ViewModeSwitch({
  fileUrl,
  onRequestImport,
}: {
  fileUrl?: string
  onRequestImport: () => void
}) {
  const { workspaceMode, setWorkspaceMode, startAgent, figmaDocument } = useEditor()
  const { snapshot } = useFigmaLayerTarget()
  return (
    <div className="flex items-center gap-[6px]">
      <div className="flex items-center gap-[2px] rounded-[8px] bg-[#f4f4f5] p-[3px]">
        <button
          type="button"
          aria-pressed={workspaceMode === 'design'}
          onClick={() => setWorkspaceMode('design')}
          className={`rounded-[7px] px-[12px] py-[5px] text-[13px] ${
            workspaceMode === 'design'
              ? 'bg-[#1d1d1f] font-medium text-white'
              : 'text-[#6e6e75] hover:text-ink'
          }`}
        >
          Design
        </button>
        <button
          type="button"
          aria-pressed={workspaceMode === 'code'}
          title="根据当前选区生成 React + Tailwind"
          onClick={() => {
            setWorkspaceMode('code')
            const hasFigma = Boolean(figmaDocument) || (snapshot?.nodes.length ?? 0) > 0
            if (!hasFigma) {
              onRequestImport()
              return
            }
            startAgent(CODE_FROM_FIGMA_PROMPT, 'code-from-figma', snapshot)
          }}
          className={`rounded-[7px] px-[12px] py-[5px] text-[13px] ${
            workspaceMode === 'code'
              ? 'bg-[#1d1d1f] font-medium text-white'
              : 'text-[#6e6e75] hover:text-ink'
          }`}
        >
          Code
        </button>
      </div>

      <button
        type="button"
        onClick={() => {
          if (!fileUrl) {
            onRequestImport()
            return
          }
          const launched = openFigmaDesign({ kind: 'existing', url: fileUrl })
          if (launched.surface === 'figma-tab') openFigmaInBrowser(launched.url)
        }}
        title={fileUrl ? '打开真实 Figma 文件' : '先读取 Figma 文件'}
        className="flex items-center gap-[6px] rounded-[8px] px-[12px] py-[6px] text-[13px] text-[#6e6e75] transition-colors hover:bg-[#f2f2f4]"
      >
        <svg viewBox="0 0 12 18" className="h-[13px] w-[9px]">
          <path d="M3 0h3v6H3a3 3 0 0 1 0-6z" fill="#f24e1e" />
          <path d="M6 0h3a3 3 0 0 1 0 6H6V0z" fill="#ff7262" />
          <path d="M6 6h3a3 3 0 0 1 0 6H6V6z" fill="#1abcfe" />
          <path d="M3 6h3v6H3a3 3 0 0 1 0-6z" fill="#a259ff" />
          <path d="M3 12h3v3a3 3 0 1 1-3-3z" fill="#0acf83" />
        </svg>
        Figma
      </button>
    </div>
  )
}

export default function EditorTopBar() {
  const { navigate } = useRouter()
  const { figmaDocument, setFigmaDocument } = useEditor()
  const [importOpen, setImportOpen] = useState(false)
  const [captureOpen, setCaptureOpen] = useState(false)
  const currentFigmaUrl = figmaDocument
    ? importedFigmaUrl(figmaDocument.key, figmaDocument.file.name)
    : undefined

  return (
    <>
    <header className="relative flex h-[46px] shrink-0 items-center border-b border-hairline bg-white px-[16px]">
      {/* 浏览器工作台入口 */}
      <div className="flex items-center gap-[18px]">
        <button onClick={() => navigate('home')} aria-label="返回首页" className="flex items-center gap-2">
          <AppLogo />
          <span className="hidden text-[12.5px] font-medium text-[#44474f] xl:inline">星序 Astrix</span>
        </button>
        <button
          type="button"
          onClick={() => setCaptureOpen(true)}
          title="把网页链接交给真实 Figma 新文件和 Agent"
          className="flex items-center gap-[6px] text-[13px] text-[#5d5d64] hover:text-ink"
        >
          <Link2 size={14} strokeWidth={1.9} />
          网页捕获
        </button>
        <button onClick={() => setImportOpen(true)} className="flex items-center gap-[6px] text-[13px] text-[#5d5d64] hover:text-ink">
          <FileInput size={14} strokeWidth={1.9} />
          {figmaDocument ? figmaDocument.file.name : '读取 Figma'}
        </button>
      </div>

      {/* 中：视图模式切换，绝对居中不受两侧宽度影响 */}
      <div className="absolute left-1/2 -translate-x-1/2">
        <ViewModeSwitch
          fileUrl={currentFigmaUrl}
          onRequestImport={() => setImportOpen(true)}
        />
      </div>

      {/* 右：全局操作图标组 */}
      <div className="ml-auto flex items-center gap-[14px] text-[#6e6e75]">
        <button
          onClick={() => navigate('home')}
          title="返回首页"
          className="hover:text-ink"
        >
          <Home size={17} strokeWidth={1.8} />
        </button>
        <StudioSettingsButton kind="notifications" />
        <StudioSettingsButton />
        <div className="h-[24px] w-[24px] overflow-hidden rounded-full bg-[#3f4046]">
          <svg viewBox="0 0 24 24" className="h-full w-full">
            <circle cx="12" cy="9.5" r="4" fill="#8d8f98" />
            <path d="M4 23c1.2-4.6 4.3-6.8 8-6.8s6.8 2.2 8 6.8z" fill="#8d8f98" />
          </svg>
        </div>
      </div>
    </header>
    {captureOpen ? <WebCaptureDialog onClose={() => setCaptureOpen(false)} /> : null}
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
    </>
  )
}
