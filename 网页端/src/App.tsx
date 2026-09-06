import AgentPanelPage from './pages/AgentPanelPage'
import EditorPage from './pages/EditorPage'
import HomePage from './pages/HomePage'
import CreatingFigmaPage from './pages/CreatingFigmaPage'
import WorkspacePage from './pages/WorkspacePage'
import { RouterProvider, useRouter } from './router'
import './types/desktop'
import { useEffect, useState } from 'react'

function Routes() {
  const { route, navigate } = useRouter()
  const [chromeRequest, setChromeRequest] = useState({ home: 0, settings: 0, account: 0 })
  useEffect(() => window.designStudioHost?.onChromeAction?.((action) => {
    if (!['go-home', 'open-settings', 'open-account'].includes(action)) return
    navigate('home')
    const key = action === 'open-settings' ? 'settings' : action === 'open-account' ? 'account' : 'home'
    setChromeRequest((current) => ({ home: 0, settings: 0, account: 0,
      [key]: current.home + current.settings + current.account + 1 }))
  }), [navigate])
  if (route === 'creating') return <CreatingFigmaPage />
  if (route === 'workspace') return <WorkspacePage />
  if (route === 'agent') return <AgentPanelPage />
  return route === 'editor' ? <EditorPage /> : <HomePage chromeRequest={chromeRequest} />
}

export default function App() {
  return (
    <RouterProvider>
      <Routes />
    </RouterProvider>
  )
}
