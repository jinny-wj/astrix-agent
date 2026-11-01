import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { conversationStorageKey, hasRequiredAnswers, readConversationId, saveConversationId, upsertAgentMessage } from './agentConversation.ts'
import { cancelAgentConversation, getAgentConversation, streamAgentChat } from './agentApi.ts'

const conversationId = '10ce7620-54ec-42af-a301-13da780965ba'
const requestId = '66be4656-162a-4440-843e-f0da8444d74c'

test('刷新只用存储的会话ID恢复，任务正文和附件不存浏览器，项目互相隔离', t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const values = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  } })
  t.after(() => previous ? Object.defineProperty(globalThis, 'localStorage', previous) : Reflect.deleteProperty(globalThis, 'localStorage'))
  const first = conversationStorageKey('http://127.0.0.1:5273/design.html?projectId=1')
  const second = conversationStorageKey('http://127.0.0.1:5273/design.html?projectId=2')
  saveConversationId(first, conversationId)
  assert.equal(readConversationId(first), conversationId)
  assert.equal(readConversationId(second), undefined)
  assert.deepEqual([...values.values()], [conversationId])
  saveConversationId(first, '../unsafe')
  assert.equal(readConversationId(first), undefined)
  saveConversationId(first, conversationId)
  saveConversationId(first)
  assert.equal(values.size, 0)
})

test('消息增量替换保留前几轮用户与助手消息，不清空历史', () => {
  const first = { id: 'u1', kind: 'user' as const, text: '将标题改色' }
  const question = { id: 'a1', kind: 'text' as const, text: '改成什么颜色？' }
  const answer = { id: 'u2', kind: 'user' as const, text: '红色' }
  const messages = upsertAgentMessage(upsertAgentMessage([first, question], answer), { ...question, text: '请补充颜色值' })
  assert.deepEqual(messages.map(item => item.id), ['u1', 'a1', 'u2'])
  assert.equal(messages[1].kind === 'text' && messages[1].text, '请补充颜色值')
})

test('澄清卡必须回答全部必填项，空白内容不能提交，可选问题不拦截', () => {
  const questions = [{ id: 'color', label: '颜色', required: true }, { id: 'note', label: '备注', required: false }]
  assert.equal(hasRequiredAnswers(questions, {}), false)
  assert.equal(hasRequiredAnswers(questions, { color: '   ' }), false)
  assert.equal(hasRequiredAnswers(questions, { color: '#ff0000' }), true)
})

test('分片SSE保留等待状态，结构化回答带同一会话与问题ID续接，不发送伪造历史', async t => {
  const previousFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = previousFetch })
  let request: Record<string, unknown> = {}
  const frames = [
    'event: conversation\ndata: ' + JSON.stringify({ conversationId, taskId: 'task-1', status: 'awaiting_user', messages: [
      { id: 'u1', kind: 'user', text: '将标题改色' },
      { id: 'q1', kind: 'clarification', taskId: 'task-1', status: 'awaiting_user', questions: [{ id: 'color', label: '改成什么颜色？', required: true }] },
    ], pending: { id: 'q1', taskId: 'task-1', questions: [{ id: 'color', label: '改成什么颜色？', required: true }] } }) + '\n\n',
    'event: done\ndata: {"status":"awaiting_user"}\n\n',
  ].join('')
  globalThis.fetch = async (_url, init) => {
    request = JSON.parse(String(init?.body)) as Record<string, unknown>
    const bytes = new TextEncoder().encode(frames)
    return new Response(new ReadableStream({ start(controller) {
      for (let start = 0; start < bytes.length; start += 17) controller.enqueue(bytes.slice(start, start + 17))
      controller.close()
    } }), { headers: { 'Content-Type': 'text/event-stream' } })
  }
  let state = ''
  await streamAgentChat({ conversationId, requestId, message: '红色', clarificationAnswer: { id: 'q1', answers: { color: '#ff0000' } } }, {
    onMessage: () => {}, onConversation: value => { state = value.status; assert.equal(value.messages.length, 2) },
  })
  assert.equal(state, 'awaiting_user')
  assert.equal(request.conversationId, conversationId)
  assert.equal(request.requestId, requestId)
  assert.deepEqual(request.clarificationAnswer, { id: 'q1', answers: { color: '#ff0000' } })
  assert.equal('history' in request, false)
})

test('刷新读取服务端完整会话，取消保留同一会话记录', async t => {
  const previousFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = previousFetch })
  const calls: { url: string; method?: string }[] = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init?.method })
    return Response.json({ conversationId, taskId: 't1', status: init?.method === 'POST' ? 'cancelled' : 'awaiting_user', messages: [{ id: 'u1', kind: 'user', text: '原始需求' }] })
  }
  assert.equal((await getAgentConversation(conversationId)).messages.length, 1)
  assert.equal((await cancelAgentConversation(conversationId)).status, 'cancelled')
  assert.deepEqual(calls, [
    { url: '/api/agent/conversations/' + conversationId, method: undefined },
    { url: '/api/agent/conversations/' + conversationId + '/cancel', method: 'POST' },
  ])
})

test('服务端出错及中途断流都保留失败，不能误判完成', async t => {
  const previousFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = previousFetch })
  globalThis.fetch = async () => new Response('event: error\ndata: {"message":"缺少模型配置"}\n\nevent: done\ndata: {}\n\n')
  await assert.rejects(streamAgentChat({ requestId, message: '继续' }, { onMessage: () => {} }), /缺少模型配置/)
  globalThis.fetch = async () => new Response('event: conversation\ndata: ' + JSON.stringify({ conversationId, messages: [], status: 'running' }) + '\n\n')
  await assert.rejects(streamAgentChat({ requestId, message: '继续' }, { onMessage: () => {} }), /连接提前结束/)
})

test('已恢复原任务后，输入框的简短补答仍作为本轮消息发送，澄清卡提交同一问题答案', async t => {
  const require = createRequire(import.meta.url)
  const { build } = createRequire(require.resolve('vite'))('esbuild') as { build: (options: unknown) => Promise<{ outputFiles: Array<{ text: string }> }> }
  type BundlerHooks = {
    onResolve: (options: { filter: RegExp }, handler: (args: { path: string }) => { path: string; namespace: string }) => void
    onLoad: (options: { filter: RegExp; namespace?: string }, handler: (args: { path: string }) => { contents: string; loader: 'js' }) => void
  }
  const React = require('react') as typeof import('react')
  const { renderToStaticMarkup } = require('react-dom/server') as typeof import('react-dom/server')
  const globals = globalThis as unknown as Record<string, unknown>
  const saved = new Map(['window', 'localStorage', '__astrixConversationUiTest'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  t.after(() => {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  })
  let sent: unknown[] = []
  const fixture = {
    React, flow: undefined as undefined | { prompt: string; conversationId: string; onAnswer: (answer: { id: string; answers: Record<string, string> }) => void },
    conversation: { conversationId, taskId: 't1', status: 'awaiting_user', originalRequest: '把这张战报改为秋季', messages: [], pending: { id: 'q1', questions: [{ id: 'activity_date', label: '日期如何处理', required: true }] } },
    editor: { agentRunning: true, agentPrompt: '日期不变', workspaceFileName: '测试设计稿', startAgent: (...args: unknown[]) => { sent = args } },
  }
  globals.__astrixConversationUiTest = fixture
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { href: 'http://127.0.0.1:5273/design.html?projectId=1' } } })
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => conversationId } })
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../components/editor/AiPanel.tsx', import.meta.url))],
    bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic', external: ['react/jsx-runtime'],
    plugins: [{ name: 'conversation-ui-fixtures', setup(plugin: BundlerHooks) {
      plugin.onResolve({ filter: /^(react)$|state\/editorStore$|hooks\/useDesktopAgentWorkspace$|hooks\/useFigmaLayerTarget$|^\.\/AiInputArea$|^\.\/AiWelcome$|^\.\/agent\/ConversationFlow$/ }, args => ({ path: args.path, namespace: 'ui-fixture' }))
      plugin.onLoad({ filter: /.*/, namespace: 'ui-fixture' }, args => {
        const body = args.path === 'react'
          ? 'export const useState = value => globalThis.__astrixConversationUiTest.React.useState(value === null ? globalThis.__astrixConversationUiTest.conversation : value); export const useEffect = globalThis.__astrixConversationUiTest.React.useEffect;'
          : args.path.endsWith('editorStore') ? 'export const useEditor = () => globalThis.__astrixConversationUiTest.editor;'
          : args.path.endsWith('useDesktopAgentWorkspace') ? 'export const useDesktopAgentWorkspace = () => {};'
          : args.path.endsWith('useFigmaLayerTarget') ? 'export const useFigmaLayerTarget = () => ({snapshot:null,layers:[],bridgeConnected:false,dismiss(){}});'
          : args.path.endsWith('ConversationFlow') ? 'export default function Flow(props) {globalThis.__astrixConversationUiTest.flow=props; return null;}'
          : 'export default function Empty(){return null;}'
        return { contents: body, loader: 'js' }
      })
      plugin.onLoad({ filter: /\.css$/ }, () => ({ contents: '', loader: 'js' }))
    } }],
  })
  const bundled = { exports: {} as { default?: React.ComponentType } }
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, bundled, bundled.exports)
  renderToStaticMarkup(React.createElement(bundled.exports.default!))
  assert.equal(fixture.flow?.prompt, '日期不变')
  assert.equal(fixture.flow?.conversationId, conversationId)
  fixture.flow?.onAnswer({ id: 'q1', answers: { activity_date: '日期不变' } })
  assert.equal(sent[0], '日期如何处理：日期不变')
  assert.deepEqual((sent[3] as { clarificationAnswer: unknown }).clarificationAnswer, { id: 'q1', answers: { activity_date: '日期不变' } })
})
