import { useEffect, useState } from 'react'
import { pingBrowserExtension } from '../config/figma'

const EXTENSION_PATH = '网页端/browser-extension'

export default function ExtensionInstallBanner() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (window.designStudioHost?.openFigmaLayer) return
    void pingBrowserExtension(900).then((ok) => setVisible(!ok))
  }, [])

  if (!visible) return null

  return (
    <div className="mx-auto mb-space-lg mt-space-md max-w-[1002px] rounded-[14px] border border-[#f0d9a6] bg-[#fffaf0] px-space-lg py-space-md text-[13px] leading-6 text-[#6b4f1d]">
      <strong className="text-[#4a3612]">网页版需要 Chrome 扩展才能显示右侧 Agent 输入框。</strong>
      <div className="mt-1">
        打开 <code className="rounded bg-white px-1.5 py-0.5 text-[12px]">chrome://extensions</code>，
        开启开发者模式，加载已解压扩展程序，选择项目目录下的
        <code className="mx-1 rounded bg-white px-1.5 py-0.5 text-[12px]">{EXTENSION_PATH}</code>，
        然后回到首页重新点「新建设计稿」。
      </div>
    </div>
  )
}
