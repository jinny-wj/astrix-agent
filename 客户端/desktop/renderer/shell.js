const tabsElement = document.querySelector('[data-tabs]')
const locationElement = document.querySelector('[data-location]')
const backButton = document.querySelector('[data-action="back"]')
const forwardButton = document.querySelector('[data-action="forward"]')
const reloadIcon = document.querySelector('[data-reload-icon]')
const agentToggle = document.querySelector('[data-action="toggle-agent"]')
const serverLabel = document.querySelector('[data-server-label]')
const serverState = document.querySelector('[data-server-state]')
const profileImage = document.querySelector('[data-profile-image]')
const profilePlaceholder = document.querySelector('[data-profile-placeholder]')
const profileButton = document.querySelector('[data-action="open-account"]')
profileImage.addEventListener('error', () => {
  profileImage.hidden = true
  profilePlaceholder.toggleAttribute('hidden', false)
})

let currentState = null

function displayLocation(value) {
  try {
    const url = new URL(value)
    const path = url.pathname === '/' ? '' : url.pathname
    return `${url.hostname}${path}`
  } catch {
    return 'figma.com'
  }
}

function createTab(tab, activeTabId) {
  const element = document.createElement('div')
  element.className = `tab${tab.loading ? ' is-loading' : ''}`
  element.dataset.kind = tab.kind
  element.dataset.tabId = tab.id
  element.setAttribute('role', 'tab')
  element.setAttribute('tabindex', tab.id === activeTabId ? '0' : '-1')
  element.setAttribute('aria-selected', String(tab.id === activeTabId))
  element.title = tab.title

  const icon = document.createElement('span')
  icon.className = 'tab-icon'
  icon.textContent = tab.kind === 'home' ? '星' : 'F'
  icon.setAttribute('aria-hidden', 'true')

  const title = document.createElement('span')
  title.className = 'tab-title'
  title.textContent = tab.title

  element.append(icon, title)
  if (tab.closable) {
    const close = document.createElement('button')
    close.className = 'tab-close'
    close.type = 'button'
    close.dataset.action = 'close-tab'
    close.dataset.tabId = tab.id
    close.setAttribute('aria-label', `关闭 ${tab.title}`)
    close.textContent = '×'
    element.append(close)
  }
  return element
}

function render(state) {
  if (!state || !Array.isArray(state.tabs)) return
  currentState = state
  const profile = state.profile
  const avatarUrl = typeof profile?.avatarUrl === 'string' && profile.avatarUrl.startsWith('https:') ? profile.avatarUrl : null
  if (avatarUrl !== profileImage.getAttribute('src')) {
    profileImage.hidden = !avatarUrl
    profilePlaceholder.toggleAttribute('hidden', Boolean(avatarUrl))
    if (avatarUrl) profileImage.src = avatarUrl
    else profileImage.removeAttribute('src')
  }
  profileButton.title = profile?.name ? `账号：${profile.name}` : '连接账号'
  document.body.dataset.mode = state.activeKind === 'figma' ? 'figma' : 'home'
  tabsElement.replaceChildren(
    ...state.tabs.map((tab) => createTab(tab, state.activeTabId)),
  )

  const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId)
  locationElement.textContent = displayLocation(state.activeUrl)
  backButton.disabled = !activeTab?.canGoBack
  forwardButton.disabled = !activeTab?.canGoForward
  reloadIcon.textContent = activeTab?.loading ? '×' : '↻'
  agentToggle.setAttribute('aria-pressed', String(Boolean(state.agentVisible)))
  serverLabel.textContent = state.serverMode === 'embedded' ? '客户端服务' : '开发服务'
  serverState.title =
    state.serverMode === 'embedded'
      ? '应用内置本地服务正在运行'
      : '正在复用 127.0.0.1:5273 的开发服务'
}

document.addEventListener('click', (event) => {
  const target = event.target.closest('[data-action], [data-tab-id]')
  if (!target) return
  const action = target.dataset.action

  if (action === 'close-tab') {
    event.stopPropagation()
    window.desktopWorkspace.action('close-tab', target.dataset.tabId)
    return
  }
  if (action) {
    window.desktopWorkspace.action(action)
    return
  }
  if (target.classList.contains('tab') && target.dataset.tabId) {
    window.desktopWorkspace.action('activate-tab', target.dataset.tabId)
  }
})

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return
  const tab = event.target.closest('.tab[data-tab-id]')
  if (!tab) return
  event.preventDefault()
  window.desktopWorkspace.action('activate-tab', tab.dataset.tabId)
})

window.desktopWorkspace.onState(render)
