import AiPanel from '../components/editor/AiPanel'
import CanvasControls from '../components/editor/CanvasControls'
import EditorTopBar from '../components/editor/EditorTopBar'
import EmptyCanvas from '../components/editor/EmptyCanvas'
import FigmaAutoImport from '../components/editor/FigmaAutoImport'
import FigmaCanvas from '../components/editor/FigmaCanvas'
import LayersPanel from '../components/editor/LayersPanel'
import { EditorProvider, useEditor } from '../state/editorStore'
import { hydrateWorkspaceFile } from '../config/workspace'
import { useRouter } from '../router'

function EditorBody() {
  const { figmaDocument } = useEditor()

  return (
    <div className="flex h-full flex-col bg-white">
      <EditorTopBar />
      <div className="flex min-h-0 flex-1">
        <LayersPanel />
        <div className="relative flex min-h-0 flex-1 flex-col">
          {figmaDocument
            ? <FigmaCanvas document={figmaDocument} />
            : <EmptyCanvas />}
          <FigmaAutoImport />
          <CanvasControls />
        </div>
        <AiPanel />
      </div>
    </div>
  )
}

export default function EditorPage() {
  const { fileId } = useRouter()
  if (fileId) hydrateWorkspaceFile(fileId)
  return (
    <EditorProvider key={fileId ?? 'editor'}>
      <EditorBody />
    </EditorProvider>
  )
}
