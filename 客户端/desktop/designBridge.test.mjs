import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'

const code = readFileSync(new URL('../figma-plugin-bridge/code.js', import.meta.url), 'utf8')
function node(id, extras = {}) {
  return { id, name: id, type: 'RECTANGLE', locked: false, visible: true, width: 100, height: 100, x: 0, y: 0, cornerRadius: 0,
    fills: [{ type: 'IMAGE', imageHash: 'original', scaleMode: 'CROP', imageTransform: [[1, 0, 0.2], [0, 1, 0]], filters: { contrast: 0.3 } }, { type: 'SOLID', color: { r: 1, g: 0, b: 0 } }],
    resize(width, height) { this.width = width; this.height = height }, ...extras }
}
function harness(nodes) {
  const fonts = []
  const figma = { mixed: Symbol('mixed'), showUI() {}, root: { setRelaunchData() {} }, on() {}, notify() {}, ui: { postMessage() {} },
    currentPage: { type: 'PAGE', id: 'page', selection: nodes }, fileKey: 'test-file',
    getNodeByIdAsync: async id => nodes.find(n => n.id === id), loadFontAsync: async font => fonts.push(font), commitUndo() {} }
  const context = vm.createContext({ figma, __html__: '', setTimeout() {} })
  vm.runInContext(code, context)
  let id = 0
  return { figma, fonts, run: async (patches, overrides = {}) => {
    context.command = { id: `command-${++id}`, type: 'patch-nodes', sessionId: vm.runInContext('BRIDGE_SESSION_ID', context),
      fileKey: figma.fileKey, selectionRevision: vm.runInContext('selectionRevision', context), executionMode: 'atomic',
      targets: nodes.map(n => ({ nodeId: n.id, expectedType: n.type, patches })), ...overrides }
    return JSON.parse(JSON.stringify(await vm.runInContext('executeCommand(command)', context)))
  } }
}

test('真实插件代码修改图片显示方式和调色，保留原图及其他填充', async () => {
  const image = node('photo')
  const h = harness([image])
  const result = await h.run([{ kind: 'set-image-mode', value: 'FIT' }, { kind: 'set-image-filter', filter: 'exposure', value: 0.2 }])
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(image.fills[0].imageHash, 'original')
  assert.equal(image.fills[0].scaleMode, 'FIT')
  assert.equal(image.fills[0].imageTransform, undefined)
  assert.equal(image.fills[0].filters.contrast, 0.3)
  assert.equal(image.fills[0].filters.exposure, 0.2)
  assert.equal(image.fills[1].type, 'SOLID')
})

test('非图片图层、非法调色值和非自动布局容器在写入前被拒绝', async () => {
  const image = node('photo')
  const plain = node('plain', { fills: [] })
  assert.equal((await harness([image, plain]).run([{ kind: 'set-image-mode', value: 'FIT' }])).ok, false)
  assert.equal(image.fills[0].scaleMode, 'CROP')
  assert.equal((await harness([image]).run([{ kind: 'set-image-filter', filter: 'exposure', value: 2 }])).ok, false)
  assert.equal((await harness([image]).run([{ kind: 'set-layout-spacing', property: 'itemSpacing', value: 16 }])).ok, false)
})

test('H5 文本先加载字体，布局修改只影响指定属性', async () => {
  const text = node('title', { type: 'TEXT', characters: '标题', fontName: { family: 'Inter', style: 'Regular' }, fontSize: 16,
    lineHeight: { unit: 'AUTO' }, getStyledTextSegments() { return [{ start: 0, end: 2, fontSize: this.fontSize, lineHeight: this.lineHeight }] } })
  const h = harness([text])
  assert.equal((await h.run([{ kind: 'set-font-size', value: 24 }, { kind: 'set-line-height', value: 36 }])).ok, true)
  assert.equal(h.fonts.length, 1)
  assert.equal(text.fontSize, 24)
  assert.equal(text.lineHeight.value, 36)
  const frame = node('h5', { type: 'FRAME', layoutMode: 'VERTICAL', itemSpacing: 8, paddingTop: 8, paddingBottom: 8 })
  assert.equal((await harness([frame]).run([{ kind: 'set-layout-spacing', property: 'paddingTop', value: 32 }, { kind: 'set-layout-spacing', property: 'itemSpacing', value: 12 }])).ok, true)
  assert.equal(frame.paddingTop, 32)
  assert.equal(frame.paddingBottom, 8)
  assert.equal(frame.itemSpacing, 12)
})

test('后续写入失败会回滚图片调色；过期选区和跨文件命令被拒绝', async () => {
  const image = node('photo')
  let radius = 0
  const failing = node('second')
  Object.defineProperty(failing, 'cornerRadius', { get: () => radius, set(value) { if (value === 12) throw new Error('read only'); radius = value } })
  const before = JSON.stringify(image.fills)
  const h = harness([image, failing])
  const result = await h.run([{ kind: 'set-image-filter', filter: 'saturation', value: -0.2 }, { kind: 'set-corner-radius', value: 12 }])
  assert.equal(result.ok, false)
  assert.equal(result.nodeResults[0].status, 'rolled-back')
  assert.equal(JSON.stringify(image.fills), before)
  assert.equal(image.cornerRadius, 0)
  assert.equal((await h.run([{ kind: 'set-image-mode', value: 'FIT' }], { selectionRevision: 99 })).ok, false)
  assert.equal((await h.run([{ kind: 'set-image-mode', value: 'FIT' }], { fileKey: 'other-file' })).ok, false)
})
