import assert from 'node:assert/strict'
import test from 'node:test'
import { prepareStartup } from './startup.ts'

test('startup waits asynchronously and completes preparation once', async () => {
  let finish!: () => void
  let calls = 0
  const pending = prepareStartup(() => { calls++; return new Promise<void>(resolve => { finish = resolve }) }, async () => { throw new Error('unexpected retry') }, () => false)
  await new Promise<void>(resolve => setImmediate(resolve))
  assert.equal(calls, 1)
  finish()
  assert.equal(await pending, true)
})

test('startup retries denied preparation and can exit without another attempt', async () => {
  let calls = 0
  let prompts = 0
  assert.equal(await prepareStartup(async () => { if (++calls === 1) throw new Error('locked') }, async () => { prompts++; return true }, () => false), true)
  assert.equal(calls, 2)
  assert.equal(prompts, 1)
  assert.equal(await prepareStartup(async () => { throw new Error('locked') }, async () => false, () => false), false)
})

test('closing startup while permission is pending prevents workspace continuation', async () => {
  let cancelled = false
  let finish!: () => void
  const pending = prepareStartup(() => new Promise<void>(resolve => { finish = resolve }), async () => { throw new Error('must not prompt after close') }, () => cancelled)
  cancelled = true
  finish()
  assert.equal(await pending, false)
})
