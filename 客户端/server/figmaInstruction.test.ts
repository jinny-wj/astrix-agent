import assert from 'node:assert/strict'
import test from 'node:test'
import {
  parseFigmaCreateInstruction,
  parseFigmaInstruction,
} from './figmaInstruction.ts'

const emptySelection = {
  sessionId: 'figma-empty',
  fileKey: 'file-empty',
  pageId: '0:1',
  pageName: 'Page 1',
  revision: 1,
  updatedAt: Date.now(),
  nodes: [],
}

test('parseFigmaCreateInstruction builds a default mobile frame', () => {
  const parsed = parseFigmaCreateInstruction('创建一个 375×812 的画板')
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return
  assert.equal(parsed.drafts[0]?.type, 'create-frame')
  if (parsed.drafts[0]?.type !== 'create-frame') return
  assert.equal(parsed.drafts[0].width, 375)
  assert.equal(parsed.drafts[0].height, 812)
})

test('parseFigmaCreateInstruction writes a titled frame in one command', () => {
  const parsed = parseFigmaCreateInstruction('新建一个画板，标题写成「春季上新」')
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return
  assert.equal(parsed.drafts[0]?.type, 'clone-into-frame')
  if (parsed.drafts[0]?.type !== 'clone-into-frame') return
  assert.equal(parsed.drafts[0].labels[0]?.characters, '春季上新')
})

test('empty selection still recognizes a fill edit', () => {
  const parsed = parseFigmaInstruction('改成红色', emptySelection)
  assert.equal(parsed.ok, false)
  if (parsed.ok) return
  assert.equal(parsed.code, 'NO_SELECTION')
})

test('analysis requests stay unsupported without a selection', () => {
  const parsed = parseFigmaInstruction('帮我分析一下这个图层', emptySelection)
  assert.equal(parsed.ok, false)
  if (parsed.ok) return
  assert.equal(parsed.code, 'UNSUPPORTED_INSTRUCTION')
})

test('title edits never become new text nodes', () => {
  const message = '把标题改成「夏日活动」'
  assert.equal(parseFigmaCreateInstruction(message).ok, false)
  const parsed = parseFigmaInstruction(message, {
    ...emptySelection,
    nodes: [{
      id: '1:1', name: '标题', type: 'TEXT', visible: true, locked: false,
      supports: { text: true, fill: true, opacity: true, resize: true, move: true, visibility: true, rename: true },
    }],
  })
  assert.equal(parsed.ok, true)
  if (parsed.ok) assert.deepEqual(parsed.patches, [{ kind: 'replace-text', value: '夏日活动' }])
})

test('negated, analytical and partially understood requests never enqueue creation', () => {
  for (const message of [
    '不要创建画板，只分析当前设计',
    '请不要新建画板',
    '如何创建一个画板？',
    '能否创建画板',
    '创建一个画板但先不要执行',
    '创建一个画板，然后帮我设计登录页',
    '解释一下新建文本的作用',
  ]) {
    assert.equal(parseFigmaCreateInstruction(message).ok, false, message)
  }
})

test('explicit text creation allows negation inside the copy', () => {
  const parsed = parseFigmaCreateInstruction('新建一个文本「不要错过活动」')
  assert.equal(parsed.ok, true)
  if (parsed.ok) assert.equal(parsed.drafts[0].type, 'create-text')
})

test('a frame name is not treated as its title', () => {
  const parsed = parseFigmaCreateInstruction('新建一个画板，名叫「首页」，标题写成「欢迎」')
  assert.equal(parsed.ok, true)
  if (parsed.ok && parsed.drafts[0].type === 'clone-into-frame') {
    assert.equal(parsed.drafts[0].name, '首页')
    assert.equal(parsed.drafts[0].labels[0].characters, '欢迎')
  } else assert.fail('expected titled frame')
})
