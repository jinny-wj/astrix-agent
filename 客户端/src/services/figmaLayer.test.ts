import assert from 'node:assert/strict'
import test from 'node:test'
import {
  figmaNodeToSelectedNode,
  flattenNamedLayers,
  formatSelectionPrompt,
  attachLiveBridgeSession,
  preferPreviewLayers,
  resolveLayerTarget,
  selectionSnapshotFromLayers,
  targetedLayerFromNode,
} from './figmaLayer.ts'
import type { FigmaNode } from '../types/figma.ts'

test('REST 文本图层映射到选区节点', () => {
  const node = {
    id: '12:34',
    name: '主标题',
    type: 'TEXT',
    characters: '冠军',
    absoluteBoundingBox: { x: 40, y: 80, width: 240, height: 64 },
    fills: [{ type: 'SOLID', color: { r: 1, g: 0.8, b: 0.2, a: 1 } }],
  } as FigmaNode

  const selected = figmaNodeToSelectedNode(node)
  assert.equal(selected.id, '12:34')
  assert.equal(selected.supports.text, true)
  assert.equal(selected.characters, '冠军')
  assert.deepEqual(selected.fills, [{ r: 1, g: 0.8, b: 0.2, a: 1 }])
})

test('图层花片可以生成 Agent 选区快照', () => {
  const layer = targetedLayerFromNode({
    id: '1:2',
    name: 'KV',
    type: 'FRAME',
    absoluteBoundingBox: { x: 0, y: 0, width: 720, height: 1280 },
  } as FigmaNode, { fileKey: 'abc' })

  const snapshot = selectionSnapshotFromLayers([layer])
  assert.ok(snapshot)
  assert.equal(snapshot?.fileKey, 'abc')
  assert.equal(snapshot?.nodes[0]?.name, 'KV')
  assert.match(formatSelectionPrompt(snapshot), /KV/)
})

test('不同选区不会借用 Bridge 选区锁，同一选区保留真实节点属性', () => {
  const layer = targetedLayerFromNode({
    id: '9:9',
    name: '按钮',
    type: 'FRAME',
  } as FigmaNode, { fileKey: 'file-a' })
  const oauth = selectionSnapshotFromLayers([layer], { fileKey: 'file-a' })
  const live = {
    sessionId: 'figma-live',
    fileKey: 'file-a',
    pageId: '0:1',
    pageName: 'Page 1',
    revision: 12,
    updatedAt: Date.now(),
    nodes: [{
      id: '1:1',
      name: '当前 Figma 选区',
      type: 'FRAME',
      visible: true,
      locked: false,
      supports: {
        text: false,
        fill: true,
        opacity: true,
        resize: true,
        move: true,
        visibility: true,
        rename: true,
      },
    }],
  }
  const attached = attachLiveBridgeSession(oauth, live)
  assert.equal(attached?.sessionId, 'oauth:file-a')
  assert.equal(attached?.nodes[0]?.id, '9:9')
  const same = { ...live, nodes: [{ ...live.nodes[0], id: '9:9', locked: true }] }
  const matching = attachLiveBridgeSession(oauth, same)
  assert.equal(matching?.sessionId, 'figma-live')
  assert.equal(matching?.revision, 12)
  assert.equal(matching?.nodes[0]?.locked, true)
  assert.equal(attachLiveBridgeSession(null, same), null)
  assert.equal(attachLiveBridgeSession(oauth, { ...same, fileKey: 'other' }), oauth)
})

test('实时图层跟随 Bridge 点击、切换、清空，并隔离不同文件', () => {
  const oauth = { id: 'old', name: '链接里的旧图层', type: 'TEXT', fileKey: 'a' }
  const base = selectionSnapshotFromLayers([{ ...oauth, id: 'new', name: '实时图层' }])!
  const bridge = { ...base, sessionId: 'live', revision: 1 }
  const resolve = (selection: typeof bridge | null, preview = null as typeof oauth[] | null) =>
    resolveLayerTarget({ fileKey: 'a', preview, bridge: selection, oauth })
  assert.equal(resolve(bridge)[0].id, 'new')
  assert.equal(resolve({ ...bridge, nodes: [{ ...bridge.nodes[0], id: 'next' }] })[0].id, 'next')
  assert.deepEqual(resolve({ ...bridge, nodes: [] }), [])
  assert.deepEqual(resolve(bridge, []), [])
  assert.equal(resolve({ ...bridge, fileKey: 'other' })[0].id, 'old')
  assert.equal(resolve(null)[0].id, 'old')
  assert.deepEqual(resolveLayerTarget({ fileKey: 'other', preview: null, bridge, oauth }), [])
})

test('预览选区优先于 Bridge 当前选区', () => {
  const preview = [{
    id: '9:9',
    name: '预览按钮',
    type: 'FRAME',
    fileKey: 'file-a',
  }]
  const bridge = [{
    id: '1:1',
    name: '插件选区',
    type: 'FRAME',
    fileKey: 'file-a',
  }]
  assert.equal(preferPreviewLayers(preview, bridge)[0]?.id, '9:9')
  assert.equal(preferPreviewLayers([], bridge)[0]?.id, '1:1')
})

test('引用上下文能列出可点选的命名图层', () => {
  const layers = flattenNamedLayers({
    id: '0:0',
    name: 'Document',
    type: 'DOCUMENT',
    children: [{
      id: '1:1',
      name: '页面 1',
      type: 'CANVAS',
      children: [
        { id: '1:2', name: 'AI 视觉创意', type: 'FRAME', children: [] },
        { id: '1:3', name: '主标题', type: 'TEXT', children: [] },
      ],
    }],
  } as FigmaNode)
  assert.deepEqual(
    layers.map((layer) => layer.name),
    ['AI 视觉创意', '主标题'],
  )
})
