import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import test from 'node:test'
import type { AgentRuntime, AgentUiMessage } from './types.ts'

const require = createRequire(import.meta.url)
const { build } = createRequire(require.resolve('vite/package.json'))('esbuild')
const bundled = await build({
  entryPoints: [fileURLToPath(new URL('./codexRuntime.ts', import.meta.url))], bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent',
  plugins: [{ name: 'external-excel', setup(builder: { onResolve: (options: { filter: RegExp }, callback: (args: { path: string }) => { path: string; external: true }) => void }) {
    builder.onResolve({ filter: /^exceljs$/ }, args => ({ path: pathToFileURL(require.resolve(args.path)).href, external: true }))
  } }],
})
const { createCodexRuntime } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`) as typeof import('./codexRuntime.ts')
const localModel = async ({ model }: { model?: string }) => model || 'fixture-local-codex'
const ready = async () => ({ installed: true, authenticated: true, authMethod: 'chatgpt' as const, ready: true, message: 'ChatGPT 已登录' })

async function fixture(t: test.TestContext, script: string) {
  const directory = await mkdtemp(join(tmpdir(), 'astrix-native-codex-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const bin = join(directory, 'codex')
  await writeFile(bin, `#!${process.execPath}\n${script}`, { mode: 0o700 })
  return { bin, cwd: directory }
}

async function collect(runtime: AgentRuntime, input: Parameters<AgentRuntime['run']>[0]): Promise<AgentUiMessage[]> {
  const values: AgentUiMessage[] = []
  for await (const item of runtime.run(input)) values.push(item)
  return values
}

test('本机额度模式拒绝API登录且不启动推理', async t => {
  const f = await fixture(t, 'require("node:fs").writeFileSync("inference-started", "bad")')
  const runtime = createCodexRuntime({ ...f, model: '', probeModel: async () => { throw new Error('API 登录不应读取模型设置') }, probeStatus: async () => ({ installed: true, authenticated: true, authMethod: 'api-key', ready: false, message: '请使用 ChatGPT 登录。' }) })
  await assert.rejects(collect(runtime, { message: '测试', emitRequestContext: false }), /ChatGPT/)
  await assert.rejects(access(join(f.cwd, 'inference-started')))
})

test('快速CLI退出也能完成；只用本机模型且移除API环境', async t => {
  const f = await fixture(t, String.raw`let input='';process.stdin.on('data',v=>input+=v);process.stdin.on('end',()=>{const text=JSON.stringify({args:process.argv.slice(2),api:Boolean(process.env.OPENAI_API_KEY||process.env.CODEX_API_KEY),parent:process.env.CODEX_THREAD_ID,input});process.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text}})+'\n')})`)
  const keys = ['OPENAI_API_KEY', 'CODEX_API_KEY', 'CODEX_THREAD_ID'] as const
  const previous = keys.map(key => [key, process.env[key]] as const)
  for (const key of keys) process.env[key] = 'fixture-must-not-be-used'
  t.after(() => { for (const [key, value] of previous) if (value === undefined) delete process.env[key]; else process.env[key] = value })
  let modelDiscovered = false
  const messages = await collect(createCodexRuntime({ ...f, model: '', probeModel: async options => {
    assert.equal(options.model, '')
    assert.equal(options.bin, f.bin)
    modelDiscovered = true
    return 'fixture-local-codex'
  }, probeStatus: ready }), { message: '只回复收到', model: 'api-only-model', emitRequestContext: false })
  const text = messages.find(item => item.kind === 'text')
  assert.ok(text?.kind === 'text')
  const value = JSON.parse(text.text)
  assert.ok(modelDiscovered)
  assert.equal(value.api, false)
  assert.equal(value.parent, undefined)
  assert.ok(!value.args.includes('api-only-model'))
  assert.ok(value.args.includes('fixture-local-codex'))
  assert.ok(value.args.includes('--ignore-user-config'))
  assert.ok(value.args.includes('forced_login_method="chatgpt"'))
  assert.match(value.input, /只回复收到/)
})

test('额度错误不返回原始诊断内容', async t => {
  const f = await fixture(t, String.raw`process.stdin.resume();process.stdin.on('end',()=>{process.stdout.write(JSON.stringify({type:'turn.failed',error:{message:'usage limit with private-fixture-value'}})+'\n')})`)
  await assert.rejects(collect(createCodexRuntime({ ...f, model: '', probeModel: localModel, probeStatus: ready }), { message: '检查需求', phase: 'assess', emitRequestContext: false }), error => {
    assert.ok(error instanceof Error)
    assert.match(error.message, /额度/)
    assert.ok(!error.message.includes('private-fixture-value'))
    return true
  })
})

test('显式Codex模型交给同一解析器，不沿用输入区API模型', async t => {
  const f = await fixture(t, String.raw`process.stdin.resume();process.stdin.on('end',()=>process.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify(process.argv.slice(2))}})+'\n'))`)
  const values = await collect(createCodexRuntime({ ...f, model: 'fixture-selected-codex', probeStatus: ready, probeModel: async options => {
    assert.equal(options.model, 'fixture-selected-codex')
    return options.model!
  } }), { message: '验证', model: 'api-only-model', emitRequestContext: false })
  const text = values.find(value => value.kind === 'text')
  assert.ok(text?.kind === 'text')
  const args = JSON.parse(text.text) as string[]
  assert.ok(args.includes('fixture-selected-codex'))
  assert.ok(!args.includes('api-only-model'))
})

test('模型发现期间取消后不会启动推理', async t => {
  const f = await fixture(t, 'require("node:fs").writeFileSync("inference-started", "bad")')
  const controller = new AbortController()
  await assert.rejects(collect(createCodexRuntime({ ...f, model: '', probeStatus: ready, probeModel: async options => {
    assert.equal(options.signal, controller.signal)
    controller.abort()
    return 'fixture-local-codex'
  } }), { message: '验证', signal: controller.signal, emitRequestContext: false }), error => error instanceof Error && error.name === 'AbortError')
  await assert.rejects(access(join(f.cwd, 'inference-started')))
})

test('取消会终止CLI并保留取消结果', async t => {
  const f = await fixture(t, 'process.stdin.resume();setInterval(()=>{},1000)')
  const controller = new AbortController()
  const pending = collect(createCodexRuntime({ ...f, model: '', probeModel: localModel, probeStatus: ready }), { message: '检查需求', signal: controller.signal, emitRequestContext: false })
  const timer = setTimeout(() => controller.abort(), 50)
  t.after(() => clearTimeout(timer))
  await assert.rejects(pending, error => error instanceof Error && error.name === 'AbortError')
})


test('账号拒绝模型时显示明确错误，不自动改用其他模型或API', async t => {
  const f = await fixture(t, String.raw`
const fs=require('node:fs');let count=0;try{count=Number(fs.readFileSync('count','utf8'))}catch{}
fs.writeFileSync('count',String(count+1));
process.stdin.resume();process.stdin.on('end',()=>process.stdout.write(JSON.stringify({type:'turn.failed',error:{message:'model_not_found: selected model is not supported with this account; private-fixture-value'}})+'\n'));
`)
  await assert.rejects(collect(createCodexRuntime({ ...f, model: '', probeModel: localModel, probeStatus: ready }), { message: '验证', emitRequestContext: false }), error => {
    assert.ok(error instanceof Error)
    assert.match(error.message, /账号无法使用此 Codex 模型/)
    assert.match(error.message, /不会自动/)
    assert.ok(!error.message.includes('private-fixture-value'))
    return true
  })
  assert.equal(await readFile(join(f.cwd, 'count'), 'utf8'), '1')
})
