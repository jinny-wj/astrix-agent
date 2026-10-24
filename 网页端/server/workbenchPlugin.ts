import fs from 'node:fs/promises'
import path from 'node:path'
import type { IncomingMessage, ServerResponse, Server } from 'node:http'
import type { Socket } from 'node:net'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import type { Plugin, ResolvedConfig } from 'vite'
// Keep the shared CommonJS layout outside Vite's bundled ESM configuration.
const require = createRequire(import.meta.url)
const { getLayout } = require(fileURLToPath(new URL('../../packages/astrix-workbench/layout.cjs', import.meta.url))) as typeof import('../../packages/astrix-workbench/layout.cjs')

type Application = {
  handle: (request: IncomingMessage, response: ServerResponse) => Promise<void>
  handleUpgrade: (request: IncomingMessage, socket: Socket) => boolean
  close: () => Promise<void>
}

const legacyDocuments = ['/design.html', '/design', '/editor', '/creating', '/workspace', '/agent']
const legacyApis = ['/api/agent', '/api/figma', '/api/auth', '/api/desktop', '/api/web-capture', '/api/local']

export function isLegacyDocument(pathname: string) {
  return legacyDocuments.some(prefix => pathname === prefix || pathname.startsWith(prefix + '/'))
}

export function isWorkbenchRequest(pathname: string) {
  if (isLegacyDocument(pathname)) return false
  if (['/src/', '/@', '/node_modules/', '/assets/'].some(prefix => pathname.startsWith(prefix))) return false
  // API names are owned by the existing React application and browser extension.
  // In particular, /api/figma-bridge must never reach the Figma REST proxy.
  if (legacyApis.some(prefix => pathname === prefix || pathname.startsWith(prefix + '/') || prefix === '/api/figma' && pathname.startsWith(prefix + '-'))) return false
  return true
}

async function collectPublicFiles(root: string, directory = root): Promise<Array<{ name: string; bytes: Buffer }>> {
  const files: Array<{ name: string; bytes: Buffer }> = []
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.name === '.DS_Store') continue
    if (entry.name.startsWith('.') || entry.isSymbolicLink()) throw Error('拒绝非静态工作台资源：' + entry.name)
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await collectPublicFiles(root, file))
    else if (entry.isFile()) files.push({ name: path.relative(root, file).split(path.sep).join('/'), bytes: await fs.readFile(file) })
  }
  return files
}

async function assertPrepared(publicRoot: string) {
  for (const file of ['index.html', 'local-runtime.js', 'figma-workspace.html', 'codegen.html', 'branding/astrix-dock.png']) {
    try { await fs.access(path.join(publicRoot, file)) }
    catch { throw Error('缺少 Astrix 工作台资源：' + file + '。请先还原对应运行资源，或运行 pnpm prepare:workbench。') }
  }
}

export function workbenchPlugin(): Plugin {
  const layout = getLayout()
  let config: ResolvedConfig
  let application: Application | undefined
  let closing: Promise<void> | undefined
  const dispose = () => closing ??= application?.close() ?? Promise.resolve()

  async function install(httpServer: Server | null, middleware: { use: (handler: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void }, port: number, publicRoot: string) {
    await assertPrepared(publicRoot)
    const module = await import(pathToFileURL(path.join(layout.webRoot, 'server/application.mjs')).href)
    application = module.createWorkbenchApplication({
      port, surface: 'web', publicRoot,
      instanceId: process.env.ASTRIX_INSTANCE_ID || randomUUID(),
    }) as Application
    const active = application
    middleware.use((request, response, next) => {
      const url = new URL(request.url || '/', 'http://127.0.0.1')
      if (isLegacyDocument(url.pathname)) {
        if (request.method === 'GET' || request.method === 'HEAD') request.url = '/design.html' + url.search
        next()
        return
      }
      if (!isWorkbenchRequest(url.pathname)) { next(); return }
      void active.handle(request, response).catch(error => {
        if (!response.headersSent) { response.statusCode = 500; response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ error: String(error.message || error) })) }
        else response.end()
      })
    })
    if (httpServer) {
      httpServer.on('upgrade', (request, socket) => { active.handleUpgrade(request, socket as Socket) })
      // End active SSE/model requests before HTTP close waits for connections.
      const close = httpServer.close.bind(httpServer)
      httpServer.close = ((callback?: (error?: Error) => void) => {
        void dispose().then(() => close(callback), () => close(callback))
        return httpServer
      }) as typeof httpServer.close
      httpServer.once('close', () => { void dispose() })
    }
  }

  return {
    name: 'astrix-integrated-workbench',
    enforce: 'post',
    configResolved(value) { config = value },
    async configureServer(server) {
      await install(server.httpServer as Server | null, server.middlewares, server.config.server.port || 5273, layout.publicRoot)
    },
    async configurePreviewServer(server) {
      const publicRoot = path.resolve(config.root, config.build.outDir)
      const manifest = JSON.parse(await fs.readFile(path.join(publicRoot, 'workbench-build.json'), 'utf8'))
      if (manifest.version !== layout.version || manifest.app !== 'astrix-workbench') throw Error('工作台构建版本不匹配，请重新运行 pnpm build。')
      await install(server.httpServer as Server, server.middlewares, server.config.preview.port || 5273, publicRoot)
    },
    async generateBundle() {
      await assertPrepared(layout.publicRoot)
      for (const file of await collectPublicFiles(layout.publicRoot)) {
        if (file.name === 'design.html') throw Error('工作台资源不应覆盖保留的设计界面。')
        this.emitFile({ type: 'asset', fileName: file.name, source: file.bytes })
      }
      this.emitFile({ type: 'asset', fileName: 'workbench-build.json', source: JSON.stringify({ app: 'astrix-workbench', version: layout.version, workbench: '/home', design: '/design.html' }, null, 2) })
    },
  }
}
