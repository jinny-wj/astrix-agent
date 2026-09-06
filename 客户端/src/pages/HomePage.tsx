import CaseGallery from '../components/CaseGallery'
import ExtensionInstallBanner from '../components/ExtensionInstallBanner'
import FeatureCards from '../components/FeatureCards'
import FigmaAccountMenu from '../components/FigmaAccountMenu'
import HeroSection from '../components/HeroSection'
import PromptInput from '../components/PromptInput'
import RecentFigma from '../components/RecentFigma'
import Sidebar, { type HomeNavKey } from '../components/Sidebar'
import { useEffect, useState } from 'react'
import { Link2, Settings2 } from 'lucide-react'
import WebCaptureDialog from '../components/WebCaptureDialog'
import { StudioSettingsDialog } from '../components/StudioHealth'
import './home-layout.css'
import { StudioHealthBanner, StudioSettingsButton } from '../components/StudioHealth'
import { beginCodeWorkspaceFile } from '../config/workspace'
import { useRouter } from '../router'

const SHOW_WORKFLOW_BANNER = false

export default function HomePage({ chromeRequest }: { chromeRequest?: { home: number; settings: number; account: number } }) {
  const { navigate } = useRouter()
  const [section, setSection] = useState<HomeNavKey>('generate')
  const [captureOpen, setCaptureOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  useEffect(() => {
    if (chromeRequest?.account) {
      setSettingsOpen(false)
      setCaptureOpen(false)
    }
  }, [chromeRequest?.account])
  useEffect(() => {
    if (chromeRequest?.settings) setSettingsOpen(true)
  }, [chromeRequest?.settings])
  useEffect(() => {
    if (!chromeRequest?.home) return
    setSection('generate')
    setSettingsOpen(false)
    setCaptureOpen(false)
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [chromeRequest?.home])
  return (
    <div className="app-surface min-h-screen">
      <div
        className={`${SHOW_WORKFLOW_BANNER ? 'flex' : 'hidden'} relative z-40 h-[38px] items-center justify-center overflow-hidden bg-[linear-gradient(90deg,#8bd8ff_0%,#1da5f4_24%,#168cf0_100%)] px-space-4xl text-white`}
      >
        <div className="pointer-events-none absolute -left-space-2xl top-1/2 h-[88px] w-[220px] -translate-y-1/2 rounded-full bg-[radial-gradient(circle,#ffe3b8_0%,rgba(255,213,176,0.5)_34%,transparent_72%)] blur-[10px]" />
        <div className="relative flex min-w-0 items-center gap-space-sm text-[12px]">
          <span className="shrink-0 rounded-[6px] bg-white px-space-sm py-space-xs font-semibold text-[#1488d9]">
            Figma 工作流
          </span>
          <span className="truncate font-medium">
            输入设计需求，发送后进入新画布生成可继续编辑的视觉稿
          </span>
        </div>
      </div>

      <div className={SHOW_WORKFLOW_BANNER ? 'flex min-h-[calc(100vh-38px)]' : 'flex min-h-screen'}>
        <Sidebar active={section} onNavigate={(next) => {
          setSection(next)
          window.scrollTo({ top: 0, behavior: 'instant' })
        }} />
        <main className="studio-main scroll-clean relative min-w-0 flex-1" data-section={section}>
          <header className="studio-header relative z-30 flex flex-wrap items-center justify-end gap-space-md px-6 py-4">
            <FigmaAccountMenu openRequest={chromeRequest?.account} />
            <StudioSettingsButton />
            <div className="flex rounded-[10px] border border-[#e7e9ed] bg-white/88 p-space-xs shadow-[0_2px_10px_rgba(15,20,25,0.035)] backdrop-blur-xl">
              <button type="button" className="h-[28px] rounded-[7px] bg-white px-space-lg text-[12px] font-medium text-[#0f1419] shadow-[0_1px_4px_rgba(15,20,25,0.08)]">
                Design
              </button>
              <button
                type="button"
                title="根据 Figma 选区生成 React + Tailwind"
                onClick={() => {
                  const file = beginCodeWorkspaceFile()
                  navigate('editor', { fileId: file.fileId })
                }}
                className="h-[28px] rounded-[7px] px-space-lg text-[12px] font-medium text-[#536471] hover:text-[#0f1419]"
              >
                Code
              </button>
            </div>
          </header>

          <div className="studio-content mx-auto w-full max-w-[1168px] px-6 pb-16 lg:px-8">
            <div hidden={section !== 'generate'}>
            <div id="home-generate"><HeroSection /></div>
            <ExtensionInstallBanner />
            <StudioHealthBanner />
            <PromptInput />
            <FeatureCards />
            </div>
            <div hidden={section !== 'generate' && section !== 'assets'}>
              {section === 'assets' && <p className="mb-2 text-[13px] text-[#9199a6]">资产 / Figma 项目</p>}
              <RecentFigma />
            </div>
            <div hidden={section !== 'generate' && section !== 'creative'}>
              <CaseGallery />
            </div>
            {section === 'tools' && (
              <section className="pt-6">
                <h1 className="text-[26px] font-semibold text-[#20242d]">工作台工具</h1>
                <p className="mt-2 text-sm text-[#87909e]">捕获网页参考，管理你的工作台配置。</p>
                <div className="mt-8 grid gap-5 sm:grid-cols-2">
                  <button type="button" onClick={() => setCaptureOpen(true)} className="studio-tool-card">
                    <Link2 size={26} /><strong>网页捕获</strong><span>将网页内容保存为设计参考</span>
                  </button>
                  <button type="button" onClick={() => setSettingsOpen(true)} className="studio-tool-card">
                    <Settings2 size={26} /><strong>工作台设置</strong><span>管理模型、连接与运行环境</span>
                  </button>
                </div>
                <div className="mt-10"><FeatureCards /></div>
              </section>
            )}
          </div>
          {captureOpen && <WebCaptureDialog onClose={() => setCaptureOpen(false)} />}
          {settingsOpen && <StudioSettingsDialog onClose={() => setSettingsOpen(false)} />}
        </main>
      </div>
    </div>
  )
}
