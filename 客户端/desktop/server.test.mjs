import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { after, before, test } from 'node:test'
import { build } from 'esbuild'

const appRoot = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(import.meta.url)
const built = await build({
  entryPoints: [join(appRoot, 'desktop/server.ts')], bundle: true, write: false,
  platform: 'node', format: 'esm', logLevel: 'silent',
  plugins: [{ name: 'external-sdk', setup(builder) {
    builder.onResolve({ filter: /^(?:@anthropic-ai\/claude-agent-sdk|exceljs)$/ }, (args) => ({
      path: pathToFileURL(require.resolve(args.path)).href, external: true,
    }))
  } }],
})
const { startDesktopServer } = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'))
const root = mkdtempSync(join(tmpdir(), 'ds-server-test-'))
const dataDirectory = join(root, 'user-data')
const originalFetch = globalThis.fetch
const previousDataDir = process.env.DESIGN_STUDIO_DATA_DIR
let server

before(async () => {
  // ASAR is a regular OS file. No endpoint may use it for attachments or cwd.
  const archive = join(root, 'app.asar')
  writeFileSync(archive, '')
  server = await startDesktopServer({
    appRoot: archive, dataDirectory, agentResourcesDirectory: appRoot, port: 0,
  })
})
after(async () => {
  globalThis.fetch = originalFetch
  await server?.close()
  if (previousDataDir === undefined) delete process.env.DESIGN_STUDIO_DATA_DIR
  else process.env.DESIGN_STUDIO_DATA_DIR = previousDataDir
  rmSync(root, { recursive: true, force: true })
})

function post(path, body) {
  return originalFetch(server.origin + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
}

test('untrusted websites cannot trigger the local Agent or write attachments', async () => {
  const attachments = join(dataDirectory, 'agent-workspace', '.design-studio', 'attachments')
  const listing = () => { try { return readdirSync(attachments).sort() } catch { return [] } }
  const beforeFiles = listing()
  for (const origin of ['https://untrusted.example', 'null', 'http://127.0.0.1:5273.untrusted.example']) {
    for (const path of ['/api/agent/attachments', '/api/agent/chat']) {
      const response = await originalFetch(server.origin + path, {
        method: 'POST', headers: { Origin: origin, 'Content-Type': 'text/plain' },
        body: JSON.stringify({ message: 'test', files: [{ name: 'cross-site.txt', mime: 'text/plain', contentBase64: 'dGVzdA==' }] }),
      })
      assert.equal(response.status, 403)
      assert.equal(response.headers.get('Access-Control-Allow-Origin'), null)
    }
  }
  assert.deepEqual(listing(), beforeFiles)
  const simple = await originalFetch(server.origin + '/api/agent/attachments', {
    method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{"files":[]}',
  })
  assert.equal(simple.status, 415)
  const sameSite = await originalFetch(server.origin + '/api/agent/attachments', {
    method: 'POST', headers: { Origin: 'http://127.0.0.1:5273', 'Content-Type': 'application/json' }, body: '{"files":[]}',
  })
  assert.equal(sameSite.status, 200)
})

const empty = {
  sessionId: 'empty-canvas-test', fileKey: 'empty_file123', pageId: '0:1',
  pageName: 'Page 1', revision: 1, updatedAt: Date.now(), nodes: [],
}

async function queuedChat(message, selection) {
  assert.equal((await post('/api/figma-bridge/selection', selection)).status, 200)
  const response = await post('/api/agent/chat', { message, selection })
  assert.equal(response.status, 200)
  const stream = response.text()
  const pulled = await originalFetch(server.origin + '/api/figma-bridge/pull?sessionId=' + selection.sessionId)
  const { commands } = await pulled.json()
  assert.equal(commands.length, 1)
  assert.equal((await post('/api/figma-bridge/ack', {
    results: [{ id: commands[0].id, ok: true, changedNodeIds: ['1:1'] }],
  })).status, 200)
  const events = await stream
  assert.match(events, /"backend":"figma-bridge"/)
  assert.match(events, /"status":"success"/)
  return commands[0]
}

test('blank canvas chat reaches the Bridge and waits for its creation receipt', async () => {
  const command = await queuedChat('创建一个 375×812 的画板', empty)
  assert.equal(command.type, 'create-frame')
  assert.equal(command.fileKey, empty.fileKey)
  assert.equal(command.selectionRevision, empty.revision)
})

test('title chat patches the selected text instead of creating another node', async () => {
  const command = await queuedChat('把标题改成「夏日活动」', {
    ...empty, sessionId: 'title-edit-test', fileKey: 'title_file123',
    nodes: [{
      id: '1:1', name: '标题', type: 'TEXT', visible: true, locked: false,
      supports: { text: true, fill: true, opacity: true, resize: true, move: true, visibility: true, rename: true },
    }],
  })
  assert.equal(command.type, 'patch-nodes')
  assert.deepEqual(command.targets[0].patches, [{ kind: 'replace-text', value: '夏日活动' }])
})

test('a missing empty-canvas session cannot fall back to another open file', async () => {
  const response = await post('/api/agent/chat', {
    message: '新建一个画板', selection: { ...empty, fileKey: undefined, sessionId: 'disconnected-test' },
  })
  const events = await response.text()
  assert.match(events, /"status":"error"/)
  assert.doesNotMatch(events, /"status":"queued"/)
})

test('图片、资源位和 H5 聊天请求直达 Bridge 并等待执行回执', async () => {
  const selected = { id: '1:1', name: '设计稿', type: 'TEXT', visible: true, locked: false, width: 100, height: 100,
    supports: { text: true, fill: true, opacity: true, resize: true, move: true, visibility: true, rename: true } }
  for (const [index, message, kinds] of [
    [0, '图片填充；图片曝光设为 10%', ['set-image-mode', 'set-image-filter']],
    [1, '尺寸改为 直播广场banner', ['resize']],
    [2, '字号设为 24px；行高设为 36px', ['set-font-size', 'set-line-height']],
    [3, '内边距设为 16px', Array(4).fill('set-layout-spacing')],
  ]) {
    const command = await queuedChat(message, { ...empty, sessionId: `adjust-${index}`, fileKey: `adjust_file${index}`, nodes: [selected] })
    assert.equal(command.type, 'patch-nodes')
    assert.equal(command.executionMode, 'atomic')
    assert.deepEqual(command.targets[0].patches.map(p => p.kind), kinds)
  }
})

test('desktop web capture serves its endpoint and stores images in the Agent workspace', async () => {
  globalThis.fetch = async (input, init) => {
    const url = String(input)
    if (url === 'https://capture.example.test/' || url === 'https://capture.example.test/image.png') {
      const isImage = url.endsWith('.png')
      const response = new Response(isImage ? 'image-fixture' : '<title>Test page</title><meta property="og:image" content="/image.png">', {
        headers: { 'Content-Type': isImage ? 'image/png' : 'text/html' },
      })
      Object.defineProperty(response, 'url', { value: url })
      return response
    }
    return originalFetch(input, init)
  }
  try {
    const response = await post('/api/web-capture', { url: 'https://capture.example.test/' })
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.title, 'Test page')
    assert.match(body.prompt, /Test page/)
    assert.ok(body.image.path.startsWith(join(dataDirectory, 'agent-workspace', '.design-studio', 'attachments')))
    assert.equal(readFileSync(body.image.path, 'utf8'), 'image-fixture')
    const upload = await post('/api/agent/attachments', { files: [{ name: 'brief.txt', mime: 'text/plain', contentBase64: Buffer.from('brief').toString('base64') }] })
    assert.equal(upload.status, 200)
  } finally {
    globalThis.fetch = originalFetch
  }
})
