import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { disconnectFigma, onFigmaAuthSessionChange, startFigmaOAuth } from './figmaAuth.ts'

function browserEnvironment(t: TestContext) {
  const assigned: string[] = []
  const opened: string[] = []
  const windowStub = Object.assign(new EventTarget(), {
    location: {
      href: 'http://127.0.0.1:5274/agent?skill=poster#batch',
      origin: 'http://127.0.0.1:5274',
      assign: (url: string) => { assigned.push(url) },
    },
    open: (url: string): object | null => { opened.push(url); return {} },
    designStudioHost: undefined as object | undefined,
  })
  const documentStub = Object.assign(new EventTarget(), { visibilityState: 'visible' })
  const descriptors = new Map(
    ['window', 'document'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  )
  Object.defineProperty(globalThis, 'window', { configurable: true, value: windowStub })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: documentStub })
  t.after(() => {
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  })
  return { windowStub, documentStub, assigned, opened }
}

test('浏览器授权保留当前页面，弹窗被拦截时用当前标签继续', (t) => {
  const { windowStub, assigned, opened } = browserEnvironment(t)
  startFigmaOAuth()
  assert.equal(opened.length, 1)
  const authUrl = new URL(opened[0], windowStub.location.origin)
  assert.equal(authUrl.pathname, '/api/auth/figma/start')
  assert.equal(authUrl.searchParams.get('returnTo'), '/agent?skill=poster#batch')
  assert.deepEqual(assigned, [])
  windowStub.open = () => null
  startFigmaOAuth('//external.example/')
  assert.equal(new URL(assigned[0], windowStub.location.origin).searchParams.get('returnTo'), '/')
})

test('桌面连接进入由宿主接管的本地授权入口，不打开开发者应用页', (t) => {
  const { windowStub, assigned, opened } = browserEnvironment(t)
  windowStub.designStudioHost = {}
  startFigmaOAuth('/editor')
  assert.deepEqual(assigned, ['/api/auth/figma/start?returnTo=%2Feditor'])
  assert.deepEqual(opened, [])
})

test('浏览器返回、同源授权结果和解绑会刷新连接状态，取消订阅后不再刷新', async (t) => {
  const { windowStub, documentStub } = browserEnvironment(t)
  let updates = 0
  const unsubscribe = onFigmaAuthSessionChange(() => { updates += 1 })
  windowStub.dispatchEvent(new MessageEvent('message', {
    origin: 'https://another.example', data: { type: 'design-studio:figma-auth' },
  }))
  assert.equal(updates, 0)
  windowStub.dispatchEvent(new MessageEvent('message', {
    origin: windowStub.location.origin, data: { type: 'design-studio:figma-auth', result: 'connected' },
  }))
  windowStub.dispatchEvent(new Event('focus'))
  documentStub.dispatchEvent(new Event('visibilitychange'))
  assert.equal(updates, 3)
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 204 }))
  await disconnectFigma()
  assert.equal(updates, 4)
  fetchMock.mock.mockImplementation(async () => new Response(null, { status: 500 }))
  await assert.rejects(disconnectFigma, /解绑/)
  assert.equal(updates, 4)
  unsubscribe()
  windowStub.dispatchEvent(new Event('focus'))
  documentStub.dispatchEvent(new Event('visibilitychange'))
  assert.equal(updates, 4)
})
