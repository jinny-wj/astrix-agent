import assert from 'node:assert/strict'
import test from 'node:test'
import { publicRuntimeError } from './runtimeErrors.ts'
import { inferRefs, pickSkill } from './skills.ts'
import { childEnv } from './whichBin.ts'

test('普通消息不会被误判为资源位延展', () => {
  assert.equal(pickSkill('仅回复一句：连接正常。'), 'layer-edit')
  assert.equal(pickSkill('只回复一个词：收到'), 'layer-edit')
  assert.deepEqual(inferRefs('连接正常'), [])
})

test('额度用尽时返回可执行的公开错误', () => {
  const message = publicRuntimeError(
    new Error("You've hit your usage limit. Try again at 5:43 PM."),
  )
  assert.match(message, /额度/)
  assert.match(message, /5:43 PM/)
})

test('子 Agent 不继承父 Codex 会话标记', () => {
  const previous = {
    sandbox: process.env.CODEX_SANDBOX,
    thread: process.env.CODEX_THREAD_ID,
  }
  process.env.CODEX_SANDBOX = 'sandboxed'
  process.env.CODEX_THREAD_ID = 'thread-id'
  try {
    const env = childEnv()
    assert.equal(env.CODEX_SANDBOX, undefined)
    assert.equal(env.CODEX_THREAD_ID, undefined)
  } finally {
    if (previous.sandbox === undefined) delete process.env.CODEX_SANDBOX
    else process.env.CODEX_SANDBOX = previous.sandbox
    if (previous.thread === undefined) delete process.env.CODEX_THREAD_ID
    else process.env.CODEX_THREAD_ID = previous.thread
  }
})
