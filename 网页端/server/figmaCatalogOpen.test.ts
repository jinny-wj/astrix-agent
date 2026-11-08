import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { workbenchPlugin } from './workbenchPlugin.ts'
import { figmaOAuthPlugin, getFigmaOAuthMiddlewareForServer } from '../workbench/server/figma-oauth.mjs'

// Exercise the two real Vite plugins together. All account/file responses come
// from an isolated Figma HTTP fixture; no developer login or project is used.
for (const mode of ['dev', 'preview'] as const) test(`${mode} shares the existing OAuth session with catalog discovery and real-file opening`, async context => {
  const directory = await mkdtemp(path.join(tmpdir(), 'astrix-vite-figma-open-'))
  const handlers: Array<(request: any, response: any, next: () => void) => void> = []
  const server = createServer((request, response) => {
    let index = 0
    const next = () => { const handler = handlers[index++]; if (handler) handler(request, response, next); else { response.statusCode = 404; response.end() } }
    next()
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port, origin = `http://127.0.0.1:${port}`
  const originalFetch = globalThis.fetch
  let denied = false, reads = 0
  const upstream: string[] = []
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input))
    if (url.hostname !== 'api.figma.com') return originalFetch(input, init)
    upstream.push(url.pathname)
    if (url.pathname === '/v1/oauth/token') return Response.json({ access_token: 'isolated-access', refresh_token: 'isolated-refresh', expires_in: 3600 })
    if (url.pathname === '/v1/me') return Response.json({ id: 'isolated-account', handle: 'Fixture Account', email: '', img_url: '' })
    if (url.pathname === '/v1/files/WorkingFile_123/meta') {
      reads++
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer isolated-access')
      return denied ? Response.json({ err: 'private upstream diagnostic' }, { status: 403 }) : Response.json({ file: { name: 'Official fixture design', editorType: 'figma' } })
    }
    throw Error('Unexpected fixture upstream path')
  }
  context.after(async () => {
    globalThis.fetch = originalFetch
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    await rm(directory, { recursive: true, force: true })
  })
  const oauth = figmaOAuthPlugin({ clientId: 'isolated-client', clientSecret: 'isolated-secret', redirectUri: origin + '/api/auth/figma/callback',
    cookieNamespace: 'isolated_' + mode, allowedOrigin: origin, dataDirectory: path.join(directory, 'oauth') })
  const workbench = workbenchPlugin({ dataDir: path.join(directory, 'data'), workspaceRoot: path.join(directory, 'workspace') })
  const middlewares = { use: (handler: typeof handlers[number]) => handlers.push(handler) }
  const host = { httpServer: server, middlewares, config: { server: { port }, preview: { port } } }
  if (mode === 'preview') {
    const dist = path.join(directory, 'dist')
    await mkdir(path.join(dist, 'branding'), { recursive: true })
    for (const file of ['index.html', 'local-runtime.js', 'figma-workspace.html', 'codegen.html', 'branding/astrix-dock.png']) await writeFile(path.join(dist, file), '')
    const { default: layout } = await import('../../packages/astrix-workbench/layout.cjs')
    await writeFile(path.join(dist, 'workbench-build.json'), JSON.stringify({ app: 'astrix-workbench', version: layout.getLayout().version }))
    ;(workbench.configResolved as (value: any) => void)({ root: directory, build: { outDir: 'dist' } })
    await (oauth.configurePreviewServer as (value: any) => void)(host)
    await (workbench.configurePreviewServer as (value: any) => Promise<void>)(host)
  } else {
    await (oauth.configureServer as (value: any) => void)(host)
    await (workbench.configureServer as (value: any) => Promise<void>)(host)
  }
  assert.ok(getFigmaOAuthMiddlewareForServer(server), 'the workbench uses the already registered OAuth middleware')
  const request = (route: string, method = 'GET', body?: unknown, cookie = '') => fetch(origin + route, { method, redirect: 'manual', headers: { origin, cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const before = await request('/__local/figma/catalog/open', 'POST', { url: 'https://www.figma.com/design/WorkingFile_123' })
  assert.equal(before.status, 401)
  const created = await request('/api/project/v2/create', 'POST', { projectName: 'Local project title must not become a Figma card' })
  const project = await created.json()
  assert.equal((await request('/__local/figma/workspace?projectId=' + project.id, 'PUT', { url: 'https://www.figma.com/design/WorkingFile_123' })).status, 200)
  const start = await request('/api/auth/figma/start?direct=1')
  const authorize = new URL(start.headers.get('location')!)
  const flowCookie = start.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  const granted = await request('/api/auth/figma/callback?code=isolated-code&state=' + authorize.searchParams.get('state'), 'GET', undefined, flowCookie)
  const session = granted.headers.getSetCookie().find(value => value.startsWith('design_studio_figma_session_'))?.split(';')[0]
  assert.ok(session)
  const catalogResponse = await request('/api/auth/figma/catalog', 'GET', undefined, session)
  assert.equal(catalogResponse.status, 200)
  const catalog = await catalogResponse.json()
  assert.equal(catalog.files[0].name, 'Official fixture design')
  assert.ok(!JSON.stringify(catalog).includes('Local project title'))
  denied = true
  const rejected = await request('/__local/figma/catalog/open', 'POST', { url: catalog.files[0].url }, session)
  assert.equal(rejected.status, 403, 'opening rechecks access instead of trusting the catalog response')
  assert.ok(!(await rejected.text()).includes('private upstream diagnostic'))
  assert.equal((await (await request('/api/project/v2/list')).json()).length, 1)
  denied = false
  const opened = await request('/__local/figma/catalog/open', 'POST', { url: catalog.files[0].url }, session)
  assert.equal(opened.status, 200)
  const result = await opened.json()
  assert.match(result.route, /^\/aicode-v2\?/)
  assert.notEqual(result.projectId, project.id, 'an unscoped legacy project cannot contribute another account files or conversations')
  const bound = await (await request('/__local/figma/workspace?projectId=' + result.projectId)).json()
  assert.equal(bound.fileKey, 'WorkingFile_123')
  const again = await (await request('/__local/figma/catalog/open', 'POST', { url: catalog.files[0].url }, session)).json()
  assert.equal(again.projectId, result.projectId)
  assert.equal((await (await request('/api/project/v2/list')).json()).length, 2)
  assert.equal(reads, 4)
  assert.ok(upstream.every(value => ['/v1/oauth/token', '/v1/me', '/v1/files/WorkingFile_123/meta'].includes(value)), 'no model or Figma document write/content endpoint is called')
  assert.ok(!JSON.stringify([catalog, result, bound]).includes('isolated-access'))
})
