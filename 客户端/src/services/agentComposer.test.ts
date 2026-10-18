import assert from 'node:assert/strict'
import test from 'node:test'
import { readPreferredBackend, writePreferredBackend } from './agentComposer.ts'

test('手动 API 选择在输入区重建后保留，自动选择清除偏好且兼容本机 Agent', t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')
  const values = new Map<string, string>()
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  })
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'sessionStorage', previous)
    else Reflect.deleteProperty(globalThis, 'sessionStorage')
  })
  writePreferredBackend('model-api')
  assert.equal(readPreferredBackend(), 'model-api')
  writePreferredBackend('codex')
  assert.equal(readPreferredBackend(), 'codex')
  writePreferredBackend(undefined)
  assert.equal(readPreferredBackend(), undefined)
  assert.equal(values.size, 0)
})
