const FIGMA_DESIGN_PATH_SEGMENT = 'design'
const URL_CHECK_INTERVAL_MS = 800
const DOCK_WIDTH = 420
const DOCK_ID = 'design-studio-agent-dock'
const STYLE_ID = 'design-studio-agent-layout'

let lastReportedSignature = ''

function readCurrentFigmaFile() {
  try {
    const url = new URL(window.location.href)
    const [type, key] = url.pathname.split('/').filter(Boolean)

    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'www.figma.com' ||
      type !== FIGMA_DESIGN_PATH_SEGMENT ||
      !key
    ) {
      return null
    }

    return {
      key: decodeURIComponent(key),
      url: url.href,
      title: document.title.trim() || 'Figma 设计稿',
      lastOpenedAt: Date.now(),
    }
  } catch {
    return null
  }
}

function reportCurrentFigmaFile() {
  const file = readCurrentFigmaFile()
  if (!file) {
    return
  }

  const signature = `${file.url}\n${file.title}`
  if (signature === lastReportedSignature) {
    return
  }

  lastReportedSignature = signature
  chrome.runtime
    .sendMessage({
      type: 'RECORD_FIGMA_FILE',
      file,
    })
    .catch(() => {
      lastReportedSignature = ''
    })
}

function applyFigmaLayoutOffset() {
  let style = document.getElementById(STYLE_ID)
  if (!style) {
    style = document.createElement('style')
    style.id = STYLE_ID
    document.documentElement.appendChild(style)
  }

  style.textContent = `
    html, body {
      margin-right: ${DOCK_WIDTH}px !important;
      overflow-x: hidden !important;
    }
    #${DOCK_ID} {
      position: fixed !important;
      top: 0 !important;
      right: 0 !important;
      bottom: 0 !important;
      width: ${DOCK_WIDTH}px !important;
      z-index: 2147483647 !important;
      border-left: 1px solid #ececef !important;
      background: #fff !important;
      box-shadow: -8px 0 24px rgba(15, 20, 25, 0.06) !important;
    }
  `
}

function mountAgentDock() {
  if (!readCurrentFigmaFile()) return

  applyFigmaLayoutOffset()

  let dock = document.getElementById(DOCK_ID)
  if (!dock) {
    dock = document.createElement('aside')
    dock.id = DOCK_ID
    dock.setAttribute('aria-label', 'Design Agent')

    const frame = document.createElement('iframe')
    frame.title = 'Design Agent'
    frame.src = chrome.runtime.getURL('agent-frame.html')
    frame.allow = 'clipboard-read; clipboard-write'
    frame.style.cssText = 'width:100%;height:100%;border:0;background:#fff;display:block'
    dock.appendChild(frame)
  }

  const parent = document.body || document.documentElement
  if (dock.parentElement !== parent) {
    parent.appendChild(dock)
  }
}

function ensureAgentDock() {
  if (!document.body) return
  mountAgentDock()
  reportCurrentFigmaFile()
}

function boot() {
  ensureAgentDock()
  window.setInterval(ensureAgentDock, URL_CHECK_INTERVAL_MS)
  window.addEventListener('pageshow', ensureAgentDock)
  window.addEventListener('popstate', ensureAgentDock)
  window.addEventListener('hashchange', ensureAgentDock)
  document.addEventListener('visibilitychange', ensureAgentDock)
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true })
} else {
  boot()
}
