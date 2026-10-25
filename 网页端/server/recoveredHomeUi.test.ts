import assert from 'node:assert/strict'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { tmpdir } from 'node:os'
import vm from 'node:vm'
import test from 'node:test'

test('恢复首页仅替换旧后台画布授权告警，不把其他错误当作已授权，并移除无效企业手册', async context => {
  const home = new URL('../workbench/public/vendor/s2-12205.kwimgs.com/kos/proj-gis/Z2lz/kos/nlav12205/workbench/assets/home-Dq22ywRR.js', import.meta.url)
  let source: string
  try { source = await readFile(home, 'utf8') } catch (error: any) { if (error.code === 'ENOENT') { context.skip('需要已准备的恢复UI资源'); return } throw error }
  const start = source.indexOf('!unref(T)&&unref(te)?')
  const suffix = ':createCommentVNode("",!0)'
  const end = source.indexOf(suffix, start) + suffix.length
  assert.ok(start >= 0 && end > start)
  const expression = source.slice(start, end)
  const node = (tag: string, props: any, children?: any) => ({ tag, props, children })
  const render = (message: string, local = true) => vm.runInNewContext(expression, {
    window: { __M0_LOCAL_RUNTIME__: local }, T: { value: false }, te: { value: message }, s: [],
    unref: (value: any) => value.value, openBlock() {}, withCtx: (fn: any) => fn,
    createElementBlock: node, createBaseVNode: node, createBlock: node, createVNode: node,
    createTextVNode: (value: string) => value, createCommentVNode() {}, be: 'warning', ce: 'button', V: { value() {} },
  })
  const unsupported = 'Figma 后台画布需要在桌面端使用'
  const entry = render(unsupported)
  assert.equal(entry.tag, 'section')
  assert.equal(entry.children[0].children, '选择项目后连接真实 Figma')
  assert.ok(entry.children.some((child: any) => child.props?.['data-m0-create-figma-project'] === ''))
  assert.ok(entry.children.some((child: any) => child.props?.href === '/__local/projects'))
  assert.ok(entry.children.some((child: any) => child.props?.href === '/figma-workspace.html'))
  assert.equal(JSON.stringify(entry).includes('重新获取'), false)
  assert.equal(render('实际网络错误').props.subtitle, '实际网络错误')
  assert.equal(render(unsupported, false).tag, 'warning')
  assert.equal(source.includes('class:"workspace-manual-link",href:"https://docs.'), false)
  assert.ok(source.includes('throw new Error("请先完成 SSO 登录")'), '原授权失败保持真实')
})

test('恢复首页创建入口调用已有本地项目API后进入真实项目，不发起原后台授权', async context => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'astrix-home-project-'))
  const { createWorkbenchApplication } = await import(new URL('../workbench/server/application.mjs', import.meta.url).href)
  let application: ReturnType<typeof createWorkbenchApplication>
  const server = createServer((req, res) => { void application.handle(req, res) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port, base = `http://127.0.0.1:${port}`
  application = createWorkbenchApplication({ port, surface: 'web', dataDir: path.join(temporary, 'data'), workspaceRoot: path.join(temporary, 'workspace') })
  context.after(async () => { await application.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(temporary, { recursive: true, force: true }) })
  const handlers: Array<(event: any) => Promise<void> | void> = [], calls: string[] = [], alerts: string[] = [], storage = new Map()
  let redirect = ''
  class Element {
    disabled = false
    closest(selector: string) { return selector === '[data-m0-create-figma-project]' ? this : null }
  }
  const document = { addEventListener: (type: string, handler: any) => { if (type === 'click') handlers.push(handler) }, querySelectorAll: () => [] }
  const sandbox: any = { document, Element, Request, Headers, URL, URLSearchParams, structuredClone, navigator: {}, localStorage: { getItem: (key: string) => storage.get(key), setItem: (key: string, value: string) => storage.set(key, value) }, location: { href: base + '/home', origin: base, host: `127.0.0.1:${port}`, protocol: 'http:', assign: (value: string) => { redirect = value } }, fetch: (url: string, options?: RequestInit) => { calls.push(new URL(url, base).pathname); return fetch(new URL(url, base), options) }, XMLHttpRequest: class {}, open() {}, alert: (value: string) => alerts.push(value), addEventListener() {} }
  sandbox.window = sandbox
  vm.runInNewContext(await readFile(new URL('../workbench/frontend-tools/local-runtime.js', import.meta.url), 'utf8'), sandbox)
  await sandbox.__m0LocalReady
  const button = new Element()
  for (const handler of handlers) await handler({ target: button, preventDefault() {}, stopImmediatePropagation() {} })
  assert.deepEqual(alerts, [])
  assert.ok(calls.includes('/devops-api/project/v2/create'))
  assert.ok(calls.every(name => name === '/__local/models' || name === '/devops-api/project/v2/create'))
  const project = application.api.state.projects[0]
  assert.equal(project.projectName, 'Figma 项目')
  assert.equal(new URL(redirect, base).searchParams.get('id'), String(project.id))
  assert.equal(new URL(redirect, base).searchParams.get('homeEntryMode'), 'design')
})
