const FIGMA_DESIGN_RULE_ID = 'figma-design-pages'
const RECENT_FIGMA_FILES_KEY = 'recentFigmaFiles'
const MAX_RECENT_FIGMA_FILES = 20
const DEFAULT_FIGMA_URL = 'https://figma.new'

let recentFileWriteQueue = Promise.resolve()

function parseFigmaDesignUrl(value) {
  try {
    const url = new URL(value)
    const [type, key] = url.pathname.split('/').filter(Boolean)

    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'www.figma.com' ||
      type !== 'design' ||
      !key
    ) {
      return null
    }

    return {
      key: decodeURIComponent(key),
      url: url.href,
    }
  } catch {
    return null
  }
}

function normalizeRecentFigmaFile(value) {
  if (!value || typeof value !== 'object') {
    return null
  }

  const parsedUrl = parseFigmaDesignUrl(value.url)
  if (!parsedUrl) {
    return null
  }

  const title =
    typeof value.title === 'string' && value.title.trim()
      ? value.title.trim().slice(0, 300)
      : 'Figma 设计稿'
  const lastOpenedAt = Number(value.lastOpenedAt)

  return {
    key: parsedUrl.key,
    url: parsedUrl.url,
    title,
    lastOpenedAt: Number.isFinite(lastOpenedAt) ? lastOpenedAt : 0,
  }
}

async function readRecentFigmaFiles() {
  const stored = await chrome.storage.local.get(RECENT_FIGMA_FILES_KEY)
  const files = Array.isArray(stored[RECENT_FIGMA_FILES_KEY])
    ? stored[RECENT_FIGMA_FILES_KEY]
    : []

  return files
    .map(normalizeRecentFigmaFile)
    .filter(Boolean)
    .sort((left, right) => right.lastOpenedAt - left.lastOpenedAt)
    .slice(0, MAX_RECENT_FIGMA_FILES)
}

async function recordRecentFigmaFile(value) {
  const file = normalizeRecentFigmaFile({
    ...value,
    lastOpenedAt: Date.now(),
  })

  if (!file) {
    throw new Error('Invalid Figma design file record.')
  }

  const files = await readRecentFigmaFiles()
  const nextFiles = [
    file,
    ...files.filter((existingFile) => existingFile.key !== file.key),
  ].slice(0, MAX_RECENT_FIGMA_FILES)

  await chrome.storage.local.set({
    [RECENT_FIGMA_FILES_KEY]: nextFiles,
  })

  return nextFiles
}

function queueRecentFigmaFile(value) {
  const write = recentFileWriteQueue
    .catch(() => undefined)
    .then(() => recordRecentFigmaFile(value))

  recentFileWriteQueue = write
  return write
}

async function openAgentSidePanel(windowId, tabId) {
  await chrome.sidePanel.setOptions({
    path: 'sidepanel.html',
    enabled: true,
  })
  if (typeof tabId === 'number') {
    await chrome.sidePanel.setOptions({
      tabId,
      path: 'sidepanel.html',
      enabled: true,
    })
    await chrome.sidePanel.open({ tabId })
    return
  }
  await chrome.sidePanel.open({ windowId })
}

function installFigmaDesignRule() {
  chrome.action.disable()

  chrome.declarativeContent.onPageChanged.removeRules(
    [FIGMA_DESIGN_RULE_ID],
    () => {
      chrome.declarativeContent.onPageChanged.addRules([
        {
          id: FIGMA_DESIGN_RULE_ID,
          conditions: [
            new chrome.declarativeContent.PageStateMatcher({
              pageUrl: {
                schemes: ['https'],
                hostEquals: 'www.figma.com',
                pathPrefix: '/design/',
              },
            }),
          ],
          actions: [new chrome.declarativeContent.ShowAction()],
        },
      ])
    },
  )
}

chrome.runtime.onInstalled.addListener(installFigmaDesignRule)
installFigmaDesignRule()

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return
  if (!tab.url || !parseFigmaDesignUrl(tab.url)) return
  void openAgentSidePanel(tab.windowId, tabId).catch(() => {})
})

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'RECORD_FIGMA_FILE') {
    queueRecentFigmaFile(message.file)
      .then((files) => sendResponse({ ok: true, files }))
      .catch((error) => {
        console.error('Unable to record the Figma design file.', error)
        sendResponse({ ok: false, reason: 'record-failed' })
      })

    return true
  }

  if (message?.type === 'GET_RECENT_FIGMA_FILES') {
    recentFileWriteQueue
      .catch(() => undefined)
      .then(readRecentFigmaFiles)
      .then((files) => sendResponse({ ok: true, files }))
      .catch((error) => {
        console.error('Unable to read recent Figma design files.', error)
        sendResponse({ ok: false, files: [], reason: 'read-failed' })
      })

    return true
  }

  if (message?.type === 'PING_EXTENSION') {
    sendResponse({ ok: true, version: chrome.runtime.getManifest().version })
    return false
  }

  if (message?.type !== 'OPEN_FIGMA_WORKSPACE') {
    return false
  }

  const tabId = sender.tab?.id
  const windowId = sender.tab?.windowId
  if (typeof windowId !== 'number') {
    sendResponse({ ok: false, reason: 'missing-window' })
    return false
  }

  const targetUrl =
    typeof message.url === 'string' && message.url.trim()
      ? message.url.trim()
      : DEFAULT_FIGMA_URL

  Promise.resolve()
    .then(() =>
      chrome.storage.session.set({
        workspaceIntent: message.intent ?? null,
      }),
    )
    .then(() => openAgentSidePanel(windowId, tabId))
    .then(async () => {
      if (typeof tabId === 'number') {
        await chrome.tabs.update(tabId, { url: targetUrl })
      }
      sendResponse({ ok: true, navigated: true })
    })
    .catch((error) => {
      console.error('Unable to prepare the Figma workspace.', error)
      sendResponse({ ok: false, reason: 'open-failed' })
    })

  return true
})

chrome.action.onClicked.addListener(async (tab) => {
  if (typeof tab.id !== 'number') {
    return
  }

  try {
    await openAgentSidePanel(tab.windowId, tab.id)
  } catch (error) {
    console.error('Unable to open the Design Agent side panel.', error)
  }
})
