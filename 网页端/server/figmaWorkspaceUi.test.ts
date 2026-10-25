import assert from 'node:assert/strict'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { tmpdir } from 'node:os'
import vm from 'node:vm'
import test from 'node:test'

// Run the complete authored page against an isolated real HTTP application.
// The DOM adapter observes state and clicks; it does not emulate live Figma.
async function fixture(context: { after: (fn: () => Promise<void>) => void }) {
  const temporary = await mkdtemp(path.join(tmpdir(), 'astrix-figma-page-'))
  const { createWorkbenchApplication } = await import(new URL('../workbench/server/application.mjs', import.meta.url).href)
  let application: ReturnType<typeof createWorkbenchApplication>
  const server = createServer((req, res) => { void application.handle(req, res) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  application = createWorkbenchApplication({ port, surface: 'web', dataDir: path.join(temporary, 'data'), workspaceRoot: path.join(temporary, 'workspace') })
  context.after(async () => { await application.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(temporary, { recursive: true, force: true }) })
  const base = `http://127.0.0.1:${port}`
  const html = await readFile(new URL('../workbench/frontend-tools/figma-workspace.html', import.meta.url), 'utf8')
  const script = await readFile(new URL('../workbench/frontend-tools/figma-workspace.js', import.meta.url), 'utf8')
  const calls: string[] = []
  async function load(query = '', unavailable = false, native = false) {
    const elements = new Map<string, any>()
    for (const match of html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)) {
      const tag = match[0]
      elements.set(match[1], { textContent: '', value: '', disabled: /\bdisabled\b/.test(tag), hidden: /\bhidden\b/.test(tag), dataset: {}, classList: { toggle() {} }, addEventListener() {}, replaceChildren() {}, showModal() { this.open = true }, close() { this.open = false }, getBoundingClientRect() { return { x: 0, y: 0, width: 900, height: 600 } } })
    }
    const listeners = new Map<string, Array<(event?: any) => void>>()
    const document = { hidden: false, activeElement: null, getElementById: (id: string) => elements.get(id), querySelector: () => null, querySelectorAll: (selector: string) => selector === 'dialog' ? [elements.get('pair-dialog'), elements.get('edit-dialog')] : [] }
    const sandbox: any = { document, URL, URLSearchParams, structuredClone, crypto, console, location: new URL(base + '/figma-workspace.html' + query), history: { replaceState() {} }, fetch: async (url: string, options?: RequestInit) => { calls.push(url); if (unavailable) return new Response(JSON.stringify({ error: '测试服务不可用' }), { status: 503 }); return fetch(base + url, options) }, addEventListener: (name: string, fn: (event?: any) => void) => { const list = listeners.get(name) || []; list.push(fn); listeners.set(name, list) }, dispatchEvent() {}, CustomEvent: class {}, ResizeObserver: class { observe() {} }, Option: class { text: string; value: string; constructor(text: string, value: string) { this.text = text; this.value = value } }, setInterval() {}, setTimeout() {}, clearTimeout() {}, open() { throw Error('This test must not open Figma') } }
    const nativeCalls: string[] = []
    if (native) sandbox.m0LocalDesktop = { figmaHost: { available: async () => true, show: async () => { nativeCalls.push('show'); return {} }, hide: async () => { nativeCalls.push('hide') }, updateBounds: async () => ({}), onStatus() {} } }
    sandbox.window = sandbox; sandbox.parent = sandbox
    vm.runInNewContext(script, sandbox, { filename: 'figma-workspace.js' })
    for (let count = 0; count < 100; count++) { if (sandbox.m0FigmaWorkspace.getStatus().phase !== 'loading') return { sandbox, elements, listeners, nativeCalls }; await new Promise(resolve => setTimeout(resolve, 5)) }
    throw Error('Figma page did not finish initialization')
  }
  return { application, base, load, calls }
}

test('没有项目时显示选择入口并结束载入，不误报服务失败或启动原生宿主', async context => {
  const f = await fixture(context)
  const page = await f.load('', false, true)
  assert.equal(page.sandbox.m0FigmaWorkspace.getStatus().phase, 'project-required')
  assert.equal(page.elements.get('choose-project').hidden, false)
  assert.equal(page.elements.get('host-status').textContent, '请先选择项目')
  assert.equal(page.elements.get('ai-status').textContent, '选择项目后读取 AI 权限')
  assert.equal(page.elements.get('connect-bridge').disabled, true)
  assert.equal(page.elements.get('open-file').disabled, true)
  assert.equal(f.calls.some(url => url.includes('/metadata') || url.includes('/__local/model')), false)
  for (const callback of page.listeners.get('message') || []) callback({ origin: f.base, source: page.sandbox, data: { source: 'm0-local-figma-parent', type: 'capabilities', payload: { nativeAvailable: true } } })
  for (const callback of page.listeners.get('visibilitychange') || []) callback()
  assert.equal(page.elements.get('host-status').textContent, '请先选择项目')
  assert.deepEqual(page.nativeCalls, [])
})

test('已有项目加载真实本地 metadata 与权限，并可通过页面生成 Bridge 配对码', async context => {
  const f = await fixture(context)
  const project = f.application.api.createProject({ projectName: '临时页面测试' })
  const binding = await fetch(f.base + '/__local/figma/workspace?projectId=' + project.id, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: 'https://www.figma.com/design/PageFixture_123' }) })
  assert.equal(binding.status, 200)
  const page = await f.load('?projectId=' + project.id)
  assert.equal(page.sandbox.m0FigmaWorkspace.getStatus().phase, 'ready')
  assert.equal(page.elements.get('connect-bridge').disabled, false)
  assert.equal(page.elements.get('bridge-base').value, f.base)
  assert.equal(page.elements.get('ai-status').textContent, 'AI 写入关闭 · 手动操作可用')
  await page.elements.get('create-pair').onclick()
  assert.match(page.elements.get('pair-code').textContent, /^[A-Z0-9-]{6,}$/)
})

test('真正的初始化错误保留错误状态并结束权限载入', async context => {
  const f = await fixture(context)
  const page = await f.load('', true)
  assert.equal(page.sandbox.m0FigmaWorkspace.getStatus().phase, 'error')
  assert.equal(page.elements.get('host-status').textContent, '工作区初始化失败')
  assert.equal(page.elements.get('ai-status').textContent, 'AI 权限状态不可用')
  assert.equal(page.elements.get('connect-bridge').disabled, true)
})
