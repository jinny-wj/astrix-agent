import { useEffect, useRef } from 'react'
import AiPanel from '../components/editor/AiPanel'
import {
  FIGMA_NEW_DESIGN_URL,
  getPendingFigmaWorkspaceIntent,
} from '../config/figma'
import { hydrateWorkspaceFile, readQueuedWorkspaceDraft } from '../config/workspace'
import { useRouter } from '../router'
import { EditorProvider, useEditor } from '../state/editorStore'

function WorkspaceAgentBoot() {
  const { startAgent } = useEditor()
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    const intent = getPendingFigmaWorkspaceIntent()
    const draft = readQueuedWorkspaceDraft()
    const prompt = (
      intent?.kind === 'new' ? intent.prompt : undefined
    )?.trim() || draft?.prompt?.trim()
    const skill = (
      intent?.kind === 'new' ? intent.skill : undefined
    )?.trim() || draft?.skill?.trim()
    const attachments = draft?.attachments
    if (skill === 'code-from-figma') {
      started.current = true
      return
    }
    if (!prompt && !(attachments?.length)) return
    started.current = true
    startAgent(
      prompt || '请查看我上传的参考文件',
      skill,
      undefined,
      attachments?.length
        ? { attachments, contextRefs: [], instructions: [] }
        : undefined,
    )
  }, [startAgent])

  return null
}

function FigmaStage() {
  return (
    <section className="relative min-h-0 min-w-0 flex-1 bg-[#f6f7f9]">
      <div className="absolute inset-0 grid place-items-center">
        <div className="flex w-[min(21rem,calc(100%-3rem))] flex-col items-center">
          <div className="figma-stage-mascot" aria-hidden="true">
            <span className="figma-stage-eye figma-stage-eye-left" />
            <span className="figma-stage-eye figma-stage-eye-right" />
            <span className="figma-stage-mouth" />
          </div>
          <div
            className="mt-5 h-[5px] w-full overflow-hidden rounded-full bg-[#e4e7ee]"
            role="progressbar"
            aria-label="正在打开 Figma"
          >
            <div className="figma-stage-progress" />
          </div>
          <p className="mt-3 text-center text-[13px] leading-5 text-[#667386]">
            Figma 数据请求中...
            <br />
            浏览器不能嵌真实 Figma 编辑器。请看桌面客户端：左边是 Figma，右边是 Agent 输入框。
          </p>
        </div>
      </div>

      <style>{`
        .figma-stage-mascot {
          position: relative;
          width: 4.8rem;
          height: 4.8rem;
          border-radius: 46% 54% 48% 52%;
          background: linear-gradient(142deg, #64e3f7 5%, #5bbcf9 42%, #87a6ff 70%, #c99af7 100%);
          box-shadow: 0 16px 16px rgba(58, 112, 208, 0.16);
          animation: figma-stage-float 1.45s ease-in-out infinite;
        }
        .figma-stage-eye {
          position: absolute;
          top: 1.45rem;
          width: 0.55rem;
          height: 0.82rem;
          border-radius: 50%;
          background: #19246b;
        }
        .figma-stage-eye-left { left: 1.2rem; }
        .figma-stage-eye-right { right: 1.15rem; }
        .figma-stage-mouth {
          position: absolute;
          top: 2.35rem;
          left: 50%;
          width: 0.9rem;
          height: 0.55rem;
          transform: translateX(-50%);
          border-radius: 0 0 0.7rem 0.7rem;
          background: #27236d;
        }
        .figma-stage-progress {
          width: 100%;
          height: 100%;
          transform-origin: left center;
          border-radius: inherit;
          background: linear-gradient(90deg, #1f73f1, #6a8cff 58%, #ad82f6);
          animation: figma-stage-progress 1.6s cubic-bezier(0.2, 0.78, 0.25, 1) forwards;
        }
        @keyframes figma-stage-float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-0.45rem); }
        }
        @keyframes figma-stage-progress {
          0% { transform: scaleX(0.04); }
          100% { transform: scaleX(1); }
        }
      `}</style>
    </section>
  )
}

export default function WorkspacePage() {
  const { fileId, figmaUrl, navigate } = useRouter()
  const intent = getPendingFigmaWorkspaceIntent()
  const url =
    figmaUrl
    || (intent?.kind === 'existing' ? intent.url : FIGMA_NEW_DESIGN_URL)
  const title =
    intent?.kind === 'existing' && intent.fileName
      ? intent.fileName
      : '新建设计稿'

  useEffect(() => {
    if (fileId) hydrateWorkspaceFile(fileId)
  }, [fileId])

  return (
    <EditorProvider key={fileId ?? url}>
      <WorkspaceAgentBoot />
      <div className="flex h-full min-h-0 flex-col bg-[#f4f5f7]">
        <header className="flex h-11 shrink-0 items-center gap-2 border-b border-[#ececef] bg-white px-3">
          <button
            type="button"
            onClick={() => navigate('home')}
            className="rounded-[8px] px-2.5 py-1 text-[12px] text-[#667386] hover:bg-[#f3f4f6]"
          >
            首页
          </button>
          <div className="flex items-center gap-2 rounded-[8px] bg-[#1f1f23] px-2.5 py-1 text-[12px] text-white">
            <span className="grid h-4 w-4 place-items-center rounded-[4px] bg-[#f24e1e] text-[9px] font-bold">
              F
            </span>
            <span className="max-w-[240px] truncate">{title}</span>
          </div>
          <div className="ml-auto text-[11px] text-[#8b8f99]">Figma + Codex Agent</div>
        </header>
        <div className="flex min-h-0 flex-1">
          <FigmaStage />
          <div className="h-full w-[420px] shrink-0 border-l border-[#ececef] bg-white">
            <AiPanel variant="standalone" />
          </div>
        </div>
      </div>
    </EditorProvider>
  )
}
