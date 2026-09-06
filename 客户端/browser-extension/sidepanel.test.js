import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'

const source = readFileSync(new URL('./sidepanel.js', import.meta.url), 'utf8')
const sendSource = source.slice(source.indexOf('function buildIndividualInstructionRequest('), source.indexOf('\ntabs.forEach('))
const normalizeSource = source.slice(source.indexOf('function normalizedSelection('), source.indexOf('function getSelectionSignature('))
const selection = {
  sessionId: 'test-session', fileKey: 'test-file', revision: 3,
  nodes: [{ id: '1:1', name: '甲', type: 'FRAME' }, { id: '1:2', name: '乙', type: 'FRAME' }],
}

function harness({ message = '透明度50%', result = { ok: true }, rejectRequest = false } = {}) {
  const requests = []
  const notes = []
  let chatCalls = 0
  const context = vm.createContext({
    BRIDGE_BASE: 'http://example.test/bridge', isSending: false,
    promptInput: { value: message, focus() {} }, activeSkill: '',
    CORE_SKILLS: new Set(), bridgeReachable: true, figmaSessionActive: true,
    currentSelection: selection, editScope: 'individual', activeFigmaFileKey: selection.fileKey,
    enabledLayerTargets: new Map([['1:1', true], ['1:2', false]]),
    layerInstructionDrafts: new Map([['1:1', '右移20px']]),
    sendButton: { setAttribute() {}, removeAttribute() {} },
    requestSelectionAttention: text => notes.push(text), scheduleSelectionPoll() {},
    appendUserMessage() {}, skillLabel: value => value,
    setComposerNote: text => notes.push(text),
    appendStreamBlock: () => ({ classList: { replace() {} }, querySelector: () => ({}) }),
    renderTargetResults() {}, commandResultDetail: () => '',
    fetchJson: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) })
      if (rejectRequest) throw new Error('选区已经变化')
      return { commandId: 'test-command', summary: '等待回执' }
    },
    waitForCommandResult: async () => result,
    streamAgentChat: async () => { chatCalls += 1 },
  })
  vm.runInContext(sendSource + normalizeSource, context)
  return { context, requests, notes, chatCalls: () => chatCalls }
}

test('individual send submits only enabled layers and combines common and per-layer edits', async () => {
  const h = harness()
  await h.context.sendPrompt()
  assert.equal(h.chatCalls(), 0)
  assert.equal(h.requests[0].url, 'http://example.test/bridge/instructions')
  assert.deepEqual(h.requests[0].body, {
    sessionId: 'test-session', selectionRevision: 3, expectedFileKey: 'test-file',
    scope: 'individual', executionMode: 'atomic',
    targets: [{ id: '1:1', name: '甲', type: 'FRAME', instruction: '透明度50%；右移20px' }],
  })
  assert.ok(h.notes.includes('修改已写回 Figma'))
})

test('per-layer edits can be sent without a common instruction', async () => {
  const h = harness({ message: '' })
  await h.context.sendPrompt()
  assert.equal(h.requests[0].body.targets[0].instruction, '右移20px')
})

test('deselecting every layer prevents sending', async () => {
  const h = harness()
  h.context.enabledLayerTargets.set('1:1', false)
  await h.context.sendPrompt()
  assert.equal(h.requests.length, 0)
  assert.equal(h.chatCalls(), 0)
  assert.match(h.notes[0], /至少勾选/)
})

test('rejected or failed writes never fall back to applying a common edit or show success', async () => {
  for (const options of [{ rejectRequest: true }, { result: { ok: false, message: '批次已回滚' } }, { result: null }]) {
    const h = harness(options)
    await h.context.sendPrompt()
    assert.equal(h.chatCalls(), 0)
    assert.ok(!h.notes.includes('修改已写回 Figma'))
  }
})

test('empty canvas retains its Bridge session through normalization and chat submission', async () => {
  const h = harness({ message: '新建一个画板' })
  h.context.currentSelection = h.context.normalizedSelection({ ...selection, nodes: [] })
  h.context.editScope = 'all'
  let sent
  h.context.streamAgentChat = async body => { sent = body }
  await h.context.sendPrompt()
  assert.equal(sent.selection.sessionId, selection.sessionId)
  assert.equal(sent.selection.nodes.length, 0)
  assert.equal(h.context.normalizedSelection({ ...selection, nodes: [null] }), null)
})
