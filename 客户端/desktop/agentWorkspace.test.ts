import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { prepareAgentWorkspace } from './agentWorkspace.ts'
import { saveUploadedFiles } from '../server/agent/composer.ts'

test('packaged Agent uses a real workspace with skills and writable attachments', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'ds-workspace-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const resources = join(root, 'agent-resources')
  mkdirSync(join(resources, 'skills', 'example'), { recursive: true })
  writeFileSync(join(resources, 'skills', 'example', 'SKILL.md'), 'skill v1')
  writeFileSync(join(resources, 'AGENTS.md'), 'agent rules')
  const workspace = prepareAgentWorkspace(join(root, 'user-data'), resources)
  const child = spawnSync(process.execPath, ['-e', 'console.log(process.cwd())'], { cwd: workspace, encoding: 'utf8' })
  assert.equal(child.status, 0)
  assert.equal(readFileSync(join(workspace, 'skills', 'example', 'SKILL.md'), 'utf8'), 'skill v1')
  const [file] = await saveUploadedFiles(workspace, [{ name: 'brief.txt', mime: 'text/plain', contentBase64: Buffer.from('brief').toString('base64') }])
  assert.equal(readFileSync(file.path!, 'utf8'), 'brief')
  writeFileSync(join(resources, 'skills', 'example', 'SKILL.md'), 'skill v2')
  prepareAgentWorkspace(join(root, 'user-data'), resources)
  assert.equal(readFileSync(join(workspace, 'skills', 'example', 'SKILL.md'), 'utf8'), 'skill v2')
  assert.equal(readFileSync(file.path!, 'utf8'), 'brief')
})
