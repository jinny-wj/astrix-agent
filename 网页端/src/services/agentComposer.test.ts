import assert from 'node:assert/strict'
import test from 'node:test'
import { AGENT_BACKEND_CHANGED, readPreferredBackend, writePreferredBackend } from './agentComposer.ts'

function stores(t: test.TestContext) {
  const session = new Map<string, string>()
  const local = new Map<string, string>()
  for (const [name, values] of [['sessionStorage', session], ['localStorage', local]] as const) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name)
    Object.defineProperty(globalThis, name, {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
    })
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, name, previous)
      else Reflect.deleteProperty(globalThis, name)
    })
  }
  return { session, local }
}

test('本机 Agent 选择在输入区重建后保留，自动选择清除偏好', t => {
  const { session, local } = stores(t)
  writePreferredBackend('claude')
  assert.equal(readPreferredBackend(), 'claude')
  writePreferredBackend('codex')
  assert.equal(readPreferredBackend(), 'codex')
  writePreferredBackend(undefined)
  assert.equal(readPreferredBackend(), undefined)
  assert.equal(session.size, 0)
  assert.equal(local.size, 0)
})

test('关闭会话后从持久存储恢复本机选择，设置变更通知已打开的输入区', t => {
  const { session, local } = stores(t)
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const events = new EventTarget()
  Object.defineProperty(globalThis, 'window', { configurable: true, value: events })
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'window', previous)
    else Reflect.deleteProperty(globalThis, 'window')
  })
  let refreshed: string | undefined
  events.addEventListener(AGENT_BACKEND_CHANGED, () => { refreshed = readPreferredBackend() })
  writePreferredBackend('codex')
  assert.equal(refreshed, 'codex')
  session.clear()
  assert.equal(readPreferredBackend(), 'codex')
  assert.deepEqual([...local.values()], ['codex'])
  writePreferredBackend(undefined)
  assert.equal(refreshed, undefined)
  assert.equal(readPreferredBackend(), undefined)
})
