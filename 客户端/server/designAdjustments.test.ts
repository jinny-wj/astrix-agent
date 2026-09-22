import assert from 'node:assert/strict'
import test from 'node:test'
import { parseFigmaInstruction } from './figmaInstruction.ts'
import type { FigmaSelectionSnapshot } from '../src/types/figmaWrite'

const selection: FigmaSelectionSnapshot = {
  sessionId: 'design', pageId: 'page', pageName: 'Page', revision: 1, updatedAt: 1,
  nodes: [{ id: 'text', name: '标题', type: 'TEXT', visible: true, locked: false, width: 100, height: 100,
    supports: { text: true, fill: true, resize: true, move: true, opacity: true, visibility: true, rename: true } }],
}

test('图片和 H5 组合指令生成有界的实际属性修改', () => {
  const image = parseFigmaInstruction('图片适应；图片曝光设为 15%；图片饱和度设为 -20%', selection)
  assert.equal(image.ok, true)
  if (image.ok) assert.deepEqual(image.patches, [
    { kind: 'set-image-mode', value: 'FIT' },
    { kind: 'set-image-filter', filter: 'exposure', value: 0.15 },
    { kind: 'set-image-filter', filter: 'saturation', value: -0.2 },
  ])
  const h5 = parseFigmaInstruction('字号设为 24px；行高设为 36px；圆角设为 0px；内边距设为 16px', selection)
  assert.equal(h5.ok, true)
  if (h5.ok) {
    assert.equal(h5.patches.length, 7)
    assert.deepEqual(h5.patches.slice(3).map(p => p.kind === 'set-layout-spacing' && p.property), ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'])
  }
})

test('资源位预设与用户指定尺寸可直接解析且不隐式重排或生成', () => {
  for (const [name, width, height] of [['直播广场banner', 584, 160], ['直播封面', 720, 1280], ['活动弹窗', 840, 1120], ['H5首屏', 375, 812]] as const) {
    const parsed = parseFigmaInstruction(`尺寸改为 ${name}`, selection)
    assert.equal(parsed.ok, true)
    if (parsed.ok) assert.deepEqual(parsed.patches, [{ kind: 'resize', width: { mode: 'set', value: width }, height: { mode: 'set', value: height } }])
  }
  assert.equal(parseFigmaInstruction('尺寸改为 900×1600', selection).ok, true)
})

test('无选区、越界、否定、疑问和未完整理解的复合操作不能执行', () => {
  for (const instruction of ['图片曝光设为 101%', '图片色温设为 -101%', '字号设为 0px', '行高设为 10001px', '内边距设为 -1px']) {
    const result = parseFigmaInstruction(instruction, selection)
    assert.equal(result.ok, false, instruction)
    if (!result.ok) assert.equal(result.code, 'INVALID_VALUE')
  }
  for (const instruction of ['不要图片填充', '图片适应可以吗？', '字号设为 24px；然后自动重排所有内容', '图片曝光增加 10%', '图片曝光设为 15%；把人物换掉']) {
    assert.equal(parseFigmaInstruction(instruction, selection).ok, false, instruction)
  }
  const absent = parseFigmaInstruction('图片填充', { ...selection, nodes: [] })
  assert.equal(absent.ok, false)
  if (!absent.ok) assert.equal(absent.code, 'NO_SELECTION')
  const frame = { ...selection, nodes: selection.nodes.map(node => ({ ...node, type: 'FRAME', supports: { ...node.supports, text: false } })) }
  assert.equal(parseFigmaInstruction('字号设为 24px', frame).ok, false)
})
