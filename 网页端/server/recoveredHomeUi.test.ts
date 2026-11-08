import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import test from 'node:test'

test('恢复首页隐藏旧后台画布占位，保留其他真实错误，并移除无效企业手册', async context => {
  const home = new URL('../workbench/public/vendor/s2-12205.kwimgs.com/kos/proj-gis/Z2lz/kos/nlav12205/workbench/assets/home-Dq22ywRR.js', import.meta.url)
  let source: string
  try { source = await readFile(home, 'utf8') } catch (error: any) { if (error.code === 'ENOENT') { context.skip('需要已准备的恢复UI资源'); return } throw error }
  const start = source.indexOf('!unref(T)&&unref(te)?')
  const suffix = ':createCommentVNode("",!0)'
  const end = source.indexOf(suffix, start) + suffix.length
  assert.ok(start >= 0 && end > start)
  const expression = source.slice(start, end)
  const node = (tag: string, props: any, children?: any) => ({ tag, props, children })
  const render = (message: string, local = true) => vm.runInNewContext(expression, {
    window: { __M0_LOCAL_RUNTIME__: local }, T: { value: false }, te: { value: message }, s: [],
    unref: (value: any) => value.value, openBlock() {}, withCtx: (fn: any) => fn,
    createElementBlock: node, createBaseVNode: node, createBlock: node, createVNode: node,
    createTextVNode: (value: string) => value, createCommentVNode() {}, be: 'warning', ce: 'button', V: { value() {} },
  })
  const unsupported = 'Figma 后台画布需要在桌面端使用'
  assert.equal(render(unsupported), undefined)
  for (const message of ['实际网络错误', '请先完成 SSO 登录']) {
    assert.equal(render(message).props.subtitle, message)
  }
  assert.equal(render(unsupported, false).tag, 'warning')
  assert.equal(source.includes('class:"workspace-manual-link",href:"https://docs.'), false)
  assert.ok(source.includes('throw new Error("请先完成 SSO 登录")'), '原授权失败保持真实')
})
