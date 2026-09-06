import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import test from 'node:test'
import {
  createFigmaBridgeMiddleware,
  tryEnqueueNaturalLanguageInstruction,
  resolveWritableSelection,
} from './figmaBridgePlugin.ts'

const supports = {
  text: false,
  fill: true,
  opacity: true,
  resize: true,
  move: true,
  visibility: true,
  rename: true,
}

test('状态按文件隔离，切换选区后拒绝旧修改请求', async (context) => {
  const middleware = createFigmaBridgeMiddleware()
  const server = createServer((request, response) => middleware(request, response, () => response.end()))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  context.after(() => server.close())
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/figma-bridge`
  const original = {
    sessionId: 'live-selection-test', fileKey: 'selection-file', pageId: '0:1', pageName: 'Page',
    revision: 1, updatedAt: Date.now(), nodes: [node('1:1', '当前图层')],
  }
  const publish = async (selection: typeof original) => {
    const response = await fetch(`${base}/selection`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(selection),
    })
    assert.equal(response.status, 200)
  }
  await publish(original)
  assert.equal(resolveWritableSelection(original).lock, 'selection')
  await publish({ ...original, sessionId: 'another-selection', fileKey: 'another-file' })
  const read = async (key: string) => (await (await fetch(`${base}/status?fileKey=${key}`)).json()).selection
  assert.equal((await read(original.fileKey)).sessionId, original.sessionId)
  assert.equal(await read('not-connected'), null)
  await publish({ ...original, revision: 2, nodes: [node('2:2', '新图层')] })
  assert.throws(() => resolveWritableSelection(original), /选区已改变/)
  await publish({ ...original, revision: 3, nodes: [] })
  assert.deepEqual((await read(original.fileKey)).nodes, [])
  assert.throws(() => resolveWritableSelection(original), /选区已改变/)
})

function node(id: string, name: string) {
  return {
    id,
    name,
    type: 'FRAME',
    visible: true,
    locked: false,
    opacity: 1,
    x: 0,
    y: 0,
    width: 100,
    height: 200,
    fills: [{ r: 1, g: 1, b: 1 }],
    supports,
  }
}

test('batch instructions stay inside the revision-locked Figma selection', async (context) => {
  const middleware = createFigmaBridgeMiddleware()
  const server = createServer((request, response) => {
    middleware(request, response, () => {
      response.statusCode = 404
      response.end('Not Found')
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  context.after(() => server.close())
  const address = server.address() as AddressInfo
  const base = `http://127.0.0.1:${address.port}/api/figma-bridge`

  const json = async (
    path: string,
    init?: RequestInit,
  ): Promise<{ response: Response; body: Record<string, unknown> }> => {
    const response = await fetch(`${base}${path}`, init)
    return {
      response,
      body: await response.json() as Record<string, unknown>,
    }
  }
  const post = (path: string, body: unknown) => json(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  const selectedNodes = [node('1:1', '人物甲'), node('1:2', '人物乙')]
  const selection = {
    sessionId: 'batch-session',
    fileKey: 'fileKey_123',
    documentName: '人物战报',
    pageId: '0:1',
    pageName: 'Page 1',
    revision: 1,
    updatedAt: Date.now(),
    nodes: selectedNodes,
  }
  assert.equal((await post('/selection', selection)).response.status, 200)

  const all = await post('/instructions', {
    sessionId: selection.sessionId,
    selectionRevision: selection.revision,
    expectedFileKey: selection.fileKey,
    scope: 'all',
    message: '把这些人物统一放大20%；右移20px',
    targets: selectedNodes.map(({ id, name, type }) => ({ id, name, type })),
  })
  assert.equal(all.response.status, 202)
  assert.equal(all.body.scope, 'all')
  assert.equal((all.body.nodeResults as unknown[]).length, 2)

  const allCommandId = all.body.commandId as string
  const pulledAll = await json(`/pull?sessionId=${selection.sessionId}`)
  const allCommand = (pulledAll.body.commands as Array<Record<string, unknown>>)
    .find((command) => command.id === allCommandId)
  assert.ok(allCommand)
  assert.equal(allCommand.fileKey, selection.fileKey)
  assert.equal(allCommand.executionMode, 'atomic')
  const allTargets = allCommand.targets as Array<Record<string, unknown>>
  assert.deepEqual(allTargets.map((target) => target.nodeId), ['1:1', '1:2'])
  for (const target of allTargets) {
    assert.deepEqual(target.patches, [
      { kind: 'scale', factor: 1.2 },
      { kind: 'move', x: { mode: 'delta', value: 20 } },
    ])
  }

  const allAck = await post('/ack', {
    results: [{
      id: allCommandId,
      ok: true,
      changedNodeIds: ['1:1', '1:2'],
      nodeResults: [
        {
          nodeId: '1:1',
          ok: true,
          status: 'success',
          changedPatchKinds: ['scale', 'move'],
          summary: '人物甲已放大',
        },
        {
          nodeId: '1:2',
          ok: true,
          status: 'success',
          changedPatchKinds: ['scale', 'move'],
          summary: '人物乙已放大',
        },
      ],
    }],
  })
  assert.equal(allAck.response.status, 200)
  const allResult = await json(`/results/${encodeURIComponent(allCommandId)}`)
  assert.equal(allResult.body.pending, false)
  const completedAll = allResult.body.result as Record<string, unknown>
  assert.equal(completedAll.succeededCount, 2)
  assert.equal(completedAll.failedCount, 0)
  assert.equal(completedAll.partial, false)
  const completedAllNodes = completedAll.nodeResults as Array<Record<string, unknown>>
  assert.equal(completedAllNodes[0].status, 'success')
  assert.deepEqual(completedAllNodes[0].changedPatchKinds, ['scale', 'move'])

  selection.revision = 2
  selection.updatedAt += 1
  assert.equal((await post('/selection', selection)).response.status, 200)
  const individual = await post('/instructions', {
    sessionId: selection.sessionId,
    selectionRevision: selection.revision,
    expectedFileKey: selection.fileKey,
    scope: 'individual',
    message: '隐藏',
    executionMode: 'best-effort',
    targets: [
      { id: '1:1', name: '人物甲', type: 'FRAME', instruction: '透明度50%' },
      { id: '1:2', name: '人物乙', type: 'FRAME', instruction: '' },
    ],
  })
  assert.equal(individual.response.status, 202)
  assert.equal((individual.body.nodeResults as unknown[]).length, 2)
  const individualId = individual.body.commandId as string
  const pulledIndividual = await json(`/pull?sessionId=${selection.sessionId}`)
  const individualCommand = (pulledIndividual.body.commands as Array<Record<string, unknown>>)
    .find((command) => command.id === individualId)
  assert.ok(individualCommand)
  assert.equal(individualCommand.executionMode, 'best-effort')
  const individualTargets = individualCommand.targets as Array<Record<string, unknown>>
  assert.deepEqual(individualTargets[0].patches, [{ kind: 'set-opacity', value: 0.5 }])
  assert.deepEqual(individualTargets[1].patches, [{ kind: 'set-visible', value: false }])

  const outside = await post('/instructions', {
    sessionId: selection.sessionId,
    selectionRevision: selection.revision,
    expectedFileKey: selection.fileKey,
    scope: 'individual',
    targets: [{ id: '99:99', instruction: '隐藏' }],
  })
  assert.equal(outside.response.status, 409)
  assert.match(String(outside.body.error), /不在已锁定的当前选区/)

  const incompleteAll = await post('/instructions', {
    sessionId: selection.sessionId,
    selectionRevision: selection.revision,
    expectedFileKey: selection.fileKey,
    scope: 'all',
    message: '隐藏',
    targets: [{ id: '1:1' }],
  })
  assert.equal(incompleteAll.response.status, 409)
  assert.match(String(incompleteAll.body.error), /完整选区一致/)

  const wrongFile = await post('/instructions', {
    sessionId: selection.sessionId,
    selectionRevision: selection.revision,
    expectedFileKey: 'another_file',
    scope: 'all',
    message: '隐藏',
  })
  assert.equal(wrongFile.response.status, 409)

  const partialAck = await post('/ack', {
    results: [{
      id: individualId,
      ok: false,
      changedNodeIds: ['1:1'],
      message: '人物乙修改失败',
      nodeResults: [
        { nodeId: '1:1', ok: true, status: 'success' },
        { nodeId: '1:2', ok: false, status: 'error', message: '人物乙修改失败' },
      ],
    }],
  })
  assert.equal(partialAck.response.status, 200)
  const partialResult = await json(`/results/${encodeURIComponent(individualId)}`)
  const completedIndividual = partialResult.body.result as Record<string, unknown>
  assert.equal(completedIndividual.partial, true)
  assert.equal(completedIndividual.succeededCount, 1)
  assert.equal(completedIndividual.failedCount, 1)
  assert.equal((completedIndividual.nodeResults as unknown[]).length, 2)

  // Same-file sessions are resolved by the source event timestamp, not by
  // whichever heartbeat happened to arrive last.
  const newer = {
    ...selection,
    sessionId: 'newer-session',
    revision: 1,
    updatedAt: selection.updatedAt + 100,
    nodes: [node('2:1', '较新选区')],
  }
  const olderReceivedLast = {
    ...selection,
    sessionId: 'older-session',
    revision: 1,
    updatedAt: selection.updatedAt + 50,
    nodes: [node('2:2', '较旧选区')],
  }
  await post('/selection', newer)
  await post('/selection', olderReceivedLast)
  const resolvedByFile = await json(`/selection?fileKey=${selection.fileKey}`)
  const resolvedSelection = resolvedByFile.body.selection as Record<string, unknown>
  assert.equal(resolvedSelection.sessionId, newer.sessionId)

  assert.equal(
    tryEnqueueNaturalLanguageInstruction('帮我分析一下这个图层', newer),
    null,
  )
  const automatic = tryEnqueueNaturalLanguageInstruction('右移 12px，透明度 80%', newer)
  assert.ok(automatic)
  const pulledAutomatic = await json(`/pull?sessionId=${newer.sessionId}`)
  const automaticCommand = (pulledAutomatic.body.commands as Array<Record<string, unknown>>)
    .find((command) => command.id === automatic.commandId)
  assert.ok(automaticCommand)
  assert.deepEqual(
    (automaticCommand.targets as Array<Record<string, unknown>>)[0]?.patches,
    [
      { kind: 'move', x: { mode: 'delta', value: 12 } },
      { kind: 'set-opacity', value: 0.8 },
    ],
  )
})

test('OAuth 预览选区可写回正在运行的同一文件 Bridge', async (context) => {
  const middleware = createFigmaBridgeMiddleware()
  const server = createServer((request, response) => {
    middleware(request, response, () => {
      response.statusCode = 404
      response.end()
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  context.after(() => server.close())
  const address = server.address() as AddressInfo
  const json = async (path: string, init?: RequestInit) => {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/figma-bridge${path}`, init)
    return { response, body: await response.json() as Record<string, unknown> }
  }

  const live = {
    sessionId: 'figma-live',
    fileKey: 'fileKey_abc',
    pageId: '0:1',
    pageName: 'Page 1',
    revision: 4,
    updatedAt: Date.now(),
    nodes: [node('1:1', '当前选区')],
  }
  assert.equal((await json('/selection', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(live),
  })).response.status, 200)

  const oauth = {
    ...live,
    sessionId: 'oauth:fileKey_abc',
    revision: 999,
    nodes: [node('9:9', '预览按钮')],
  }
  const queued = tryEnqueueNaturalLanguageInstruction('改成红色', oauth)
  assert.ok(queued)
  const pulled = await json(`/pull?sessionId=${live.sessionId}`)
  const command = (pulled.body.commands as Array<Record<string, unknown>>)
    .find((item) => item.id === queued.commandId)
  assert.ok(command)
  assert.equal(command.sessionId, live.sessionId)
  assert.equal(command.lock, 'nodes')
  assert.equal(
    (command.targets as Array<Record<string, unknown>>)[0]?.nodeId,
    '9:9',
  )
})

test('OAuth 选区不会写到另一个文件的 Bridge', async (context) => {
  const middleware = createFigmaBridgeMiddleware()
  const server = createServer((request, response) => {
    middleware(request, response, () => {
      response.statusCode = 404
      response.end()
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  context.after(() => server.close())
  const address = server.address() as AddressInfo
  const response = await fetch(`http://127.0.0.1:${address.port}/api/figma-bridge/selection`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: 'figma-other',
      fileKey: 'file-other',
      pageId: '0:1',
      pageName: 'Page 1',
      revision: 1,
      updatedAt: Date.now(),
      nodes: [node('1:1', '别的文件')],
    }),
  })
  assert.equal(response.status, 200)

  assert.throws(
    () => tryEnqueueNaturalLanguageInstruction('改成红色', {
      sessionId: 'oauth:file-a',
      fileKey: 'file-a',
      pageId: 'current',
      pageName: '当前页面',
      revision: Date.now(),
      updatedAt: Date.now(),
      nodes: [node('9:9', '预览按钮')],
    }),
    /Design Studio Bridge/,
  )
})

test('空白文件可通过 Bridge 创建画板', async (context) => {
  const middleware = createFigmaBridgeMiddleware()
  const server = createServer((request, response) => {
    middleware(request, response, () => {
      response.statusCode = 404
      response.end()
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  context.after(() => server.close())
  const address = server.address() as AddressInfo
  const json = async (path: string, init?: RequestInit) => {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/figma-bridge${path}`, init)
    return { response, body: await response.json() as Record<string, unknown> }
  }

  const empty = {
    sessionId: 'figma-blank',
    fileKey: 'file-blank',
    pageId: '0:1',
    pageName: 'Page 1',
    revision: 1,
    updatedAt: Date.now(),
    nodes: [],
  }
  assert.equal((await json('/selection', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(empty),
  })).response.status, 200)

  assert.equal(
    tryEnqueueNaturalLanguageInstruction('帮我分析一下这个图层', empty),
    null,
  )
  assert.throws(
    () => tryEnqueueNaturalLanguageInstruction('改成红色', empty),
    /没有可写回的图层/,
  )

  const queued = tryEnqueueNaturalLanguageInstruction('创建一个 375×812 的画板', empty)
  assert.ok(queued)
  const pulled = await json(`/pull?sessionId=${empty.sessionId}`)
  const command = (pulled.body.commands as Array<Record<string, unknown>>)
    .find((item) => item.id === queued.commandId)
  assert.ok(command)
  assert.equal(command.type, 'create-frame')
  assert.equal(command.width, 375)
  assert.equal(command.height, 812)
})
