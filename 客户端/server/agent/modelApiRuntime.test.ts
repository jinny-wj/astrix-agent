import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import type { ModelApiSettings } from '../../src/types/modelApi.ts'
import type { AgentUiMessage } from './types.ts'

// Bundle the existing extensionless server imports, as desktop/server.test.mjs does.
const require = createRequire(import.meta.url)
const built = await build({
  entryPoints: [fileURLToPath(new URL('./modelApiRuntime.ts', import.meta.url))],
  bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent',
  plugins: [{ name: 'external-excel', setup(builder) {
    builder.onResolve({ filter: /^exceljs$/ }, (args) => ({
      path: pathToFileURL(require.resolve(args.path)).href, external: true,
    }))
  } }],
})
const { createModelApiRuntime, testModelApiConnection } = await import(
  `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`
) as typeof import('./modelApiRuntime.ts')

const settings: ModelApiSettings = {
  baseUrl: 'https://models.example.test/v1/',
  model: 'vendor/Model.1:precise',
  apiKey: 'mock-private-key',
  enabled: true,
}

function completion(content: unknown = '连接正常') {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    headers: { 'Content-Type': 'application/json' },
  })
}

async function collect(runtime = createModelApiRuntime(settings), input = { message: '只回复连接正常' }) {
  const messages: AgentUiMessage[] = []
  for await (const message of runtime.run(input)) messages.push(message)
  return messages
}

test('模型 API 发送精确模型、授权和仅文字请求，不跟随重定向', async (context) => {
  let requestUrl: string | undefined
  let requestInit: RequestInit | undefined
  context.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    requestUrl = url
    requestInit = init
    return completion('  已连接  ')
  })
  const runtime = createModelApiRuntime(settings)
  const messages = await collect(runtime)
  assert.deepEqual(runtime.meta, {
    mode: 'remote', model: settings.model, shell: false, backend: 'model-api',
  })
  assert.equal(requestUrl, 'https://models.example.test/v1/chat/completions')
  assert.equal(requestInit?.method, 'POST')
  assert.equal(requestInit?.redirect, 'error')
  assert.equal(requestInit?.credentials, 'omit')
  assert.equal(requestInit?.cache, 'no-store')
  assert.deepEqual(requestInit?.headers, {
    'Content-Type': 'application/json', Authorization: `Bearer ${settings.apiKey}`,
  })
  const body = JSON.parse(String(requestInit?.body))
  assert.equal(body.model, settings.model)
  assert.equal(body.stream, false)
  assert.equal(body.messages[0].role, 'system')
  assert.match(body.messages[0].content, /不能直接读取本机文件/)
  assert.match(body.messages[1].content, /用户请求：只回复连接正常/)
  assert.match(body.messages[1].content, /不能生成图片/)
  assert.equal(body.max_tokens, undefined)
  assert.deepEqual(messages.map((message) => message.kind), ['user', 'skill', 'text'])
  const last = messages.at(-1)
  assert.equal(last?.kind === 'text' ? last.text : '', '已连接')
})

test('连接测试发送固定小提示和单个输出 token，不回显服务文本', async (context) => {
  context.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body))
    assert.equal(body.model, settings.model)
    assert.equal(body.max_tokens, 1)
    assert.deepEqual(body.messages, [{ role: 'user', content: 'Reply OK.' }])
    return completion('mock-provider-private-output')
  })
  const result = await testModelApiConnection({ ...settings, enabled: false })
  assert.equal(result.ok, true)
  assert.doesNotMatch(result.message, /mock-provider-private-output/)
})

test('回退运行时不重复发送用户和 Skill 展示消息', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => completion())
  const messages: AgentUiMessage[] = []
  for await (const item of createModelApiRuntime(settings).run({ message: '你好', emitRequestContext: false })) {
    messages.push(item)
  }
  assert.deepEqual(messages.map((message) => message.kind), ['text'])
})

test('图片及二进制只保留名称说明，禁止发送内容和本机路径', async (context) => {
  context.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    const body = String(init.body)
    assert.doesNotMatch(body, /private-local-path|mock-image-binary|mock-other-binary/)
    assert.match(body, /inline document text/)
    return completion()
  })
  const messages: AgentUiMessage[] = []
  for await (const item of createModelApiRuntime(settings).run({
    message: '请分析附件',
    attachments: [
      { id: 'image', name: 'portrait.png', kind: 'image', mime: 'image/png', size: 12, path: '/private-local-path/image.png', text: 'mock-image-binary' },
      { id: 'binary', name: 'file.bin', kind: 'binary', mime: 'application/octet-stream', size: 12, path: '/private-local-path/file.bin', text: 'mock-other-binary' },
      { id: 'text', name: 'notes.txt', kind: 'text', mime: 'text/plain', size: 20, path: '/private-local-path/notes.txt', text: 'inline document text' },
    ],
  })) messages.push(item)
  assert.ok(messages.some((item) => item.kind === 'text' && /内容未发送/.test(item.text)))
})

test('HTTP 错误、网络错误和非法 JSON 不泄露服务响应或凭据', async (context) => {
  const privateDetail = `upstream says ${settings.apiKey} at ${settings.baseUrl}`
  const fetchMock = context.mock.method(globalThis, 'fetch', async () => new Response(privateDetail, { status: 401 }))
  const rejected = await testModelApiConnection(settings)
  assert.equal(rejected.ok, false)
  assert.doesNotMatch(rejected.message, /mock-private-key|models\.example|upstream/)

  fetchMock.mock.mockImplementation(async () => { throw new Error(privateDetail) })
  const failed = await testModelApiConnection(settings)
  assert.equal(failed.ok, false)
  assert.doesNotMatch(failed.message, /mock-private-key|models\.example|upstream/)
  await assert.rejects(collect(), /AI 模型服务连接失败/)

  fetchMock.mock.mockImplementation(async () => new Response(privateDetail))
  const invalid = await testModelApiConnection(settings)
  assert.equal(invalid.ok, false)
  assert.doesNotMatch(invalid.message, /mock-private-key|models\.example|upstream/)
})

test('空文本或不含回复的结果判为失败', async (context) => {
  const fetchMock = context.mock.method(globalThis, 'fetch', async () => completion('   '))
  assert.equal((await testModelApiConnection(settings)).ok, false)
  await assert.rejects(collect(), /未返回可用文本/)
  fetchMock.mock.mockImplementation(async () => new Response(JSON.stringify({ choices: [] })))
  assert.equal((await testModelApiConnection(settings)).ok, false)
})

test('未启用或配置非法时不会发出请求', async (context) => {
  const fetchMock = context.mock.method(globalThis, 'fetch', async () => completion())
  await assert.rejects(collect(createModelApiRuntime({ ...settings, enabled: false })), /先启用并保存/)
  const result = await testModelApiConnection({ ...settings, baseUrl: 'https://private-user:private-value@models.example.test/v1' })
  assert.equal(result.ok, false)
  assert.doesNotMatch(result.message, /private-user|private-value/)
  assert.equal((await testModelApiConnection({ ...settings, baseUrl: 'http://remote.example.test/v1' })).ok, false)
  assert.equal(fetchMock.mock.callCount(), 0)
})

test('调用方取消时中止 fetch 并返回固定信息，预取消不发送请求', async (context) => {
  let requestSignal: AbortSignal | undefined
  const fetchMock = context.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    requestSignal = init.signal ?? undefined
    return new Promise<Response>((_resolve, reject) => {
      requestSignal?.addEventListener('abort', () => reject(new Error(settings.apiKey)), { once: true })
    })
  })
  const controller = new AbortController()
  const pending = testModelApiConnection(settings, controller.signal)
  controller.abort()
  assert.deepEqual(await pending, { ok: false, message: 'AI 模型请求已取消。' })
  assert.equal(requestSignal?.aborted, true)
  const before = fetchMock.mock.callCount()
  assert.equal((await testModelApiConnection(settings, controller.signal)).ok, false)
  const chat = createModelApiRuntime(settings).run({ message: '你好', emitRequestContext: false, signal: controller.signal })
  await assert.rejects(chat.next(), /AI 模型请求已取消/)
  assert.equal(fetchMock.mock.callCount(), before)
})

test('连接测试 15 秒超时、聊天 60 秒超时会中止请求', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const signals: AbortSignal[] = []
  context.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    const signal = init.signal as AbortSignal
    signals.push(signal)
    return new Promise<Response>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error(settings.apiKey)), { once: true })
    })
  })
  const testPending = testModelApiConnection(settings)
  context.mock.timers.tick(14_999)
  assert.equal(signals[0].aborted, false)
  context.mock.timers.tick(1)
  assert.deepEqual(await testPending, { ok: false, message: 'AI 模型服务请求超时，请稍后重试。' })

  const iterator = createModelApiRuntime(settings).run({ message: '你好', emitRequestContext: false })
  const chatPending = iterator.next()
  context.mock.timers.tick(59_999)
  assert.equal(signals[1].aborted, false)
  context.mock.timers.tick(1)
  await assert.rejects(chatPending, /请求超时/)
  assert.equal(signals[1].aborted, true)
})
