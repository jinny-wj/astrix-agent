import assert from 'node:assert/strict'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const built = await build({
  entryPoints: [fileURLToPath(new URL('./modelApiIpc.ts', import.meta.url))],
  bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent',
  plugins: [{ name: 'external-excel', setup(builder) {
    builder.onResolve({ filter: /^exceljs$/ }, args => ({ path: pathToFileURL(require.resolve(args.path)).href, external: true }))
  } }],
})
const { registerModelApiIpc } = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'))

async function harness(t, serverAvailable = true) {
  const directory = await mkdtemp(join(tmpdir(), 'astrix-api-ipc-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const key = randomBytes(32)
  const secureStorage = {
    isAsyncEncryptionAvailable: async () => true,
    async encryptStringAsync(value) {
      const nonce = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', key, nonce)
      const content = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
      return Buffer.concat([nonce, cipher.getAuthTag(), content])
    },
    async decryptStringAsync(value) {
      const decipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12))
      decipher.setAuthTag(value.subarray(12, 28))
      return { result: Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString('utf8'), shouldReEncrypt: false }
    },
  }
  const handlers = new Map()
  const trusted = {}
  const configured = []
  registerModelApiIpc({ handle: (channel, handler) => handlers.set(channel, handler) }, {
    dataDirectory: directory, secureStorage, isTrusted: event => event === trusted,
    getServer: () => serverAvailable ? { configureModelApi: value => configured.push(value) } : null,
  })
  return { directory, configured, call: (action, payload, event = trusted) => handlers.get('desktop-model-api:' + action)(event, payload) }
}

const draft = { baseUrl: 'https://model-api.example.test/v1', model: 'vendor/model.v2', apiKey: 'fixture-private-value', enabled: false }

test('仅受信任桌面调用能读写或测试模型配置', async t => {
  const h = await harness(t)
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => { throw new Error('unexpected network') })
  for (const action of ['get', 'save', 'test', 'clear']) {
    assert.throws(() => h.call(action, draft, {}), /无法访问/)
  }
  assert.equal(fetchMock.mock.callCount(), 0)
  assert.deepEqual(h.configured, [])
  assert.deepEqual(await readdir(h.directory), [])
})

test('草稿保存及启用不请求模型，读取永不回传已保存的 Key，清除立即更新服务', async t => {
  const h = await harness(t)
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => { throw new Error('unexpected network') })
  const empty = await h.call('save', { baseUrl: '', model: '', enabled: false })
  assert.equal(empty.configured, false)
  const saved = await h.call('save', draft)
  assert.equal(saved.hasApiKey, true)
  assert.equal(saved.enabled, false)
  assert.equal(saved.apiKey, undefined)
  assert.doesNotMatch(JSON.stringify(await h.call('get')), /fixture-private-value/)
  const enabled = await h.call('save', { ...draft, apiKey: '', enabled: true })
  assert.equal(enabled.enabled, true)
  assert.equal(h.configured.at(-1).apiKey, draft.apiKey)
  assert.equal(fetchMock.mock.callCount(), 0)
  await h.call('clear')
  assert.equal(h.configured.at(-1), null)
  assert.equal((await h.call('get')).hasApiKey, false)
})

test('显式测试使用当前草稿与已存 Key，不保存、不启用，失败不会泄露响应', async t => {
  const h = await harness(t)
  await h.call('save', draft)
  const fetchMock = t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url, 'https://other.example.test/v1/chat/completions')
    assert.equal(init.headers.Authorization, 'Bearer ' + draft.apiKey)
    assert.equal(JSON.parse(init.body).model, 'other/model.3')
    return new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }))
  })
  assert.equal((await h.call('test', { ...draft, apiKey: '', model: 'other/model.3', baseUrl: 'https://other.example.test/v1' })).ok, true)
  assert.equal(h.configured.length, 1)
  assert.equal((await h.call('get')).model, draft.model)
  assert.equal((await h.call('get')).enabled, false)
  fetchMock.mock.mockImplementation(async () => new Response(draft.apiKey, { status: 401 }))
  const failure = await h.call('test', { ...draft, apiKey: '' })
  assert.equal(failure.ok, false)
  assert.doesNotMatch(JSON.stringify(failure), /fixture-private-value/)
})

test('未拥有本机服务时阻止保存、清除和测试', async t => {
  const h = await harness(t, false)
  for (const action of ['save', 'test', 'clear']) {
    await assert.rejects(h.call(action, draft), /关闭其他 Astrix 实例/)
  }
  assert.deepEqual(await readdir(h.directory), [])
})
