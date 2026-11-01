import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import type { AgentRuntime, AgentRunInput } from './types.ts'
import type { ConversationSnapshot } from './conversation.ts'

const require = createRequire(import.meta.url)
const { build } = createRequire(require.resolve('vite/package.json'))('esbuild')
const built = await build({
  entryPoints: [fileURLToPath(new URL('../agentPlugin.ts', import.meta.url))],
  bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent',
  plugins: [{ name: 'external-runtime-packages', setup(builder) {
    builder.onResolve({ filter: /^(exceljs|@anthropic-ai\/claude-agent-sdk)$/ }, args => ({ path: pathToFileURL(require.resolve(args.path)).href, external: true }))
  } }],
})
const { createAgentMiddleware } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`) as typeof import('../agentPlugin.ts')

async function fixture(t: test.TestContext, runtime?: AgentRuntime, bridge?: Parameters<typeof createAgentMiddleware>[0]['bridge']) {
  const directory = mkdtempSync(join(tmpdir(), 'astrix-conversation-http-'))
  const middleware = createAgentMiddleware({ backend: runtime ? 'shell' : 'auto', model: '', cwd: directory, conversationDirectory: join(directory, 'sessions'), bridge, ...(runtime ? { getRuntimes: () => [runtime] } : {}) })
  const server = createServer((req, res) => middleware(req, res, () => { res.statusCode = 404; res.end() }))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(directory, { recursive: true, force: true }) })
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return {
    directory, url,
    async post(body: object) {
      const response = await fetch(url + '/api/agent/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const text = await response.text()
      const events = text.split('\n\n').filter(block => block.includes('data: ')).map(block => {
        const event = block.match(/event: (.+)/)?.[1]
        const value = block.match(/data: (.+)/)?.[1]
        return { event, data: value ? JSON.parse(value) : undefined }
      })
      return { response, text, events, snapshot: events.filter(item => item.event === 'conversation').at(-1)?.data as ConversationSnapshot }
    },
  }
}
const meta: AgentRuntime['meta'] = { mode: 'local', model: 'mock-model', shell: false, backend: 'local-shell' }
const selection = { sessionId: 'mock', fileKey: 'mock-file', pageId: 'page', pageName: 'Page', revision: 1, updatedAt: 1,
  nodes: [{ id: '1:2', name: '标题', type: 'TEXT', visible: true, locked: false, characters: 'Spring 活动 5.1-5.11', supports: { text: true, fill: true, opacity: true, resize: true, move: true, visibility: true, rename: true } }] }

test('关键缺项在运行任何模型和Bridge前暂停，GET能恢复问题和原任务', async t => {
  let calls = 0
  const f = await fixture(t, { meta, async *run() { calls++; yield { id: 'unexpected', kind: 'text', text: 'unexpected' } } })
  const response = await f.post({ requestId: randomUUID(), message: '美化这张主播照片' })
  assert.equal(response.snapshot.status, 'awaiting_user')
  assert.equal(calls, 0)
  assert.equal(response.snapshot.pending?.questions[0].id, 'source_image')
  assert.ok(response.snapshot.messages.some(m => m.kind === 'user'))
  assert.ok(response.snapshot.messages.some(m => m.kind === 'clarification'))
  const restored = await (await fetch(f.url + '/api/agent/conversations/' + response.snapshot.conversationId)).json() as ConversationSnapshot
  assert.deepEqual(restored, response.snapshot)
})

test('普通回答续接同一任务并传递完整上下文，模型多次追问不会提前执行', async t => {
  const calls: AgentRunInput[] = []
  let assessments = 0
  const runtime: AgentRuntime = { meta, async *run(input) {
    calls.push(input)
    if (input.phase === 'assess') {
      assessments++
      const text = assessments === 1
        ? '{"ready":false,"questions":[{"id":"style","label":"希望用什么视觉风格？"},{"id":"audience","label":"面向哪些人？"}]}'
        : assessments === 2
          ? '{"ready":false,"questions":[{"id":"audience","label":"面向哪些人？"}]}'
          : '{"ready":true,"questions":[]}'
      yield { id: randomUUID(), kind: 'text', text }
    } else yield { id: 'result', kind: 'text', text: '已给出设计方案；未写入 Figma。' }
  } }
  const f = await fixture(t, runtime)
  const first = await f.post({ requestId: randomUUID(), message: '为选中画板提供设计方案', selection })
  assert.equal(first.snapshot.status, 'awaiting_user')
  assert.equal(calls.filter(c => c.phase === 'execute').length, 0)
  const second = await f.post({ conversationId: first.snapshot.conversationId, requestId: randomUUID(), message: '风格用简洁商务' })
  assert.equal(second.snapshot.status, 'awaiting_user')
  assert.equal(calls.filter(c => c.phase === 'execute').length, 0)
  const third = await f.post({ conversationId: first.snapshot.conversationId, requestId: randomUUID(), message: '面向运营同学' })
  assert.equal(third.snapshot.status, 'completed')
  assert.equal(third.snapshot.taskId, first.snapshot.taskId)
  const executed = calls.find(c => c.phase === 'execute')!
  assert.equal(executed.selection?.fileKey, 'mock-file')
  assert.match(executed.message, /为选中画板提供设计方案/)
  assert.match(JSON.stringify(executed.history), /风格用简洁商务/)
  assert.match(JSON.stringify(executed.history), /面向哪些人/)
  assert.match(JSON.stringify(executed.history), /面向运营同学/)
  assert.equal(third.snapshot.messages.filter(m => m.kind === 'user').length, 3)
})

test('预检非法或试图调用工具时不会进入执行阶段', async t => {
  for (const invalid of ['好的，开始执行', '{"ready":true,"questions":[{"id":"value","label":"缺少数值"}]}']) {
    let executes = 0
    const f = await fixture(t, { meta, async *run(input) {
      if (input.phase === 'execute') executes++
      yield { id: 'invalid', kind: 'text', text: invalid }
    } })
    const result = await f.post({ requestId: randomUUID(), message: '给我一个设计建议' })
    assert.equal(result.snapshot.status, 'failed')
    assert.equal(executes, 0)
  }
  let executes = 0
  const f = await fixture(t, { meta, async *run(input) {
    if (input.phase === 'execute') executes++
    yield { id: 'tool', kind: 'tool', provider: 'mock', tool: 'write', action: 'not allowed', status: 'running' }
  } })
  const result = await f.post({ requestId: randomUUID(), message: '给我一个设计建议' })
  assert.equal(result.snapshot.status, 'failed')
  assert.equal(executes, 0)
})

test('模型未配置且未显式选CLI时保留ready任务，不自动调用本机Agent', async t => {
  const f = await fixture(t)
  const result = await f.post({ requestId: randomUUID(), message: '给我一个设计建议' })
  assert.equal(result.snapshot.status, 'ready')
  assert.equal(result.snapshot.originalRequest, '给我一个设计建议')
  assert.equal(result.snapshot.messages.filter(m => m.kind === 'tool').length, 0)
})

test('重复requestId不重复执行，取消后旧问题不能恢复任务', async t => {
  let executions = 0
  const runtime: AgentRuntime = { meta, async *run(input) {
    if (input.phase === 'execute') executions++
    yield { id: randomUUID(), kind: 'text', text: input.phase === 'assess' ? '{"ready":true,"questions":[]}' : '已完成分析' }
  } }
  const f = await fixture(t, runtime)
  const requestId = randomUUID()
  const first = await f.post({ requestId, message: '分析设计方案' })
  const duplicate = await f.post({ requestId, message: '分析设计方案' })
  assert.equal(duplicate.snapshot.conversationId, first.snapshot.conversationId)
  assert.equal(executions, 1)
  const cancelled = await (await fetch(f.url + '/api/agent/conversations/' + first.snapshot.conversationId + '/cancel', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json() as ConversationSnapshot
  assert.equal(cancelled.status, 'cancelled')
  const stale = await f.post({ conversationId: first.snapshot.conversationId, requestId: randomUUID(), message: '继续' })
  assert.equal(stale.response.status, 409)
  assert.equal(executions, 1)
})

test('原指令完整但缺选区，补选区后只将原始明确指令交Bridge，不拼聊天历史', async t => {
  const sent: string[] = []
  const f = await fixture(t, undefined, {
    enqueue(message) { sent.push(message); return { commandId: 'mock-complete', summary: '模拟属性修改', queueSize: 1, nodeResults: [] } },
    async wait() { return { id: 'mock-complete', ok: true, summary: '模拟回执' } },
  })
  const first = await f.post({ requestId: randomUUID(), message: '颜色改成红色' })
  assert.equal(first.snapshot.status, 'awaiting_user')
  assert.deepEqual(sent, [])
  const next = await f.post({ conversationId: first.snapshot.conversationId, requestId: randomUUID(), message: '已选中标题', selection, clarificationAnswer: { id: first.snapshot.pending!.id, answers: { target: '使用当前选区' } } })
  assert.equal(next.snapshot.status, 'completed')
  assert.deepEqual(sent, ['颜色改成红色'])
  assert.equal(next.snapshot.taskId, first.snapshot.taskId)
})

test('原请求缺颜色，确认红色后安全组装属性指令并拿到Bridge回执', async t => {
  const sent: string[] = []
  const f = await fixture(t, undefined, {
    enqueue(message) { sent.push(message); return { commandId: 'mock-color', summary: '模拟改色', queueSize: 1, nodeResults: [] } },
    async wait() { return { id: 'mock-color', ok: true } },
  })
  const first = await f.post({ requestId: randomUUID(), message: '把选中图层颜色改一下', selection })
  assert.equal(first.snapshot.status, 'awaiting_user')
  assert.deepEqual(first.snapshot.pending?.questions.map(q => q.id), ['color'])
  const next = await f.post({ conversationId: first.snapshot.conversationId, requestId: randomUUID(), message: '红色', clarificationAnswer: { id: first.snapshot.pending!.id, answers: { color: '红色' } } })
  assert.equal(next.snapshot.status, 'completed')
  assert.deepEqual(sent, ['颜色改成红色'])
  assert.ok(next.snapshot.messages.some(m => m.kind === 'figma-write' && m.status === 'success'))
})

test('标题改成色名存在内容与颜色歧义，必须先澄清而非直接替换文字', async t => {
  const sent: string[] = []
  const f = await fixture(t, undefined, {
    enqueue(message) { sent.push(message); return { commandId: 'mock-title-color', summary: '模拟改色', queueSize: 1, nodeResults: [] } },
    async wait() { return { id: 'mock-title-color', ok: true } },
  })
  const first = await f.post({ requestId: randomUUID(), message: '把标题改成红色', selection })
  assert.equal(first.snapshot.status, 'awaiting_user')
  assert.equal(first.snapshot.pending?.questions[0].id, 'edit_kind')
  assert.deepEqual(sent, [])
  const next = await f.post({ conversationId: first.snapshot.conversationId, requestId: randomUUID(), message: '修改文字颜色', clarificationAnswer: { id: first.snapshot.pending!.id, answers: { edit_kind: '修改文字颜色' } } })
  assert.equal(next.snapshot.status, 'completed')
  assert.deepEqual(sent, ['颜色改成红色'])
})

test('页面连接中断保留failed任务，用户重试可续接；不会被当成显式取消', async t => {
  let executions = 0
  let started!: () => void
  const executing = new Promise<void>(resolve => { started = resolve })
  const f = await fixture(t, { meta, async *run(input) {
    if (input.phase === 'assess') {
      yield { id: randomUUID(), kind: 'text', text: '{"ready":true,"questions":[]}' }
      return
    }
    executions++
    if (executions === 1) {
      started()
      await new Promise<never>((_resolve, reject) => input.signal?.addEventListener('abort', () => reject(new Error('mock disconnected')), { once: true }))
    }
    yield { id: 'resumed-result', kind: 'text', text: '继续完成原设计建议。' }
  } })
  const controller = new AbortController()
  const response = await fetch(f.url + '/api/agent/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: randomUUID(), message: '提供设计建议' }), signal: controller.signal })
  const reader = response.body!.getReader()
  let frames = ''
  let initial: ConversationSnapshot | undefined
  while (!initial) {
    const part = await reader.read()
    assert.equal(part.done, false)
    frames += new TextDecoder().decode(part.value)
    const data = frames.match(/event: conversation\ndata: ([^\n]+)/)?.[1]
    if (data) initial = JSON.parse(data) as ConversationSnapshot
  }
  await executing
  controller.abort()
  await reader.cancel().catch(() => {})
  let recovered: ConversationSnapshot | undefined
  for (let attempt = 0; attempt < 40; attempt++) {
    recovered = await (await fetch(f.url + '/api/agent/conversations/' + initial.conversationId)).json() as ConversationSnapshot
    if (recovered.status === 'failed') break
    await delay(5)
  }
  assert.equal(recovered?.status, 'failed')
  assert.equal(recovered?.originalRequest, '提供设计建议')
  const retry = await f.post({ conversationId: initial.conversationId, requestId: randomUUID(), message: '继续' })
  assert.equal(retry.snapshot.status, 'completed')
  assert.equal(retry.snapshot.taskId, initial.taskId)
})
