import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

const bundled = await build({ entryPoints: [fileURLToPath(new URL('./figmaRecents.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false })
const { requestRecentFigmaFiles } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`)

test('desktop empty history is available without waiting for a browser extension; browser keeps its fallback', async (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const store = new Map<string, string>()
  let requests = 0
  const stub = Object.assign(new EventTarget(), {
    designStudioHost: {} as object | undefined,
    location: { origin: 'http://localhost' },
    localStorage: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value) },
    postMessage: () => { requests++ },
    setTimeout, clearTimeout,
  })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: stub })
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'window', previous); else Reflect.deleteProperty(globalThis, 'window') })
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => Response.json({ files: [] }))
  assert.deepEqual(await requestRecentFigmaFiles(250), { status: 'available', files: [], source: 'local' })
  assert.equal(requests, 0)
  const file = { key: 'sample123', url: 'https://www.figma.com/design/sample123', title: 'Sample', lastOpenedAt: '2026-09-12T00:00:00.000Z' }
  fetchMock.mock.mockImplementation(async () => Response.json({ files: [file] }))
  const populated = await requestRecentFigmaFiles(250)
  assert.equal(populated.source, 'local')
  assert.equal(populated.files[0].key, file.key)
  assert.equal(requests, 0)
  store.clear()
  fetchMock.mock.mockImplementation(async () => Response.json({ files: [] }))
  stub.designStudioHost = undefined
  assert.deepEqual(await requestRecentFigmaFiles(250), { status: 'unavailable', files: [] })
  assert.equal(requests, 1)
})
