import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  composerPromptBlock,
  inferAttachmentKind,
  parseCodexMcpServers,
  sanitizeAttachment,
  saveUploadedFiles,
} from './composer.ts'

test('从 Codex config 解析 MCP 服务名', () => {
  const servers = parseCodexMcpServers(`
[mcp_servers.playwright]
command = "npx"
args = ["@playwright/mcp@latest"]

[mcp_servers.figma]
command = "figma-mcp"
`)
  assert.deepEqual(
    servers.map((item) => item.id),
    ['playwright', 'figma'],
  )
  assert.equal(servers[0]?.command, 'npx')
})

test('附件与指令会写进发给 Codex 的 prompt', () => {
  const prompt = composerPromptBlock({
    cwd: '/tmp/studio',
    instructions: [{
      id: 'layer-only',
      title: '只改当前图层',
      body: '不要扩散到整页。',
    }],
    contextRefs: [{
      id: 'layer:1:2',
      kind: 'layer',
      label: 'AI 视觉创意',
      detail: 'FRAME',
      nodeId: '1:2',
    }],
    attachments: [{
      id: 'att-1',
      name: 'brief.md',
      mime: 'text/markdown',
      size: 12,
      kind: 'text',
      text: '主标题改成盛典',
    }],
  })
  assert.match(prompt, /只改当前图层/)
  assert.match(prompt, /AI 视觉创意/)
  assert.match(prompt, /主标题改成盛典/)
})

test('上传文件落到附件目录且文本可回读', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'ds-att-'))
  try {
    const files = await saveUploadedFiles(cwd, [{
      name: 'note.txt',
      mime: 'text/plain',
      contentBase64: Buffer.from('hello agent', 'utf8').toString('base64'),
    }])
    assert.equal(files.length, 1)
    assert.equal(files[0]?.kind, 'text')
    assert.equal(files[0]?.text, 'hello agent')
    assert.ok(files[0]?.path)
    const saved = await readFile(files[0]!.path!, 'utf8')
    assert.equal(saved, 'hello agent')

    const sanitized = sanitizeAttachment({
      id: files[0]!.id,
      name: files[0]!.name,
      mime: files[0]!.mime,
      size: files[0]!.size,
      path: files[0]!.path,
      kind: files[0]!.kind,
    }, cwd)
    assert.equal(sanitized?.path, files[0]!.path)

    const escaped = sanitizeAttachment({
      name: 'evil.txt',
      path: join(cwd, '..', 'passwd'),
    }, cwd)
    assert.equal(escaped?.path, undefined)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test('按扩展名识别附件类型', () => {
  assert.equal(inferAttachmentKind('a.png', ''), 'image')
  assert.equal(inferAttachmentKind('a.md', ''), 'text')
  assert.equal(inferAttachmentKind('a.bin', 'application/octet-stream'), 'binary')
})

test('prompt 里的图片用相对路径让 Codex Read', () => {
  const cwd = '/tmp/studio-cwd'
  const block = composerPromptBlock({
    cwd,
    attachments: [{
      id: 'att-2',
      name: 'pic.png',
      mime: 'image/png',
      size: 8,
      kind: 'image',
      path: join(cwd, '.design-studio', 'attachments', 'pic.png'),
    }],
  })
  assert.match(block, /\.design-studio\/attachments\/pic\.png/)
  assert.match(block, /请用 Read 查看该文件/)
})
