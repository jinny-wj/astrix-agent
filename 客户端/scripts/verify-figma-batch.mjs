import assert from 'node:assert/strict'

const origin = process.argv[2] || 'http://127.0.0.1:5380'
const bridge = `${origin}/api/figma-bridge`
const suffix = Date.now().toString(36)
const sessionId = `batch-session-${suffix}`
const fileKey = `batchFile${suffix}`

async function request(path, options = {}) {
  const response = await fetch(`${bridge}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  })
  const payload = await response.json()
  return { response, payload }
}

function selectedNode(id, name) {
  return {
    id,
    name,
    type: 'RECTANGLE',
    visible: true,
    locked: false,
    opacity: 1,
    x: 0,
    y: 0,
    width: 200,
    height: 320,
    supports: {
      text: false,
      fill: true,
      opacity: true,
      resize: true,
      move: true,
      visibility: true,
      rename: true,
    },
  }
}

const nodes = [
  selectedNode('person:1', '人物-主视觉'),
  selectedNode('person:2', '人物-副视觉'),
]

async function uploadSelection(revision) {
  const { response, payload } = await request('/selection', {
    method: 'POST',
    body: JSON.stringify({
      sessionId,
      fileKey,
      documentName: '批量人物测试',
      pageId: 'page:1',
      pageName: '人物海报',
      revision,
      updatedAt: Date.now(),
      nodes,
    }),
  })
  assert.equal(response.status, 200)
  assert.equal(payload.selectedCount, 2)
}

await uploadSelection(1)

const allRequest = await request('/instructions', {
  method: 'POST',
  body: JSON.stringify({
    sessionId,
    selectionRevision: 1,
    expectedFileKey: fileKey,
    scope: 'all',
    executionMode: 'atomic',
    message: '全部人物放大20%；右移20px',
    targets: nodes.map(({ id, name, type }) => ({ id, name, type })),
  }),
})
assert.equal(allRequest.response.status, 202)
assert.equal(allRequest.payload.nodeResults.length, 2)

const pulled = await request(`/pull?sessionId=${encodeURIComponent(sessionId)}`)
assert.equal(pulled.response.status, 200)
assert.equal(pulled.payload.commands.length, 1)
const [command] = pulled.payload.commands
assert.equal(command.fileKey, fileKey)
assert.equal(command.executionMode, 'atomic')
assert.deepEqual(command.targets.map((target) => target.nodeId), nodes.map((node) => node.id))
for (const target of command.targets) {
  assert.deepEqual(target.patches.map((patch) => patch.kind), ['scale', 'move'])
}

const ack = await request('/ack', {
  method: 'POST',
  body: JSON.stringify({
    results: [{
      id: command.id,
      ok: true,
      changedNodeIds: nodes.map((node) => node.id),
      nodeResults: nodes.map((node) => ({
        nodeId: node.id,
        nodeName: node.name,
        ok: true,
        status: 'success',
        changedPatchKinds: ['scale', 'move'],
      })),
      summary: '两个人物图层已统一修改',
    }],
  }),
})
assert.equal(ack.response.status, 200)

const completed = await request(`/results/${encodeURIComponent(command.id)}`)
assert.equal(completed.payload.pending, false)
assert.equal(completed.payload.result.succeededCount, 2)
assert.equal(completed.payload.result.failedCount, 0)
assert.deepEqual(
  completed.payload.result.nodeResults.map((result) => result.status),
  ['success', 'success'],
)

await uploadSelection(2)
const individual = await request('/instructions', {
  method: 'POST',
  body: JSON.stringify({
    sessionId,
    selectionRevision: 2,
    expectedFileKey: fileKey,
    scope: 'individual',
    targets: [
      { id: nodes[0].id, name: nodes[0].name, type: nodes[0].type, instruction: '透明度80%' },
      { id: nodes[1].id, name: nodes[1].name, type: nodes[1].type, instruction: '隐藏' },
    ],
  }),
})
assert.equal(individual.response.status, 202)
assert.equal(individual.payload.nodeResults.length, 2)

const wrongFile = await request('/instructions', {
  method: 'POST',
  body: JSON.stringify({
    sessionId,
    selectionRevision: 2,
    expectedFileKey: 'wrongFileKey',
    scope: 'all',
    message: '隐藏',
    targets: nodes.map(({ id, name, type }) => ({ id, name, type })),
  }),
})
assert.equal(wrongFile.response.status, 409)

const staleRevision = await request('/instructions', {
  method: 'POST',
  body: JSON.stringify({
    sessionId,
    selectionRevision: 1,
    expectedFileKey: fileKey,
    scope: 'all',
    message: '隐藏',
    targets: nodes.map(({ id, name, type }) => ({ id, name, type })),
  }),
})
assert.equal(staleRevision.response.status, 409)

const outsideSelection = await request('/instructions', {
  method: 'POST',
  body: JSON.stringify({
    sessionId,
    selectionRevision: 2,
    expectedFileKey: fileKey,
    scope: 'individual',
    message: '隐藏',
    targets: [{ id: 'person:outside', name: '越界图层', type: 'RECTANGLE' }],
  }),
})
assert.equal(outsideSelection.response.status, 409)

console.log(JSON.stringify({
  ok: true,
  allTargets: command.targets.length,
  individualTargets: individual.payload.nodeResults.length,
  rejected: ['wrong-file', 'stale-revision', 'outside-selection'],
}, null, 2))
