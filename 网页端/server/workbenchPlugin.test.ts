import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { isLegacyDocument, isWorkbenchRequest } from './workbenchPlugin.ts'

test('工作台与原设计界面保留各自的 Agent、Figma 和 Vite 路由', () => {
  for (const pathname of ['/design.html', '/editor/123', '/workspace', '/agent']) {
    assert.equal(isLegacyDocument(pathname), true)
    assert.equal(isWorkbenchRequest(pathname), false)
  }
  for (const pathname of ['/api/agent/chat', '/api/agent/status', '/api/figma-bridge/pull', '/api/auth/figma/callback', '/api/local/figma-recents', '/api/desktop/status', '/@vite/client', '/src/main.tsx', '/assets/design.js']) {
    assert.equal(isWorkbenchRequest(pathname), false, pathname)
  }
  for (const pathname of ['/', '/home', '/home/project', '/__local/chat', '/__local/agent/stop', '/__local/editor', '/devops-api/session/history_message', '/vendor/workbench.js']) {
    assert.equal(isWorkbenchRequest(pathname), true, pathname)
  }
})

test('独立服务可保存项目与消息、预览文件，并停止本机模型流', { timeout: 15000 }, async context => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'astrix-web-service-'))
  const moduleURL = new URL('../workbench/server/application.mjs', import.meta.url)
  const { createWorkbenchApplication } = await import(moduleURL.href)
  let application: ReturnType<typeof createWorkbenchApplication>
  const server = createServer((request, response) => { void application.handle(request, response) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  application = createWorkbenchApplication({ port, surface: 'web', instanceId: 'isolated-web-test', dataDir: path.join(temporary, 'data'), workspaceRoot: path.join(temporary, 'workspace') })
  const model = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.write('data: {"choices":[{"delta":{"content":"本机测试流"}}]}\n\n')
    // Deliberately stay open until the workbench's stop endpoint aborts it.
  })
  await new Promise<void>(resolve => model.listen(0, '127.0.0.1', resolve))
  context.after(async () => {
    await application.close()
    server.closeAllConnections()
    model.closeAllConnections()
    await Promise.all([new Promise<void>(resolve => server.close(() => resolve())), new Promise<void>(resolve => model.close(() => resolve()))])
    await rm(temporary, { recursive: true, force: true })
  })
  const base = `http://127.0.0.1:${port}`
  const request = (url: string, method = 'GET', body?: unknown) => fetch(base + url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(6000) })
  const json = async (url: string, method = 'GET', body?: unknown) => {
    const response = await request(url, method, body)
    assert.equal(response.status, 200, url)
    return response.json()
  }
  const health = await json('/__local/health')
  assert.equal(health.app, 'astrix-workbench')
  assert.equal(health.surface, 'web')
  assert.equal(health.instanceId, 'isolated-web-test')
  const project = await json('/devops-api/project/v2/create', 'POST', { projectName: '隔离验证项目' })
  const { sessionId } = await json('/devops-api/session/v2/create', 'POST', { projectId: project.id })
  const demo = await (await request('/__local/chat', 'POST', { projectId: project.id, sessionId, humanMessage: '界面验证' })).text()
  assert.match(demo, /RUN_FINISHED/)
  assert.match(demo, /本地界面演示/)
  const history = await json('/devops-api/session/history_message?sessionId=' + sessionId)
  assert.deepEqual(history.map((message: { messageRole: string }) => message.messageRole), ['user', 'assistant'])
  const content = '<!doctype html><title>项目预览</title><h1>本机文件</h1>'
  await json('/__local/file', 'PUT', { path: 'index.html', content })
  assert.equal((await json('/__local/file?path=index.html')).content, content)
  const preview = await fetch(base + '/__local/preview')
  assert.equal(await preview.text(), content)
  assert.match(preview.headers.get('content-security-policy') || '', /sandbox allow-scripts/)
  assert.equal((await fetch(base + '/__local/model', { headers: { origin: 'https://example.invalid' } })).status, 403)
  const metadata = await json('/__local/figma/metadata?projectId=' + project.id)
  assert.equal(metadata.baseURL, base)
  assert.equal(metadata.port, port)
  const modelPort = (model.address() as AddressInfo).port
  await json('/__local/model', 'PUT', { mode: 'compatible', model: 'local-cancel-test', baseUrl: `http://127.0.0.1:${modelPort}/v1` })
  const stream = await request('/__local/chat', 'POST', { projectId: project.id, sessionId, humanMessage: '停止验证' })
  assert.ok(stream.body)
  const reader = stream.body.getReader()
  let events = ''
  while (!events.includes('本机测试流')) {
    const chunk = await reader.read()
    assert.equal(chunk.done, false)
    events += new TextDecoder().decode(chunk.value)
  }
  assert.equal((await json('/__local/agent/stop', 'POST', { sessionId })).success, true)
  for (;;) { const chunk = await reader.read(); if (chunk.done) break; events += new TextDecoder().decode(chunk.value) }
  assert.match(events, /任务已停止/)
  assert.match(events, /RUN_ERROR/)
  assert.doesNotMatch(events, /RUN_FINISHED/)
  assert.equal((await json('/__local/agent/stop', 'POST', { sessionId })).success, false)
})
