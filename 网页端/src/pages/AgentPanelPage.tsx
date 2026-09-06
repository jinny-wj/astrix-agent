import AiPanel from '../components/editor/AiPanel'
import { EditorProvider } from '../state/editorStore'

export default function AgentPanelPage() {
  return (
    <EditorProvider>
      <main className="h-full min-h-0 w-full bg-white">
        <AiPanel variant="standalone" />
      </main>
    </EditorProvider>
  )
}
