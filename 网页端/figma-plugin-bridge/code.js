/*!
 * Figma plugin main thread. It reports the current selection to the local
 * Design Studio bridge and applies structured write commands through the
 * Plugin API (Figma REST cannot write ordinary design nodes).
 */
figma.showUI(__html__, { width: 360, height: 300 })

try {
  figma.root.setRelaunchData({
    relaunch: '继续连接 Design Studio 写回',
  })
} catch {
  // Older Figma builds may not support relaunch data.
}

const BRIDGE_SESSION_ID = [
  'figma',
  Date.now().toString(36),
  Math.random().toString(36).slice(2, 10),
].join('-')

const processedResults = new Map()
const processingCommands = new Map()
let selectionRevision = 0

function finiteNumber(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum)
}

function isMixed(value) {
  return value === figma.mixed
}

async function ensureFont() {
  try {
    const font = { family: 'Inter', style: 'Regular' }
    await figma.loadFontAsync(font)
    return font
  } catch {
    const font = { family: 'Roboto', style: 'Regular' }
    await figma.loadFontAsync(font)
    return font
  }
}

async function loadFontsForTextNode(node) {
  const fonts = []

  if (node.characters.length > 0 && typeof node.getRangeAllFontNames === 'function') {
    const rangeFonts = node.getRangeAllFontNames(0, node.characters.length)
    for (const font of rangeFonts) fonts.push(font)
  } else if (!isMixed(node.fontName)) {
    fonts.push(node.fontName)
  }

  if (fonts.length === 0) {
    fonts.push(await ensureFont())
  }

  const uniqueFonts = new Map()
  for (const font of fonts) {
    if (!font || typeof font.family !== 'string' || typeof font.style !== 'string') continue
    uniqueFonts.set(font.family + '\u0000' + font.style, font)
  }

  for (const font of uniqueFonts.values()) {
    await figma.loadFontAsync(font)
  }
}

function normalizeColor(color) {
  if (!color || typeof color !== 'object') {
    throw new Error('填充颜色无效')
  }

  return {
    r: clamp(finiteNumber(color.r, 0), 0, 1),
    g: clamp(finiteNumber(color.g, 0), 0, 1),
    b: clamp(finiteNumber(color.b, 0), 0, 1),
    a: clamp(finiteNumber(color.a, 1), 0, 1),
  }
}

function solidPaint(color) {
  const normalized = normalizeColor(color)
  return {
    type: 'SOLID',
    color: {
      r: normalized.r,
      g: normalized.g,
      b: normalized.b,
    },
    opacity: normalized.a,
  }
}

function solidPaints(fills) {
  if (!Array.isArray(fills) || fills.length === 0) return []
  return fills.map(solidPaint)
}

function paintsWithUpdatedSolid(fills, color) {
  const nextSolid = solidPaint(color)
  if (!Array.isArray(fills)) return [nextSolid]

  let replaced = false
  const next = fills.map((paint) => {
    if (!replaced && paint && paint.type === 'SOLID') {
      replaced = true
      return Object.assign({}, paint, nextSolid)
    }
    return paint
  })

  // Preserve gradients and images. If no SOLID paint existed, add a solid
  // layer instead of deleting the existing visual treatment.
  if (!replaced) next.unshift(nextSolid)
  return next
}

async function resolveParent(parentId) {
  if (!parentId) return figma.currentPage
  const node = await figma.getNodeByIdAsync(parentId)
  if (node && 'appendChild' in node) return node
  return figma.currentPage
}

function supportsFreePosition(node) {
  if (!('x' in node) || !('y' in node)) return false
  const parent = node.parent
  if (
    parent
    && 'layoutMode' in parent
    && parent.layoutMode !== 'NONE'
  ) {
    return 'layoutPositioning' in node && node.layoutPositioning === 'ABSOLUTE'
  }
  return true
}

function serializeFills(node) {
  if (!('fills' in node)) return undefined
  const fills = node.fills
  if (isMixed(fills)) return 'MIXED'
  if (!Array.isArray(fills)) return []

  return fills
    .filter((paint) => paint && paint.type === 'SOLID')
    .map((paint) => ({
      r: clamp(finiteNumber(paint.color && paint.color.r, 0), 0, 1),
      g: clamp(finiteNumber(paint.color && paint.color.g, 0), 0, 1),
      b: clamp(finiteNumber(paint.color && paint.color.b, 0), 0, 1),
      a: clamp(finiteNumber(paint.opacity, 1), 0, 1),
    }))
}

function serializeSelectedNode(node) {
  const parent = node.parent
  const snapshot = {
    id: node.id,
    name: typeof node.name === 'string' ? node.name : node.type,
    type: node.type,
    parentId: parent && typeof parent.id === 'string' ? parent.id : undefined,
    visible: 'visible' in node ? node.visible !== false : true,
    locked: 'locked' in node ? node.locked === true : false,
    supports: {
      text: node.type === 'TEXT',
      fill: 'fills' in node,
      opacity: 'opacity' in node,
      resize: typeof node.resize === 'function' && 'width' in node && 'height' in node,
      move: supportsFreePosition(node),
      visibility: 'visible' in node,
      rename: 'name' in node,
    },
  }

  if ('opacity' in node) snapshot.opacity = finiteNumber(node.opacity, 1)
  if ('x' in node) snapshot.x = finiteNumber(node.x, 0)
  if ('y' in node) snapshot.y = finiteNumber(node.y, 0)
  if ('width' in node) snapshot.width = finiteNumber(node.width, 0)
  if ('height' in node) snapshot.height = finiteNumber(node.height, 0)
  if (node.type === 'TEXT') snapshot.characters = node.characters.slice(0, 2000)

  const fills = serializeFills(node)
  if (fills !== undefined) snapshot.fills = fills
  return snapshot
}

function currentFileKey() {
  return typeof figma.fileKey === 'string' && figma.fileKey.length > 0
    ? figma.fileKey
    : undefined
}

function selectionSnapshot() {
  selectionRevision += 1
  return {
    sessionId: BRIDGE_SESSION_ID,
    fileKey: currentFileKey(),
    documentName: figma.root && typeof figma.root.name === 'string'
      ? figma.root.name
      : undefined,
    pageId: figma.currentPage.id,
    pageName: figma.currentPage.name,
    revision: selectionRevision,
    updatedAt: Date.now(),
    nodes: figma.currentPage.selection.map(serializeSelectedNode),
  }
}

function publishSelection() {
  figma.ui.postMessage({
    type: 'selection-snapshot',
    snapshot: selectionSnapshot(),
  })
}

function resultFor(command, values) {
  return Object.assign(
    {
      id: command.id,
      ok: false,
      sessionId: BRIDGE_SESSION_ID,
      changedNodeIds: [],
      summary: typeof command.summary === 'string' ? command.summary : undefined,
      completedAt: Date.now(),
    },
    values,
  )
}

function fitClonesInFrame(frame, clones) {
  if (!clones.length) return
  const paddingX = Math.max(frame.width * 0.08, 24)
  const paddingTop = Math.max(frame.height * 0.2, 64)
  const paddingBottom = Math.max(frame.height * 0.12, 36)
  const boxW = Math.max(frame.width - paddingX * 2, 1)
  const boxH = Math.max(frame.height - paddingTop - paddingBottom, 1)

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const clone of clones) {
    if (!('x' in clone) || !('width' in clone)) continue
    minX = Math.min(minX, clone.x)
    minY = Math.min(minY, clone.y)
    maxX = Math.max(maxX, clone.x + clone.width)
    maxY = Math.max(maxY, clone.y + clone.height)
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return

  const srcW = Math.max(maxX - minX, 1)
  const srcH = Math.max(maxY - minY, 1)
  const scale = Math.min(boxW / srcW, boxH / srcH, 4)

  for (const clone of clones) {
    if (!('x' in clone) || !('width' in clone)) continue
    const relX = clone.x - minX
    const relY = clone.y - minY
    if ('resize' in clone) {
      try {
        clone.resize(Math.max(clone.width * scale, 1), Math.max(clone.height * scale, 1))
      } catch {
        if ('rescale' in clone) {
          try { clone.rescale(scale) } catch { /* ignore */ }
        }
      }
    } else if ('rescale' in clone) {
      try { clone.rescale(scale) } catch { /* ignore */ }
    }
    clone.x = relX * scale + paddingX + (boxW - srcW * scale) / 2
    clone.y = relY * scale + paddingTop + (boxH - srcH * scale) / 2
  }
}

async function applyCloneIntoFrame(command) {
  const frame = figma.createFrame()
  frame.name = command.name || 'Frame'
  frame.x = finiteNumber(command.x, 0)
  frame.y = finiteNumber(command.y, 0)
  frame.resize(
    Math.max(finiteNumber(command.width, 100), 1),
    Math.max(finiteNumber(command.height, 100), 1),
  )
  const paints = solidPaints(command.fills)
  if (paints.length) frame.fills = paints
  figma.currentPage.appendChild(frame)

  const changedNodeIds = [frame.id]
  const clones = []
  for (const sourceId of command.sourceNodeIds || []) {
    const source = await figma.getNodeByIdAsync(sourceId)
    if (!source || !('clone' in source)) continue
    if ('locked' in source && source.locked) continue
    const clone = source.clone()
    frame.appendChild(clone)
    clones.push(clone)
    changedNodeIds.push(clone.id)
  }
  fitClonesInFrame(frame, clones)

  if (Array.isArray(command.labels) && command.labels.length > 0) {
    const font = await ensureFont()
    for (const label of command.labels) {
      const text = figma.createText()
      text.fontName = font
      text.characters = String(label.characters || '')
      text.fontSize = finiteNumber(label.fontSize, 24)
      text.x = finiteNumber(label.x, 24)
      text.y = finiteNumber(label.y, 24)
      if (label.name) text.name = label.name
      const labelPaints = solidPaints(label.fills)
      if (labelPaints.length) text.fills = labelPaints
      frame.appendChild(text)
      changedNodeIds.push(text.id)
    }
  }

  figma.currentPage.selection = [frame]
  figma.viewport.scrollAndZoomIntoView([frame])
  publishSelection()
  figma.notify(`已写入「${frame.name}」`)
  return resultFor(command, {
    ok: true,
    nodeId: frame.id,
    changedNodeIds,
    summary: `已在 Figma 创建 ${frame.name}`,
  })
}

function validatePatchForNode(node, patch) {
  if (!patch || typeof patch !== 'object') throw new Error('修改参数无效')

  switch (patch.kind) {
    case 'replace-text':
      if (node.type !== 'TEXT') throw new Error(`图层“${node.name}”不是文本图层`)
      if (typeof patch.value !== 'string') throw new Error('文本内容无效')
      if (patch.value.length > 20000) throw new Error('文本内容过长')
      break
    case 'set-fill-color':
      if (!('fills' in node)) throw new Error(`图层“${node.name}”不支持填充`)
      if (isMixed(node.fills)) {
        throw new Error(`图层“${node.name}”包含混合填充，为避免破坏图片请先拆分图层`)
      }
      if (
        Array.isArray(node.fills)
        && node.fills.some((paint) => paint && paint.type === 'IMAGE')
        && !node.fills.some((paint) => paint && paint.type === 'SOLID')
      ) {
        throw new Error(`图层“${node.name}”是纯图片填充，没有可安全修改的纯色填充`)
      }
      normalizeColor(patch.color)
      break
    case 'set-opacity': {
      if (!('opacity' in node)) throw new Error(`图层“${node.name}”不支持透明度`)
      const opacity = finiteNumber(patch.value, NaN)
      if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
        throw new Error('透明度必须在 0 到 1 之间')
      }
      break
    }
    case 'resize':
      if (typeof node.resize !== 'function' || !('width' in node) || !('height' in node)) {
        throw new Error(`图层“${node.name}”不支持调整尺寸`)
      }
      validateAxisChange(patch.width, '宽度')
      validateAxisChange(patch.height, '高度')
      if (!patch.width && !patch.height) throw new Error('没有提供宽度或高度')
      break
    case 'scale': {
      if (typeof node.resize !== 'function' || !('width' in node) || !('height' in node)) {
        throw new Error(`图层“${node.name}”不支持等比缩放`)
      }
      const factor = finiteNumber(patch.factor, NaN)
      if (!Number.isFinite(factor) || factor < 0.05 || factor > 20) {
        throw new Error('缩放比例必须在 0.05 到 20 之间')
      }
      break
    }
    case 'move':
      if (!supportsFreePosition(node)) {
        throw new Error(`图层“${node.name}”不支持移动`)
      }
      validateAxisChange(patch.x, 'X')
      validateAxisChange(patch.y, 'Y')
      if (!patch.x && !patch.y) throw new Error('没有提供移动方向')
      break
    case 'set-visible':
      if (!('visible' in node)) throw new Error(`图层“${node.name}”不支持显隐`)
      if (typeof patch.value !== 'boolean') throw new Error('显隐参数无效')
      break
    case 'rename':
      if (!('name' in node)) throw new Error(`图层“${node.name}”不支持重命名`)
      if (typeof patch.value !== 'string' || patch.value.trim().length === 0) {
        throw new Error('图层名称不能为空')
      }
      if (patch.value.trim().length > 300) throw new Error('图层名称过长')
      break
    default:
      throw new Error(`未知修改类型: ${String(patch.kind || '')}`)
  }
}

function validateAxisChange(change, label) {
  if (change === undefined) return
  if (!change || (change.mode !== 'set' && change.mode !== 'delta')) {
    throw new Error(label + '修改模式无效')
  }
  if (!Number.isFinite(Number(change.value))) {
    throw new Error(label + '数值无效')
  }
}

function axisValue(current, change) {
  if (!change) return current
  const value = Number(change.value)
  return change.mode === 'delta' ? current + value : value
}

function patchExecutionMode(command) {
  return command.executionMode === 'best-effort' ? 'best-effort' : 'atomic'
}

function nodeResult(target, values) {
  return Object.assign({
    nodeId: target && typeof target.nodeId === 'string' ? target.nodeId : '',
    nodeName: undefined,
    ok: false,
    status: 'error',
    patchCount: target && Array.isArray(target.patches) ? target.patches.length : 0,
    changedPatchKinds: [],
    summary: target && typeof target.summary === 'string' ? target.summary : undefined,
  }, values)
}

function commandExpectedFileKey(command) {
  if (typeof command.expectedFileKey === 'string') return command.expectedFileKey
  if (typeof command.fileKey === 'string') return command.fileKey
  return undefined
}

function commandLocksToNodeIds(command) {
  return command && command.lock === 'nodes'
}

function assertPatchCommandContext(command) {
  if (typeof command.sessionId !== 'string' || command.sessionId !== BRIDGE_SESSION_ID) {
    throw new Error('命令属于另一个 Figma 文件会话')
  }
  if (
    !commandLocksToNodeIds(command)
    && (!Number.isInteger(command.selectionRevision) || command.selectionRevision !== selectionRevision)
  ) {
    throw new Error('选区已变化，请重新发送指令')
  }

  const fileKey = currentFileKey()
  const expectedFileKey = commandExpectedFileKey(command)
  if (fileKey && expectedFileKey !== fileKey) {
    throw new Error('命令与当前 Figma 文件不匹配')
  }
  if (!fileKey && expectedFileKey) {
    throw new Error('当前 Figma 文件无法校验 fileKey，已拒绝写入')
  }
  if (!Array.isArray(command.targets) || command.targets.length === 0) {
    throw new Error('没有可修改的目标图层')
  }
}

function containingPage(node) {
  let current = node
  while (current && current.type !== 'PAGE') current = current.parent
  return current && current.type === 'PAGE' ? current : null
}

async function revealNodesOnCurrentPage(nodes) {
  const firstPage = containingPage(nodes[0])
  if (firstPage && firstPage !== figma.currentPage) {
    if (typeof figma.setCurrentPageAsync === 'function') {
      await figma.setCurrentPageAsync(firstPage)
    } else {
      figma.currentPage = firstPage
    }
  }
  const selectable = nodes.filter((node) => containingPage(node) === figma.currentPage)
  if (selectable.length === 0) return
  try {
    figma.currentPage.selection = selectable
  } catch {
    // lock=nodes 不依赖选区；跨页或不可选节点时仍继续写。
  }
}

function assertTargetsStillSelected(command, targetIds) {
  if (commandLocksToNodeIds(command)) return
  assertPatchCommandContext(command)
  const selectedIds = new Set(figma.currentPage.selection.map((node) => node.id))
  for (const nodeId of targetIds) {
    if (!selectedIds.has(nodeId)) throw new Error('选区已变化，请重新发送指令')
  }
}

async function preparePatchTarget(target, selectedIds, targetIds, requireSelected) {
  if (!target || typeof target.nodeId !== 'string' || target.nodeId.length === 0) {
    throw new Error('目标图层无效')
  }
  if (requireSelected && !selectedIds.has(target.nodeId)) throw new Error('目标图层已不在锁定选区')
  if (targetIds.has(target.nodeId)) throw new Error('命令包含重复的目标图层')
  targetIds.add(target.nodeId)

  const targetFileKey = typeof target.expectedFileKey === 'string'
    ? target.expectedFileKey
    : typeof target.fileKey === 'string'
      ? target.fileKey
      : undefined
  if (targetFileKey && targetFileKey !== currentFileKey()) {
    throw new Error('目标图层与当前 Figma 文件不匹配')
  }

  const node = await figma.getNodeByIdAsync(target.nodeId)
  if (!node || node.type === 'DOCUMENT' || node.type === 'PAGE') {
    throw new Error('找不到目标图层 ' + target.nodeId)
  }
  if (typeof target.expectedType === 'string' && target.expectedType !== node.type) {
    throw new Error(`图层“${node.name}”类型已变化`)
  }
  if ('locked' in node && node.locked) {
    throw new Error(`图层“${node.name}”已锁定，请先解锁`)
  }
  if (!Array.isArray(target.patches) || target.patches.length === 0) {
    throw new Error(`图层“${node.name}”没有修改内容`)
  }

  let simulatedWidth = 'width' in node ? Number(node.width) : undefined
  let simulatedHeight = 'height' in node ? Number(node.height) : undefined
  let simulatedX = 'x' in node ? Number(node.x) : undefined
  let simulatedY = 'y' in node ? Number(node.y) : undefined
  for (const patch of target.patches) {
    validatePatchForNode(node, patch)
    if (patch.kind === 'resize') {
      simulatedWidth = axisValue(simulatedWidth, patch.width)
      simulatedHeight = axisValue(simulatedHeight, patch.height)
      if (
        !Number.isFinite(simulatedWidth)
        || !Number.isFinite(simulatedHeight)
        || simulatedWidth <= 0
        || simulatedHeight <= 0
        || simulatedWidth > 100000
        || simulatedHeight > 100000
      ) {
        throw new Error('调整后的尺寸必须在 0 到 100000 之间')
      }
    }
    if (patch.kind === 'scale') {
      const previousWidth = simulatedWidth
      const previousHeight = simulatedHeight
      simulatedWidth *= Number(patch.factor)
      simulatedHeight *= Number(patch.factor)
      if (supportsFreePosition(node)) {
        simulatedX -= (simulatedWidth - previousWidth) / 2
        simulatedY -= (simulatedHeight - previousHeight) / 2
      }
      if (
        !Number.isFinite(simulatedWidth)
        || !Number.isFinite(simulatedHeight)
        || simulatedWidth <= 0
        || simulatedHeight <= 0
        || simulatedWidth > 100000
        || simulatedHeight > 100000
      ) {
        throw new Error('缩放后的尺寸必须在 0 到 100000 之间')
      }
      if (
        !Number.isFinite(simulatedX)
        || !Number.isFinite(simulatedY)
        || Math.abs(simulatedX) > 10000000
        || Math.abs(simulatedY) > 10000000
      ) {
        throw new Error('缩放后的位置超出安全范围')
      }
    }
    if (patch.kind === 'move') {
      simulatedX = axisValue(simulatedX, patch.x)
      simulatedY = axisValue(simulatedY, patch.y)
      if (
        !Number.isFinite(simulatedX)
        || !Number.isFinite(simulatedY)
        || Math.abs(simulatedX) > 10000000
        || Math.abs(simulatedY) > 10000000
      ) {
        throw new Error('调整后的位置超出安全范围')
      }
    }
  }
  return { target, node, patches: target.patches }
}

async function loadPatchFonts(item) {
  if (
    item.node.type === 'TEXT'
    && item.patches.some((patch) => patch.kind === 'replace-text')
  ) {
    await loadFontsForTextNode(item.node)
  }
}

function capturePatchState(item) {
  const node = item.node
  const kinds = new Set(item.patches.map((patch) => patch.kind))
  const state = {}
  if (kinds.has('replace-text')) state.characters = node.characters
  if (kinds.has('set-fill-color')) state.fills = Array.isArray(node.fills) ? node.fills.slice() : node.fills
  if (kinds.has('set-opacity')) state.opacity = node.opacity
  if (kinds.has('resize') || kinds.has('scale')) {
    state.width = node.width
    state.height = node.height
  }
  if (kinds.has('move') || (kinds.has('scale') && supportsFreePosition(node))) {
    state.x = node.x
    state.y = node.y
  }
  if (kinds.has('set-visible')) state.visible = node.visible
  if (kinds.has('rename')) state.name = node.name
  return state
}

function restorePatchState(item, state) {
  const node = item.node
  if (Object.prototype.hasOwnProperty.call(state, 'characters')) node.characters = state.characters
  if (Object.prototype.hasOwnProperty.call(state, 'fills')) node.fills = state.fills
  if (
    Object.prototype.hasOwnProperty.call(state, 'width')
    && Object.prototype.hasOwnProperty.call(state, 'height')
  ) {
    node.resize(state.width, state.height)
  }
  if (Object.prototype.hasOwnProperty.call(state, 'x')) node.x = state.x
  if (Object.prototype.hasOwnProperty.call(state, 'y')) node.y = state.y
  if (Object.prototype.hasOwnProperty.call(state, 'opacity')) node.opacity = state.opacity
  if (Object.prototype.hasOwnProperty.call(state, 'visible')) node.visible = state.visible
  if (Object.prototype.hasOwnProperty.call(state, 'name')) node.name = state.name
}

function applyPreparedPatch(item) {
  const node = item.node
  for (const patch of item.patches) {
    switch (patch.kind) {
      case 'replace-text':
        node.characters = patch.value
        break
      case 'set-fill-color':
        // IMAGE and gradient paints are retained. This only adjusts supported
        // properties and never pretends to generate or replace a person.
        node.fills = paintsWithUpdatedSolid(node.fills, patch.color)
        break
      case 'set-opacity':
        node.opacity = Number(patch.value)
        break
      case 'resize':
        node.resize(
          axisValue(node.width, patch.width),
          axisValue(node.height, patch.height),
        )
        break
      case 'scale': {
        const previousWidth = node.width
        const previousHeight = node.height
        const nextWidth = previousWidth * Number(patch.factor)
        const nextHeight = previousHeight * Number(patch.factor)
        if (supportsFreePosition(node)) {
          node.x -= (nextWidth - previousWidth) / 2
          node.y -= (nextHeight - previousHeight) / 2
        }
        node.resize(nextWidth, nextHeight)
        break
      }
      case 'move':
        node.x = axisValue(node.x, patch.x)
        node.y = axisValue(node.y, patch.y)
        break
      case 'set-visible':
        node.visible = patch.value
        break
      case 'rename':
        node.name = patch.value.trim()
        break
    }
  }
}

function patchCommandResult(command, mode, nodeResults, changedNodeIds) {
  const succeededCount = nodeResults.filter((item) => item.ok).length
  const failedCount = nodeResults.length - succeededCount
  const partial = succeededCount > 0 && failedCount > 0
  const requestedSummary = typeof command.summary === 'string' && command.summary
    ? command.summary
    : `已处理 ${nodeResults.length} 个图层`
  const summary = failedCount === 0
    ? requestedSummary
    : partial
      ? `${requestedSummary}：成功 ${succeededCount} 个，失败 ${failedCount} 个`
      : `未修改图层：${failedCount} 个目标执行失败`

  return resultFor(command, {
    ok: failedCount === 0,
    executionMode: mode,
    partial,
    succeededCount,
    failedCount,
    changedNodeIds,
    nodeResults,
    summary,
    ...(failedCount > 0 ? { message: summary } : {}),
  })
}

async function applyAtomicPatchCommand(command) {
  const selectedIds = new Set(figma.currentPage.selection.map((node) => node.id))
  const targetIds = new Set()
  const prepared = []
  const nodeResults = []

  for (const target of command.targets) {
    try {
      const item = await preparePatchTarget(
        target,
        selectedIds,
        targetIds,
        !commandLocksToNodeIds(command),
      )
      prepared.push(item)
      nodeResults.push(nodeResult(target, {
        nodeName: item.node.name,
        status: 'skipped',
        message: '等待原子执行',
      }))
    } catch (error) {
      nodeResults.push(nodeResult(target, {
        message: error instanceof Error ? error.message : String(error),
      }))
    }
  }

  if (commandLocksToNodeIds(command) && prepared.length > 0) {
    await revealNodesOnCurrentPage(prepared.map((item) => item.node))
  }

  if (prepared.length !== command.targets.length) {
    for (const item of nodeResults) {
      if (item.status === 'skipped') item.message = '原子模式预检未通过，未执行'
    }
    return patchCommandResult(command, 'atomic', nodeResults, [])
  }

  for (let index = 0; index < prepared.length; index += 1) {
    try {
      await loadPatchFonts(prepared[index])
    } catch (error) {
      nodeResults[index] = nodeResult(prepared[index].target, {
        nodeName: prepared[index].node.name,
        message: error instanceof Error ? error.message : String(error),
      })
      for (let other = 0; other < nodeResults.length; other += 1) {
        if (other !== index) nodeResults[other].message = '原子模式字体预加载失败，未执行'
      }
      return patchCommandResult(command, 'atomic', nodeResults, [])
    }
  }

  try {
    assertTargetsStillSelected(command, targetIds)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    for (const item of nodeResults) item.message = message
    return patchCommandResult(command, 'atomic', nodeResults, [])
  }

  const states = prepared.map(capturePatchState)
  let failedIndex = -1
  try {
    for (let index = 0; index < prepared.length; index += 1) {
      failedIndex = index
      applyPreparedPatch(prepared[index])
    }
  } catch (error) {
    const applyMessage = error instanceof Error ? error.message : String(error)
    let rollbackMessage = ''
    for (let index = prepared.length - 1; index >= 0; index -= 1) {
      try {
        restorePatchState(prepared[index], states[index])
      } catch (rollbackError) {
        rollbackMessage = rollbackError instanceof Error
          ? rollbackError.message
          : String(rollbackError)
      }
    }
    for (let index = 0; index < nodeResults.length; index += 1) {
      nodeResults[index] = nodeResult(prepared[index].target, {
        nodeName: prepared[index].node.name,
        status: index < failedIndex ? 'rolled-back' : index === failedIndex ? 'error' : 'skipped',
        message: rollbackMessage
          ? `执行失败且回滚异常：${applyMessage}；${rollbackMessage}`
          : index < failedIndex
            ? '其他图层执行失败，已回滚'
            : applyMessage,
      })
    }
    if (typeof figma.commitUndo === 'function') figma.commitUndo()
    return patchCommandResult(command, 'atomic', nodeResults, [])
  }

  for (let index = 0; index < prepared.length; index += 1) {
    nodeResults[index] = nodeResult(prepared[index].target, {
      nodeName: prepared[index].node.name,
      ok: true,
      status: 'success',
      changedPatchKinds: prepared[index].patches.map((patch) => patch.kind),
    })
  }
  if (typeof figma.commitUndo === 'function') figma.commitUndo()
  return patchCommandResult(command, 'atomic', nodeResults, prepared.map((item) => item.node.id))
}

async function applyBestEffortPatchCommand(command) {
  const selectedIds = new Set(figma.currentPage.selection.map((node) => node.id))
  const targetIds = new Set()
  const nodeResults = command.targets.map((target) => nodeResult(target, {
    status: 'skipped',
    message: '等待尽力执行',
  }))
  const preparedByIndex = new Map()
  const changedNodeIds = []
  let mutationAttempted = false

  // Resolve nodes and load every required font before the first mutation. This
  // keeps the selected-id lock meaningful while still allowing invalid targets
  // to fail independently in best-effort mode.
  for (let index = 0; index < command.targets.length; index += 1) {
    const target = command.targets[index]
    try {
      assertPatchCommandContext(command)
      const item = await preparePatchTarget(
        target,
        selectedIds,
        targetIds,
        !commandLocksToNodeIds(command),
      )
      await loadPatchFonts(item)
      preparedByIndex.set(index, item)
      nodeResults[index] = nodeResult(target, {
        nodeName: item.node.name,
        status: 'skipped',
        message: '等待尽力执行',
      })
    } catch (error) {
      nodeResults[index] = nodeResult(target, {
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  try {
    assertTargetsStillSelected(
      command,
      Array.from(preparedByIndex.values()).map((item) => item.node.id),
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    for (const [index, item] of preparedByIndex.entries()) {
      nodeResults[index] = nodeResult(item.target, {
        nodeName: item.node.name,
        message,
      })
    }
    return patchCommandResult(command, 'best-effort', nodeResults, [])
  }

  for (const [index, item] of preparedByIndex.entries()) {
    try {
      const state = capturePatchState(item)
      try {
        mutationAttempted = true
        applyPreparedPatch(item)
      } catch (error) {
        restorePatchState(item, state)
        throw error
      }
      changedNodeIds.push(item.node.id)
      nodeResults[index] = nodeResult(item.target, {
        nodeName: item.node.name,
        ok: true,
        status: 'success',
        changedPatchKinds: item.patches.map((patch) => patch.kind),
      })
    } catch (error) {
      nodeResults[index] = nodeResult(item.target, {
        nodeName: item.node.name,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  if (mutationAttempted && typeof figma.commitUndo === 'function') figma.commitUndo()
  return patchCommandResult(command, 'best-effort', nodeResults, changedNodeIds)
}

async function applyPatchCommand(command) {
  const mode = patchExecutionMode(command)
  try {
    assertPatchCommandContext(command)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const targets = Array.isArray(command.targets) ? command.targets : []
    if (targets.length === 0) {
      return resultFor(command, {
        ok: false,
        executionMode: mode,
        partial: false,
        succeededCount: 0,
        failedCount: 0,
        nodeResults: [],
        message,
        summary: message,
      })
    }
    return patchCommandResult(
      command,
      mode,
      targets.map((target) => nodeResult(target, { message })),
      [],
    )
  }
  const result = mode === 'best-effort'
    ? await applyBestEffortPatchCommand(command)
    : await applyAtomicPatchCommand(command)

  figma.notify(result.summary || (result.ok ? '批量修改完成' : '批量修改失败'))
  if (result.changedNodeIds.length > 0) publishSelection()
  return result
}

async function applyCommand(command) {
  if (!command || typeof command !== 'object') {
    return resultFor({ id: '' }, { ok: false, message: '命令格式无效' })
  }

  if (command.sessionId && command.sessionId !== BRIDGE_SESSION_ID) {
    return resultFor(command, { ok: false, message: '命令属于另一个 Figma 文件会话' })
  }

  switch (command.type) {
    case 'ping':
      return resultFor(command, { ok: true, message: 'pong' })
    case 'notify':
      figma.notify(String(command.message || ''))
      return resultFor(command, { ok: true })
    case 'create-frame': {
      const frame = figma.createFrame()
      frame.name = command.name || 'Frame'
      frame.x = finiteNumber(command.x, 0)
      frame.y = finiteNumber(command.y, 0)
      frame.resize(
        Math.max(finiteNumber(command.width, 100), 1),
        Math.max(finiteNumber(command.height, 100), 1),
      )
      const paints = solidPaints(command.fills)
      if (paints.length) frame.fills = paints
      ;(await resolveParent(command.parentId)).appendChild(frame)
      figma.currentPage.selection = [frame]
      figma.viewport.scrollAndZoomIntoView([frame])
      publishSelection()
      figma.notify(`已创建「${frame.name}」`)
      return resultFor(command, {
        ok: true,
        nodeId: frame.id,
        changedNodeIds: [frame.id],
        summary: `已创建画板「${frame.name}」`,
      })
    }
    case 'create-text': {
      const font = await ensureFont()
      const text = figma.createText()
      text.fontName = font
      text.characters = String(command.characters || '')
      text.fontSize = finiteNumber(command.fontSize, 16)
      text.x = finiteNumber(command.x, 0)
      text.y = finiteNumber(command.y, 0)
      if (command.name) text.name = command.name
      const paints = solidPaints(command.fills)
      if (paints.length) text.fills = paints
      ;(await resolveParent(command.parentId)).appendChild(text)
      figma.currentPage.selection = [text]
      figma.viewport.scrollAndZoomIntoView([text])
      publishSelection()
      figma.notify(`已创建文本「${text.name || text.characters}」`)
      return resultFor(command, {
        ok: true,
        nodeId: text.id,
        changedNodeIds: [text.id],
        summary: `已创建文本「${text.characters}」`,
      })
    }
    case 'set-characters': {
      const node = await figma.getNodeByIdAsync(command.nodeId)
      if (!node || node.type !== 'TEXT') {
        return resultFor(command, { ok: false, message: '目标不是文本节点' })
      }
      if ('locked' in node && node.locked) {
        return resultFor(command, { ok: false, message: '目标文本图层已锁定' })
      }
      await loadFontsForTextNode(node)
      node.characters = String(command.characters || '')
      return resultFor(command, { ok: true, nodeId: node.id, changedNodeIds: [node.id] })
    }
    case 'set-fills': {
      const node = await figma.getNodeByIdAsync(command.nodeId)
      if (!node || !('fills' in node)) {
        return resultFor(command, { ok: false, message: '目标不支持填充' })
      }
      if ('locked' in node && node.locked) {
        return resultFor(command, { ok: false, message: '目标图层已锁定' })
      }
      node.fills = solidPaints(command.fills)
      return resultFor(command, { ok: true, nodeId: node.id, changedNodeIds: [node.id] })
    }
    case 'clone-into-frame':
      return applyCloneIntoFrame(command)
    case 'patch-nodes':
      return applyPatchCommand(command)
    default:
      return resultFor(command, {
        ok: false,
        message: `未知命令: ${String(command.type || '')}`,
      })
  }
}

async function executeCommand(command) {
  const commandId = command && typeof command.id === 'string' ? command.id : ''
  if (commandId && processedResults.has(commandId)) {
    return processedResults.get(commandId)
  }
  if (commandId && processingCommands.has(commandId)) {
    return processingCommands.get(commandId)
  }

  const execution = (async () => {
    let result
    try {
      result = await applyCommand(command)
    } catch (error) {
      result = resultFor(command || { id: commandId }, {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      })
    }

    if (commandId) {
      processedResults.set(commandId, result)
      if (processedResults.size > 100) {
        const oldestId = processedResults.keys().next().value
        processedResults.delete(oldestId)
      }
    }
    return result
  })()

  if (commandId) processingCommands.set(commandId, execution)
  try {
    return await execution
  } finally {
    if (commandId) processingCommands.delete(commandId)
  }
}

figma.ui.onmessage = async (msg) => {
  if (!msg || typeof msg !== 'object') return

  if (msg.type === 'ui-ready') {
    publishSelection()
    return
  }

  if (msg.type === 'apply-commands') {
    const results = []
    for (const command of msg.commands || []) {
      results.push(await executeCommand(command))
    }
    figma.ui.postMessage({ type: 'ack-results', results })
  }
}

figma.on('selectionchange', publishSelection)
figma.on('currentpagechange', publishSelection)

// The UI also sends ui-ready; this initial publish covers hosts that finish
// loading the plugin UI synchronously.
setTimeout(publishSelection, 0)
