import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

test('native editor canonicalizes a symlinked state directory for renderer admission and helper configuration', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'astrix-native-path-'))
  const realRoot = await fs.realpath(temporary)
  await fs.mkdir(path.join(realRoot, 'state'))
  const alias = path.join(realRoot, 'state-alias')
  await fs.symlink(path.join(realRoot, 'state'), alias)
  const sourcePath = fileURLToPath(new URL('../workbench/desktop/original-editor.cjs', import.meta.url))
  const baseRequire = createRequire(sourcePath)
  const owner = new EventEmitter()
  owner.webContents = new EventEmitter()
  let workerConfiguration, workerCwd
  const child = new EventEmitter()
  Object.assign(child, {
    stdout: new EventEmitter(), stderr: new EventEmitter(), connected: true,
    exitCode: null, signalCode: null, killed: false,
    kill() { this.killed = true; this.exitCode = 0; this.emit('exit', 0) },
  })
  const loaded = { exports: {} }
  const context = {
    module: loaded, exports: loaded.exports, __dirname: path.dirname(sourcePath),
    process, Buffer, URL, setInterval, clearInterval, setTimeout, clearTimeout,
    require(name) {
      if (name === 'electron') return { app: { getPath: () => path.join(alias, 'profile') } }
      if (name === 'node:child_process') return { fork(_file, _args, options) {
        workerConfiguration = JSON.parse(Buffer.from(options.env.M0_ORIGINAL_EDITOR_CONFIG, 'base64url').toString())
        workerCwd = options.cwd
        setImmediate(() => child.emit('message', { type: 'ready' }))
        return child
      } }
      return baseRequire(name)
    },
  }
  vm.runInNewContext(await fs.readFile(sourcePath, 'utf8'), context, { filename: sourcePath })
  const { OriginalEditorManager } = loaded.exports
  const manager = new OriginalEditorManager({
    window: owner, root: path.dirname(path.dirname(sourcePath)), baseURL: 'http://127.0.0.1:4317',
    layout: { recoveryRoot: path.join(realRoot, 'recovery') },
    statePaths: { dataDir: alias, diagnosticsDir: path.join(realRoot, 'diagnostics') },
  })
  try {
    await manager.startServer()
    const canonical = await fs.realpath(path.join(alias, 'native-editor'))
    assert.ok(manager.sandbox.startsWith(canonical + path.sep))
    assert.equal(workerCwd, manager.sandbox)
    assert.equal(workerConfiguration.sandbox, manager.sandbox)
    assert.equal(workerConfiguration.agent, path.join(manager.sandbox, 'agent'))
    assert.equal(await fs.realpath(workerConfiguration.agent), workerConfiguration.agent)
    const entry = path.join(manager.sandbox, 'entry-test.html')
    await fs.writeFile(entry, '<!doctype html>')
    assert.ok((await fs.realpath(entry)).startsWith(manager.sandbox + path.sep))
    assert.ok(!workerConfiguration.sandbox.includes('state-alias'))
  } finally {
    manager.dispose()
    await manager.writeDiagnostics()
    await fs.rm(realRoot, { recursive: true, force: true })
  }
})
