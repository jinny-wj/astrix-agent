const DESIGN_STUDIO_SOURCE = 'design-studio-web'
const EXTENSION_SOURCE = 'design-studio-extension'

function postToWorkspace(message) {
  window.postMessage(
    {
      source: EXTENSION_SOURCE,
      ...message,
    },
    window.location.origin,
  )
}

function openFigmaWorkspace(message) {
  chrome.runtime
    .sendMessage({
      type: 'OPEN_FIGMA_WORKSPACE',
      intent: message.intent ?? null,
      url: message.url ?? null,
      requestId: message.requestId ?? null,
    })
    .then((result) => {
      postToWorkspace({
        type: 'FIGMA_WORKSPACE_READY',
        requestId: message.requestId ?? null,
        ok: Boolean(result?.ok),
        navigated: Boolean(result?.navigated),
      })
    })
    .catch(() => {
      postToWorkspace({
        type: 'FIGMA_WORKSPACE_READY',
        requestId: message.requestId ?? null,
        ok: false,
      })
    })
}

function returnRecentFigmaFiles(message) {
  chrome.runtime
    .sendMessage({
      type: 'GET_RECENT_FIGMA_FILES',
    })
    .then((result) => {
      postToWorkspace({
        type: 'RECENT_FIGMA_FILES',
        requestId: message.requestId ?? null,
        files: Array.isArray(result?.files) ? result.files : [],
      })
    })
    .catch(() => {
      postToWorkspace({
        type: 'RECENT_FIGMA_FILES',
        requestId: message.requestId ?? null,
        files: [],
      })
    })
}

function pingExtension() {
  chrome.runtime
    .sendMessage({ type: 'PING_EXTENSION' })
    .then((result) => {
      postToWorkspace({
        type: 'EXTENSION_STATUS',
        ok: Boolean(result?.ok),
        version: result?.version ?? null,
      })
    })
    .catch(() => {
      postToWorkspace({ type: 'EXTENSION_STATUS', ok: false })
    })
}

window.addEventListener('message', (event) => {
  if (event.source !== window || event.origin !== window.location.origin) {
    return
  }

  const message = event.data
  if (
    !message ||
    message.source !== DESIGN_STUDIO_SOURCE
  ) {
    return
  }

  if (message.type === 'OPEN_FIGMA_WORKSPACE') {
    openFigmaWorkspace(message)
    return
  }

  if (message.type === 'REQUEST_RECENT_FIGMA_FILES') {
    returnRecentFigmaFiles(message)
    return
  }

  if (message.type === 'PING_EXTENSION') {
    pingExtension()
  }
})

pingExtension()
