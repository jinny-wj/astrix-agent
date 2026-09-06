const BRIDGE_BASE = 'http://127.0.0.1:5273/api/figma-bridge'
const AGENT_BASE = 'http://127.0.0.1:5273/api/agent'
const SELECTION_POLL_MS = 900
const RESULT_POLL_MS = 800
const COMMAND_TIMEOUT_MS = 90000
const SKILL_LABELS = {
  'portrait-beautify': '一键美化',
  'kv-resource-extension': '资源位延展',
  'battle-report': '人物战报',
}
const CORE_SKILLS = new Set(Object.keys(SKILL_LABELS))

const tabs = Array.from(document.querySelectorAll('[data-tab]'))
const panels = Array.from(document.querySelectorAll('[data-panel]'))
const skillButtons = Array.from(document.querySelectorAll('[data-skill]'))
const selectedSkill = document.querySelector('.selected-skill')
const selectedSkillLabel = document.querySelector('[data-selected-skill-label]')
const clearSkillButton = document.querySelector('[data-clear-skill]')
const promptInput = document.querySelector('#agent-prompt')
const conversation = document.querySelector('.conversation')
const sendButton = document.querySelector('[data-send]')
const connectionStatus = document.querySelector('[data-connection-status]')
const contextTitle = document.querySelector('[data-context-title]')
const contextDescription = document.querySelector('[data-context-description]')
const selectionContext = document.querySelector('[data-selection-context]')
const selectionLabel = document.querySelector('[data-selection-label]')
const selectionPage = document.querySelector('[data-selection-page]')
const selectionChips = document.querySelector('[data-selection-chips]')
const composerNote = document.querySelector('[data-composer-note]')
const batchEditor = document.querySelector('[data-batch-editor]')
const batchCount = document.querySelector('[data-batch-count]')
const scopeOptions = Array.from(document.querySelectorAll('[data-scope-option]'))
const scopeInputs = Array.from(document.querySelectorAll('input[name="edit-scope"]'))
const scopeHint = document.querySelector('[data-scope-hint]')
const layerInstructions = document.querySelector('[data-layer-instructions]')

let activeSkill = ''
let currentSelection = null
let selectionSignature = ''
let renderedBridgeReachable = null
let renderedFigmaSessionActive = null
let selectionPollTimer = null
let selectionPolling = false
let bridgeReachable = false
let figmaSessionActive = false
let consecutivePollFailures = 0
let isSending = false
let composerNoteTimer = null
let attentionTimer = null
let workspaceDescription = '等待同步当前 Figma 文件。'
let activeFigmaFileKey = ''
let editScope = 'all'
let layerInstructionDrafts = new Map()
let enabledLayerTargets = new Map()
let desktopContextGeneration = 0
let desktopContextActive = Boolean(globalThis.designStudioAgentHost)
let activeDesktopTabId = ''
let activeDesktopIntentRevision = null
let activeDesktopFileKey = ''
let autoStartedIntent = false
const workspaceDrafts = new Map()

function showPanel(panelName) {
  tabs.forEach((tab) => {
    const isActive = tab.dataset.tab === panelName
    tab.classList.toggle('is-active', isActive)
    tab.setAttribute('aria-selected', String(isActive))
  })

  panels.forEach((panel) => {
    panel.classList.toggle('is-active', panel.dataset.panel === panelName)
  })
}

function skillLabel(skillName) {
  return SKILL_LABELS[skillName] || skillName
}

function chooseSkill(skillName) {
  activeSkill = skillName
  selectedSkill.hidden = false
  selectedSkillLabel.textContent = skillLabel(skillName)
  showPanel('agent')
  promptInput.focus()
}

function clearSkill() {
  activeSkill = ''
  selectedSkill.hidden = true
  selectedSkillLabel.textContent = ''
}

function setEditScope(nextScope) {
  editScope = nextScope === 'individual' ? 'individual' : 'all'
  scopeInputs.forEach((input) => {
    input.checked = input.value === editScope
  })
  scopeOptions.forEach((option) => {
    option.classList.toggle('is-active', option.dataset.scopeOption === editScope)
  })
  const isIndividual = editScope === 'individual'
  layerInstructions.hidden = !isIndividual
  scopeHint.textContent = isIndividual
    ? '主输入作为共同要求；每层可补充不同要求或取消勾选。默认整批校验，失败会整批回滚。'
    : '主输入中的指令会作用于全部选中图层；默认整批校验，失败会整批回滚。'
  promptInput.placeholder = isIndividual
    ? '输入所有图层的共同要求（可选），再为各图层补充不同指令…'
    : '输入修改指令，例如：全部人物放大 20%；右移 20px；透明度 90%…'
}

function renderLayerInstructions(nodes) {
  layerInstructions.replaceChildren()

  nodes.forEach((node, index) => {
    if (!enabledLayerTargets.has(node.id)) enabledLayerTargets.set(node.id, true)

    const row = document.createElement('section')
    row.className = 'layer-instruction-row'

    const heading = document.createElement('div')
    heading.className = 'layer-instruction-heading'

    const targetLabel = document.createElement('label')
    targetLabel.className = 'layer-target-toggle'
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.checked = enabledLayerTargets.get(node.id) !== false
    checkbox.setAttribute('aria-label', `修改图层 ${node.name}`)
    checkbox.addEventListener('change', () => {
      enabledLayerTargets.set(node.id, checkbox.checked)
      row.classList.toggle('is-disabled', !checkbox.checked)
      input.disabled = !checkbox.checked
      updateBatchCount(nodes)
    })

    const indexBadge = document.createElement('span')
    indexBadge.className = 'layer-index'
    indexBadge.textContent = String(index + 1)

    const name = document.createElement('strong')
    name.textContent = node.name

    const type = document.createElement('small')
    type.textContent = node.type || 'NODE'

    targetLabel.append(checkbox, indexBadge, name)
    heading.append(targetLabel, type)

    const input = document.createElement('textarea')
    input.className = 'layer-instruction-input'
    input.rows = 2
    input.maxLength = 1200
    input.value = layerInstructionDrafts.get(node.id) || ''
    input.placeholder = `对「${node.name}」的补充要求（可选）`
    input.setAttribute('aria-label', `${node.name} 的单独修改要求`)
    input.disabled = !checkbox.checked
    input.addEventListener('input', () => {
      layerInstructionDrafts.set(node.id, input.value)
    })

    row.classList.toggle('is-disabled', !checkbox.checked)
    row.append(heading, input)
    layerInstructions.append(row)
  })
}

function enabledTargetCount(nodes) {
  if (editScope === 'all') return nodes.length
  return nodes.filter((node) => enabledLayerTargets.get(node.id) !== false).length
}

function updateBatchCount(nodes = currentSelection?.nodes ?? []) {
  const count = enabledTargetCount(nodes)
  batchCount.textContent = editScope === 'individual'
    ? `${count}/${nodes.length} 个目标`
    : `${nodes.length} 个目标`
}

function renderBatchEditor(selection) {
  const nodes = selection?.nodes ?? []
  const isBatch = nodes.length > 1
  batchEditor.hidden = !isBatch

  if (!isBatch) {
    if (nodes.length === 1) setEditScope('all')
    return
  }

  renderLayerInstructions(nodes)
  setEditScope(editScope)
  updateBatchCount(nodes)
}

function saveWorkspaceDraft(tabId = activeDesktopTabId) {
  if (!tabId) return
  workspaceDrafts.set(tabId, {
    prompt: promptInput.value,
    skill: activeSkill,
    scope: editScope,
    layerInstructions: Array.from(layerInstructionDrafts.entries()),
    enabledTargets: Array.from(enabledLayerTargets.entries()),
  })
}

function resetComposerDraft() {
  promptInput.value = ''
  clearSkill()
  editScope = 'all'
  layerInstructionDrafts = new Map()
  enabledLayerTargets = new Map()
  setEditScope('all')
}

function restoreWorkspaceDraft(tabId) {
  const draft = tabId ? workspaceDrafts.get(tabId) : null
  if (!draft) return false

  promptInput.value = typeof draft.prompt === 'string' ? draft.prompt : ''
  if (draft.skill) chooseSkill(draft.skill)
  else clearSkill()
  layerInstructionDrafts = new Map(Array.isArray(draft.layerInstructions) ? draft.layerInstructions : [])
  enabledLayerTargets = new Map(Array.isArray(draft.enabledTargets) ? draft.enabledTargets : [])
  setEditScope(draft.scope)
  return true
}

function setConnectionState(state, label) {
  connectionStatus.classList.toggle('is-connected', state === 'connected')
  connectionStatus.classList.toggle('is-error', state === 'error')
  connectionStatus.title =
    state === 'connected'
      ? '已连接本地 Figma Bridge'
      : state === 'error'
        ? '无法连接本地 Figma Bridge'
        : '正在等待本地 Figma Bridge'

  const textNode = Array.from(connectionStatus.childNodes).find(
    (node) => node.nodeType === Node.TEXT_NODE,
  )
  if (textNode) textNode.textContent = ` ${label}`
}

function setComposerNote(message, tone = '', resetAfter = 0) {
  if (composerNoteTimer) clearTimeout(composerNoteTimer)
  composerNote.classList.toggle('is-error', tone === 'error')
  composerNote.classList.toggle('is-success', tone === 'success')
  composerNote.textContent = message

  if (resetAfter > 0) {
    composerNoteTimer = setTimeout(() => {
      composerNote.classList.remove('is-error', 'is-success')
      composerNote.textContent = '选择图层后输入指令，⌘/Ctrl + Enter 发送'
    }, resetAfter)
  }
}

function applyWorkspaceIntent(intent) {
  if (!intent || (intent.kind !== 'new' && intent.kind !== 'existing')) {
    return
  }

  if (intent.kind === 'new') {
    contextTitle.textContent = '新建 Figma 设计稿'
    workspaceDescription = intent.skill
      ? `已预选「${skillLabel(intent.skill)}」。`
      : '已打开 Figma 新建设计稿。'
    if (intent.skill) chooseSkill(intent.skill)
    if (intent.prompt) promptInput.value = intent.prompt
  } else {
    contextTitle.textContent = intent.fileName || '当前 Figma 设计稿'
    workspaceDescription = '已打开真实 Figma 文件。'
  }

  renderSelection(currentSelection)

  if (intent.prompt && !autoStartedIntent) {
    autoStartedIntent = true
    window.setTimeout(() => {
      void sendPrompt({ allowWithoutSelection: true })
    }, 500)
  }
}

function normalizedSelection(selection) {
  if (
    !selection
    || typeof selection !== 'object'
    || typeof selection.sessionId !== 'string'
    || !Number.isFinite(selection.revision)
    || !Array.isArray(selection.nodes)
  ) {
    return null
  }

  const nodes = selection.nodes.filter(
    (node) =>
      node
      && typeof node === 'object'
      && typeof node.id === 'string'
      && typeof node.name === 'string',
  )
  if (nodes.length !== selection.nodes.length) return null

  return {
    ...selection,
    nodes,
  }
}

function getSelectionSignature(selection) {
  if (!selection) return ''
  return JSON.stringify([
    selection.sessionId,
    selection.fileKey,
    selection.revision,
    selection.pageId,
    selection.nodes.map((node) => [node.id, node.name, node.type]),
  ])
}

function renderSelection(selection) {
  renderedBridgeReachable = bridgeReachable
  renderedFigmaSessionActive = figmaSessionActive
  const nodes = selection?.nodes ?? []
  const hasSelection = nodes.length > 0
  selectionContext.classList.toggle('has-selection', hasSelection)
  selectionChips.replaceChildren()
  renderBatchEditor(selection)

  if (!hasSelection) {
    selectionLabel.textContent = '未选择图层'
    selectionPage.textContent = figmaSessionActive ? 'Figma 已连接' : '等待 Figma'

    const empty = document.createElement('span')
    empty.className = 'selection-empty'
    empty.textContent = figmaSessionActive
      ? '可输入“新建一个画板”；修改已有内容时请先选择图层'
      : '启动本地服务与 Figma Bridge 后即可同步选区'
    selectionChips.append(empty)
    contextDescription.textContent = `${workspaceDescription} 请在画布中选择要修改的图层。`
    return
  }

  selectionLabel.textContent = `${nodes.length} 个图层已选择`
  selectionPage.textContent = selection.pageName
    ? `${selection.pageName} · 已同步`
    : '当前页面 · 已同步'
  contextDescription.textContent = nodes.length > 1
    ? `已同步 ${nodes.length} 个图层，可统一修改，也可为每层设置不同要求。`
    : '已同步当前图层，输入指令后将直接写回当前 Figma 文件。'

  nodes.forEach((node) => {
    const chip = document.createElement('span')
    chip.className = 'selection-chip'
    chip.title = `${node.name} · ${node.type || 'NODE'} · ${node.id}`

    const name = document.createElement('span')
    name.className = 'selection-chip-name'
    name.textContent = node.name
    chip.append(name)

    if (node.type) {
      const type = document.createElement('span')
      type.className = 'selection-chip-type'
      type.textContent = node.type
      chip.append(type)
    }

    selectionChips.append(chip)
  })
}

function updateSelection(selection) {
  const normalized = normalizedSelection(selection)
  const nextSignature = getSelectionSignature(normalized)
  currentSelection = normalized
  if (
    nextSignature === selectionSignature
    && renderedBridgeReachable === bridgeReachable
    && renderedFigmaSessionActive === figmaSessionActive
  ) return
  selectionSignature = nextSignature
  renderSelection(currentSelection)
}

async function fetchJson(url, options = {}, timeoutMs = 5000) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      ...options,
      cache: 'no-store',
      signal: controller.signal,
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok) {
      const detail = payload?.error || payload?.message || `HTTP ${response.status}`
      throw new Error(detail)
    }
    return payload
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('本地 Figma Bridge 响应超时')
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

async function pollSelection() {
  if (selectionPolling || document.hidden) return
  selectionPolling = true
  const pollGeneration = desktopContextGeneration
  const expectedFileKey = activeFigmaFileKey

  try {
    if (desktopContextActive && !expectedFileKey) {
      bridgeReachable = false
      figmaSessionActive = false
      consecutivePollFailures = 0
      updateSelection(null)
      setConnectionState('waiting', '等待 Figma 文件')
      return
    }

    const selectionUrl = expectedFileKey
      ? `${BRIDGE_BASE}/selection?fileKey=${encodeURIComponent(expectedFileKey)}`
      : `${BRIDGE_BASE}/selection`
    const payload = await fetchJson(selectionUrl)
    if (pollGeneration !== desktopContextGeneration) return
    if (!payload || payload.ok !== true) {
      throw new Error(payload?.error || '选区同步失败')
    }

    bridgeReachable = true
    figmaSessionActive = Boolean(
      payload.selection
      && typeof payload.selection === 'object'
      && typeof payload.selection.sessionId === 'string',
    )
    consecutivePollFailures = 0
    updateSelection(payload.selection)
    setConnectionState(
      figmaSessionActive ? 'connected' : 'waiting',
      currentSelection?.nodes.length
        ? '选区已同步'
        : figmaSessionActive
          ? '等待选区'
          : '等待 Figma',
    )
  } catch (error) {
    if (pollGeneration !== desktopContextGeneration) return
    bridgeReachable = false
    figmaSessionActive = false
    consecutivePollFailures += 1
    setConnectionState('error', '连接失败')
    if (consecutivePollFailures >= 2) updateSelection(null)
  } finally {
    selectionPolling = false
    scheduleSelectionPoll()
  }
}

function scheduleSelectionPoll(delay = SELECTION_POLL_MS) {
  if (selectionPollTimer) clearTimeout(selectionPollTimer)
  selectionPollTimer = setTimeout(pollSelection, delay)
}

function selectionSummary(nodes) {
  const names = nodes.slice(0, 3).map((node) => node.name)
  if (nodes.length > 3) names.push(`等 ${nodes.length} 个图层`)
  return names.join('、')
}

function appendUserMessage(text, nodes, skillName, scope) {
  const article = document.createElement('article')
  article.className = 'message message-user'

  const body = document.createElement('div')
  body.className = 'message-body'

  const paragraph = document.createElement('p')
  paragraph.textContent = skillName ? `[${skillName}] ${text}` : text

  const note = document.createElement('span')
  if (nodes.length > 0) {
    const scopeLabel = scope === 'individual' ? '分别修改' : '统一修改'
    note.textContent = `${scopeLabel} ${nodes.length} 层：${selectionSummary(nodes)}`
  } else {
    note.textContent = '当前还没有锁定 Figma 选区，先走对话；选中图层后会写回画布。'
  }

  body.append(paragraph, note)
  article.append(body)
  conversation.append(article)
  scrollMessageIntoView(article)
}

function appendAgentMessage(title, detail) {
  const article = document.createElement('article')
  article.className = 'message message-agent message-pending'

  const avatar = document.createElement('div')
  avatar.className = 'avatar'
  avatar.setAttribute('aria-hidden', 'true')
  avatar.textContent = 'AI'

  const body = document.createElement('div')
  body.className = 'message-body'

  const paragraph = document.createElement('p')
  paragraph.textContent = title

  const note = document.createElement('span')
  note.textContent = detail

  body.append(paragraph, note)
  article.append(avatar, body)
  conversation.append(article)
  scrollMessageIntoView(article)
  return { article, paragraph, note }
}

function updateAgentMessage(message, state, title, detail) {
  message.article.classList.remove(
    'message-pending',
    'message-success',
    'message-error',
  )
  message.article.classList.add(`message-${state}`)
  message.paragraph.textContent = title
  message.note.textContent = detail
  scrollMessageIntoView(message.article)
}

function scrollMessageIntoView(article) {
  article.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
}

function fillMarkdown(container, text) {
  container.replaceChildren()
  const parts = String(text || '').split(/(!\[[^\]]*]\([^)]+\))/g)
  parts.forEach((part) => {
    const match = part.match(/^!\[([^\]]*)]\(([^)]+)\)$/)
    if (match) {
      const image = document.createElement('img')
      image.src = match[2]
      image.alt = match[1] || '预览'
      image.className = 'agent-preview-image'
      container.append(image)
      return
    }
    if (!part.trim()) return
    const paragraph = document.createElement('p')
    paragraph.textContent = part.trim()
    container.append(paragraph)
  })
}

function appendStreamBlock(kind, payload) {
  if (kind === 'user') return null
  const article = document.createElement('article')
  article.className = 'message message-agent'
  const avatar = document.createElement('div')
  avatar.className = 'avatar'
  avatar.setAttribute('aria-hidden', 'true')
  avatar.textContent = 'AI'
  const body = document.createElement('div')
  body.className = 'message-body'

  if (kind === 'skill') {
    const paragraph = document.createElement('p')
    paragraph.textContent = `已启用 Skill：${skillLabel(payload.name)}`
    const note = document.createElement('span')
    note.textContent = '后续步骤会读写当前 Figma 文件'
    body.append(paragraph, note)
  } else if (kind === 'tool') {
    article.classList.add(payload.status === 'error' ? 'message-error' : payload.status === 'success' ? 'message-success' : 'message-pending')
    const paragraph = document.createElement('p')
    paragraph.textContent = payload.action || payload.tool || '正在处理'
    const note = document.createElement('span')
    note.textContent = payload.note || payload.tool || ''
    body.append(paragraph, note)
  } else if (kind === 'figma-write') {
    article.classList.add(payload.status === 'error' ? 'message-error' : payload.status === 'success' ? 'message-success' : 'message-pending')
    const paragraph = document.createElement('p')
    paragraph.textContent = payload.summary || '已下发 Figma 写回'
    const note = document.createElement('span')
    note.textContent = payload.detail || ''
    body.append(paragraph, note)
    article.dataset.commandIds = JSON.stringify(payload.commandIds || [])
  } else if (kind === 'text') {
    fillMarkdown(body, payload.text || '')
  } else {
    const paragraph = document.createElement('p')
    paragraph.textContent = payload.title || payload.summary || payload.text || ''
    body.append(paragraph)
  }

  article.append(avatar, body)
  conversation.append(article)
  scrollMessageIntoView(article)
  return article
}

async function streamAgentChat(body, onMessage) {
  const response = await fetch(`${AGENT_BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    throw new Error(payload?.error || `Agent 请求失败（HTTP ${response.status}）`)
  }
  if (!response.body) throw new Error('浏览器不支持流式 Agent 响应')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let sawDone = false
  let streamError = ''

  const handleBlock = (block) => {
    if (!block.trim() || block.startsWith(':')) return
    let event = 'message'
    const dataLines = []
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
    }
    if (dataLines.length === 0) return
    const data = dataLines.join('\n')
    if (event === 'message') {
      try { onMessage(JSON.parse(data)) } catch { /* ignore */ }
      return
    }
    if (event === 'error') {
      try {
        streamError = JSON.parse(data)?.message || 'Agent 执行失败'
      } catch {
        streamError = 'Agent 执行失败'
      }
      return
    }
    if (event === 'done') sawDone = true
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n\n')
    buffer = parts.pop() ?? ''
    parts.forEach((part) => handleBlock(part))
  }
  if (buffer.trim()) handleBlock(buffer)
  if (streamError) throw new Error(streamError)
  if (!sawDone) throw new Error('Agent 连接提前结束，请重试')
}

function wait(duration) {
  return new Promise((resolve) => setTimeout(resolve, duration))
}

async function waitForCommandResult(commandId) {
  const deadline = Date.now() + COMMAND_TIMEOUT_MS
  while (Date.now() < deadline) {
    const payload = await fetchJson(
      `${BRIDGE_BASE}/results/${encodeURIComponent(commandId)}`,
    )
    if (!payload || payload.ok === false) {
      throw new Error(payload?.error || payload?.message || '读取执行结果失败')
    }
    if (!payload.pending) return payload.result ?? payload
    await wait(RESULT_POLL_MS)
  }
  throw new Error('Figma 执行超时，请确认插件仍在运行后重试')
}

function commandResultDetail(result, fallback) {
  if (Number.isFinite(result?.succeededCount) || Number.isFinite(result?.failedCount)) {
    return `成功 ${result.succeededCount || 0} 个，失败 ${result.failedCount || 0} 个`
  }
  if (Array.isArray(result?.changedNodeIds) && result.changedNodeIds.length > 0) {
    return `已更新 ${result.changedNodeIds.length} 个图层`
  }
  return result?.message || fallback
}

function resultRows(result) {
  if (Array.isArray(result?.nodeResults)) return result.nodeResults
  if (Array.isArray(result?.targetResults)) return result.targetResults
  if (Array.isArray(result?.results)) return result.results
  return []
}

function renderTargetResults(message, result, targets) {
  if (!Array.isArray(targets) || targets.length < 2) return

  message.results?.remove()
  const rows = resultRows(result)
  const rowsById = new Map(rows.map((row) => [row?.nodeId || row?.id, row]))
  const changedIds = new Set(Array.isArray(result?.changedNodeIds) ? result.changedNodeIds : [])
  const failedIds = new Set(Array.isArray(result?.failedNodeIds) ? result.failedNodeIds : [])
  const list = document.createElement('ul')
  list.className = 'batch-result-list'

  targets.forEach((target) => {
    const row = rowsById.get(target.id)
    const status = row?.status
      || (row?.ok === false || failedIds.has(target.id)
        ? 'error'
        : row?.ok === true || changedIds.has(target.id)
          ? 'success'
          : result?.ok === false
            ? 'error'
            : 'success')
    const success = status === 'success'
    const rolledBack = status === 'rolled-back'
    const skipped = status === 'skipped'

    const item = document.createElement('li')
    item.className = success
      ? 'is-success'
      : rolledBack
        ? 'is-rolled-back'
        : skipped
          ? 'is-skipped'
          : 'is-error'

    const name = document.createElement('strong')
    name.textContent = row?.name || row?.nodeName || target.name
    const detail = document.createElement('span')
    const kinds = Array.isArray(row?.changedPatchKinds)
      ? row.changedPatchKinds.join('、')
      : ''
    detail.textContent = row?.message || row?.summary
      || (success
        ? kinds ? `已修改：${kinds}` : '修改完成'
        : rolledBack
          ? '因批次失败已回滚'
          : skipped
            ? '本次未执行'
            : '修改失败')

    item.append(name, detail)
    list.append(item)
  })

  message.article.querySelector('.message-body')?.append(list)
  message.results = list
  scrollMessageIntoView(message.article)
}

function requestSelectionAttention(message) {
  if (attentionTimer) clearTimeout(attentionTimer)
  selectionContext.classList.add('is-attention')
  setComposerNote(message, 'error', 3600)
  attentionTimer = setTimeout(() => {
    selectionContext.classList.remove('is-attention')
  }, 1200)
  promptInput.focus()
}

function buildIndividualInstructionRequest(selection, message) {
  const targets = selection.nodes
    .filter((node) => enabledLayerTargets.get(node.id) !== false)
    .map((node) => {
      const instruction = [message.trim(), (layerInstructionDrafts.get(node.id) || '').trim()]
        .filter(Boolean).join('；')
      if (!instruction) throw new Error(`请填写「${node.name}」的修改要求`)
      return { id: node.id, name: node.name, type: node.type, instruction }
    })
  if (targets.length === 0) throw new Error('请至少勾选一个要修改的图层')
  return {
    sessionId: selection.sessionId,
    selectionRevision: selection.revision,
    expectedFileKey: selection.fileKey,
    scope: 'individual',
    executionMode: 'atomic',
    targets,
  }
}

async function sendPrompt(options = {}) {
  if (isSending) return
  const text = promptInput.value.trim()
  const individual = editScope === 'individual' && (currentSelection?.nodes.length ?? 0) > 1
  if (!text && !individual) {
    promptInput.focus()
    return
  }

  const skillName = activeSkill
  const isCoreSkill = CORE_SKILLS.has(skillName)
  const allowWithoutSelection = Boolean(options.allowWithoutSelection || isCoreSkill)

  if (!allowWithoutSelection && !bridgeReachable) {
    requestSelectionAttention('尚未连接 Figma Bridge，无法发送修改指令')
    return
  }
  if (!allowWithoutSelection && !figmaSessionActive) {
    requestSelectionAttention('请先在 Figma 中运行 Design Studio Bridge 插件')
    return
  }
  if (!allowWithoutSelection && !currentSelection) {
    requestSelectionAttention('请先连接当前文件的 Bridge；新建画板无需选择图层')
    return
  }

  const selection = currentSelection
    ? {
        ...currentSelection,
        nodes: currentSelection.nodes.map((node) => ({ ...node })),
      }
    : null
  const nodes = selection?.nodes ?? []
  const scope = nodes.length > 1 ? editScope : 'all'

  if (
    activeFigmaFileKey
    && selection?.fileKey
    && activeFigmaFileKey !== selection.fileKey
  ) {
    requestSelectionAttention('Figma 文件已切换，请等待新文件选区同步后再发送')
    scheduleSelectionPoll(0)
    return
  }

  let individualRequest = null
  try {
    if (individual) individualRequest = buildIndividualInstructionRequest(selection, text)
  } catch (error) {
    requestSelectionAttention(error.message)
    return
  }

  appendUserMessage(text || '按各图层要求分别修改', individualRequest?.targets ?? nodes, skillLabel(skillName), scope)
  isSending = true
  sendButton.disabled = true
  sendButton.setAttribute('aria-busy', 'true')
  setComposerNote('正在交给 Agent，写回前请保持 Bridge 插件运行')

  const queuedCommandIds = []

  try {
    if (individualRequest) {
      const queued = await fetchJson(`${BRIDGE_BASE}/instructions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(individualRequest),
      })
      if (!queued?.commandId) throw new Error('未收到 Figma 修改命令')
      const article = appendStreamBlock('figma-write', {
        summary: queued.summary, status: 'queued', commandIds: [queued.commandId],
      })
      try {
        const result = await waitForCommandResult(queued.commandId)
        renderTargetResults({ article }, result, individualRequest.targets)
        if (result?.ok !== true) throw new Error(result?.message || 'Figma 修改未成功')
        article.classList.replace('message-pending', 'message-success')
        article.querySelector('.message-body p').textContent = '修改已写回 Figma'
        article.querySelector('.message-body span').textContent = commandResultDetail(result, '')
      } catch (error) {
        article.classList.replace('message-pending', 'message-error')
        article.querySelector('.message-body p').textContent = 'Figma 修改未完成'
        throw error
      }
    } else {
      await streamAgentChat(
        {
          message: text,
          skill: skillName || undefined,
          source: 'figma-sidepanel',
          selection,
        },
        (message) => {
          if (!message || typeof message !== 'object') return
          appendStreamBlock(message.kind, message)
          if (message.kind === 'figma-write' && Array.isArray(message.commandIds)) {
            queuedCommandIds.push(...message.commandIds)
          }
        },
      )
    }

    promptInput.value = ''
    if (figmaSessionActive) {
      for (const commandId of queuedCommandIds) {
        try {
          const result = await waitForCommandResult(commandId)
          if (result?.ok !== true) {
            throw new Error(result?.message || result?.summary || 'Figma 修改未成功')
          }
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error)
          setComposerNote(detail, 'error', 6000)
          throw error
        }
      }
    }

    setComposerNote(
      individualRequest || queuedCommandIds.length > 0 ? '修改已写回 Figma' : 'Agent 已完成这一轮',
      'success',
      4200,
    )
    scheduleSelectionPoll(0)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    appendStreamBlock('text', { text: `没有完成：${message}` })
    setComposerNote(message, 'error', 6000)
  } finally {
    isSending = false
    sendButton.disabled = false
    sendButton.removeAttribute('aria-busy')
  }
}

tabs.forEach((tab) => {
  tab.addEventListener('click', () => showPanel(tab.dataset.tab))
})

scopeInputs.forEach((input) => {
  input.addEventListener('change', () => {
    if (!input.checked) return
    setEditScope(input.value)
    updateBatchCount()
  })
})

skillButtons.forEach((button) => {
  button.addEventListener('click', () => chooseSkill(button.dataset.skill))
})

document
  .querySelectorAll('[data-open-skills], [data-show-all-skills]')
  .forEach((button) => {
    button.addEventListener('click', () => showPanel('skills'))
  })

clearSkillButton.addEventListener('click', clearSkill)
sendButton.addEventListener('click', sendPrompt)

promptInput.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    event.preventDefault()
    void sendPrompt()
  }
})

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) scheduleSelectionPoll(0)
})

window.addEventListener('beforeunload', () => {
  saveWorkspaceDraft()
  if (selectionPollTimer) clearTimeout(selectionPollTimer)
})

if (globalThis.chrome?.storage?.session) {
  chrome.storage.session
    .get('workspaceIntent')
    .then(({ workspaceIntent }) => applyWorkspaceIntent(workspaceIntent))
    .catch(() => {})

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'session' || !changes.workspaceIntent) return
    applyWorkspaceIntent(changes.workspaceIntent.newValue)
  })
}

if (globalThis.designStudioAgentHost) {
  const applyDesktopContext = (context) => {
    if (!context || typeof context !== 'object') return
    const nextFileKey = typeof context.fileKey === 'string'
      ? context.fileKey
      : ''
    const nextTabId = typeof context.tabId === 'string' && context.tabId
      ? context.tabId
      : activeDesktopTabId || 'desktop-current'
    const nextIntentRevision = context.intentRevision ?? null
    const tabChanged = nextTabId !== activeDesktopTabId
    const fileChanged = nextFileKey !== activeDesktopFileKey
    const intentChanged = tabChanged || nextIntentRevision !== activeDesktopIntentRevision

    if (tabChanged) {
      saveWorkspaceDraft(activeDesktopTabId)
      resetComposerDraft()
    } else if (intentChanged) {
      saveWorkspaceDraft(activeDesktopTabId)
      resetComposerDraft()
    }

    activeDesktopTabId = nextTabId
    activeDesktopIntentRevision = nextIntentRevision
    activeDesktopFileKey = nextFileKey
    activeFigmaFileKey = nextFileKey

    if (tabChanged || fileChanged) {
      desktopContextGeneration += 1
      bridgeReachable = false
      figmaSessionActive = false
      consecutivePollFailures = 0
      currentSelection = null
      selectionSignature = ''
      renderSelection(null)
      setConnectionState('waiting', nextFileKey ? '同步新文件' : '等待 Figma 文件')
    }

    if (intentChanged) {
      applyWorkspaceIntent(context.intent)
      if (tabChanged) restoreWorkspaceDraft(nextTabId)
    }
    scheduleSelectionPoll(0)
  }

  if (globalThis.designStudioAgentHost.getContext) {
    globalThis.designStudioAgentHost
      .getContext()
      .then(applyDesktopContext)
      .catch(() => {})
    globalThis.designStudioAgentHost.onContext?.(applyDesktopContext)
  } else {
    globalThis.designStudioAgentHost
      .getIntent?.()
      .then((workspaceIntent) => applyWorkspaceIntent(workspaceIntent))
      .catch(() => {})
    globalThis.designStudioAgentHost.onIntent?.((workspaceIntent) => {
      applyWorkspaceIntent(workspaceIntent)
    })
  }
}

setEditScope('all')
renderSelection(null)
setConnectionState('waiting', '等待工作区')
void pollSelection()
