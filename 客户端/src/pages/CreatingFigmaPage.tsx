import { useEffect } from 'react'
import { FIGMA_NEW_DESIGN_URL, getPendingFigmaWorkspaceIntent, openFigmaInBrowser } from '../config/figma'
import { hydrateWorkspaceFile } from '../config/workspace'
import { useRouter } from '../router'

export default function CreatingFigmaPage() {
  const { fileId, figmaUrl } = useRouter()

  useEffect(() => {
    const id =
      fileId
      || new URLSearchParams(window.location.search).get('file')
    if (id) hydrateWorkspaceFile(id)
    const timer = window.setTimeout(() => {
      const intent = getPendingFigmaWorkspaceIntent()
      const url =
        figmaUrl
        || (intent?.kind === 'existing' ? intent.url : FIGMA_NEW_DESIGN_URL)
      openFigmaInBrowser(url)
    }, 900)
    return () => window.clearTimeout(timer)
  }, [fileId, figmaUrl])
  return (
    <main className="figma-creating-page" aria-labelledby="figma-creating-label">
      <style>{`
        .figma-creating-page {
          position: relative;
          display: grid;
          min-height: 100%;
          place-items: center;
          overflow: hidden;
          isolation: isolate;
          background:
            radial-gradient(circle at 50% 54%, rgba(255, 255, 255, 0.96) 0, rgba(255, 255, 255, 0.34) 25rem, transparent 42rem),
            linear-gradient(135deg, rgba(80, 126, 191, 0.022) 25%, transparent 25%) 0 0 / 56px 56px,
            linear-gradient(315deg, rgba(80, 126, 191, 0.018) 25%, transparent 25%) 0 0 / 56px 56px,
            #f4f8fe;
          color: #202835;
        }

        .figma-creating-content {
          display: flex;
          width: min(21rem, calc(100vw - 3rem));
          transform: translateY(1.6rem);
          flex-direction: column;
          align-items: center;
        }

        .figma-creating-progress {
          width: 100%;
          height: 0.32rem;
          overflow: hidden;
          border: 1px solid rgba(33, 48, 73, 0.08);
          border-radius: 999px;
          background: rgba(29, 42, 63, 0.09);
        }

        .figma-creating-progress-fill {
          width: 100%;
          height: 100%;
          transform: scaleX(0.76);
          transform-origin: left center;
          border-radius: inherit;
          background: linear-gradient(90deg, #1f73f1 0%, #6a8cff 58%, #ad82f6 100%);
        }

        .figma-creating-label {
          margin: 0.78rem 0 0;
          color: #667386;
          font-size: 0.94rem;
          font-weight: 500;
        }
      `}</style>

      <section className="figma-creating-content" aria-live="polite">
        <div className="figma-creating-progress" role="progressbar" aria-label="正在打开 Figma">
          <div className="figma-creating-progress-fill" />
        </div>
        <p id="figma-creating-label" className="figma-creating-label">
          正在打开 Figma 并挂载 Agent…
        </p>
      </section>
    </main>
  )
}
