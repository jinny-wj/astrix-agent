import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createConversationStore, executionInput, parseAssessment, requiredQuestions } from './conversation.ts'
import type { AgentRunInput } from './types.ts'

function fixture(t: test.TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'astrix-conversation-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  return { directory, store: createConversationStore(directory) }
}
const selection = { sessionId: 'mock-plugin', fileKey: 'mock-file', pageId: 'page', pageName: 'Page', revision: 1, updatedAt: 1,
  nodes: [{ id: '1:2', name: '标题', type: 'TEXT', visible: true, locked: false, characters: 'Spring 活动 5.1-5.11', supports: { text: true, fill: true, opacity: true, resize: true, move: true, visibility: true, rename: true } }] }
const start = (store: ReturnType<typeof createConversationStore>, input: AgentRunInput) => store.begin({ requestId: randomUUID() }, input, new AbortController())

test('缺关键输入时暂停，只有回答文字不能代替真实素材', t => {
  const { store } = fixture(t)
  const turn = start(store, { message: '请美化这张主播照片' })
  const questions = requiredQuestions(turn)
  assert.equal(questions[0].id, 'source_image')
  const pending = store.pause(turn, questions)
  turn.release()
  const next = store.begin({ conversationId: turn.record.conversationId, requestId: randomUUID(), clarificationAnswer: { id: pending.id, answers: { source_image: '图片在这里' } } }, { message: '图片在这里' }, new AbortController())
  assert.equal(requiredQuestions(next)[0].id, 'source_image')
  next.release()
})

test('同一任务补答保留原需求、Skill、附件、图层和完整问答，重建store后可恢复', t => {
  const { store, directory } = fixture(t)
  const turn = start(store, { message: '把这张战报改成秋季活动', selection,
    attachments: [{ id: 'brief', name: 'brief.txt', kind: 'text', mime: 'text/plain', size: 10, text: '保留品牌主色' }] })
  const questions = requiredQuestions(turn)
  assert.deepEqual(questions.map(q => q.id), ['season_text', 'activity_name', 'activity_date'])
  const pending = store.pause(turn, questions)
  const id = turn.record.conversationId
  const taskId = turn.record.taskId
  turn.release()
  const restarted = createConversationStore(directory)
  assert.equal(restarted.get(id).status, 'awaiting_user')
  const resumed = restarted.begin({ conversationId: id, requestId: randomUUID(), clarificationAnswer: { id: pending.id, answers: { season_text: '改成Autumn', activity_name: '秋日活动', activity_date: '日期不变' } } }, { message: '日期不变' }, new AbortController())
  assert.equal(resumed.record.taskId, taskId)
  assert.equal(resumed.record.originalRequest, '把这张战报改成秋季活动')
  assert.equal(resumed.input.skill, 'battle-report')
  assert.equal(resumed.input.selection?.fileKey, 'mock-file')
  assert.equal(resumed.input.attachments?.[0].id, 'brief')
  assert.match(JSON.stringify(resumed.input.history), /原稿中的活动日期/)
  assert.match(JSON.stringify(resumed.input.history), /日期不变/)
  assert.match(resumed.input.message, /秋日活动/)
  assert.deepEqual(requiredQuestions(resumed), [])
  restarted.finish(resumed, 'completed')
  resumed.release()
  assert.equal(createConversationStore(directory).get(id).status, 'completed')
})

test('首次requestId重试也归同一会话，持久化去重且并发不同请求被拒绝', t => {
  const { store, directory } = fixture(t)
  const requestId = randomUUID()
  const first = store.begin({ requestId }, { message: '请调整一下设计稿', selection }, new AbortController())
  const duplicate = store.begin({ requestId }, { message: '请调整一下设计稿', selection }, new AbortController())
  assert.equal(duplicate.replay, true)
  assert.equal(duplicate.record.conversationId, first.record.conversationId)
  assert.throws(() => store.begin({ conversationId: first.record.conversationId, requestId: randomUUID() }, { message: '另一个任务' }, new AbortController()), /正在处理/)
  store.pause(first, requiredQuestions(first))
  first.release()
  const restored = createConversationStore(directory).begin({ requestId }, { message: '重复提交' }, new AbortController())
  assert.equal(restored.replay, true)
  assert.equal(restored.record.conversationId, first.record.conversationId)
})

test('失效问题与跨会话请求不能继续执行', t => {
  const { store } = fixture(t)
  const first = start(store, { message: '美化照片' })
  store.pause(first, requiredQuestions(first))
  first.release()
  assert.throws(() => store.begin({ conversationId: first.record.conversationId, requestId: randomUUID(), clarificationAnswer: { id: randomUUID(), answers: { source_image: '已上传' } } }, { message: '已上传' }, new AbortController()), /已失效/)
  assert.throws(() => store.get('../outside'), /会话标识/)
})

test('新选区必须确认，用户明确选择后才替换原目标', t => {
  const { store } = fixture(t)
  const turn = start(store, { message: '把标题改成红色', selection })
  const ask = store.pause(turn, [{ id: 'color_style', label: '是否使用品牌红？', required: true }])
  turn.release()
  const changed = { ...selection, fileKey: 'different-file', revision: 2 }
  const next = store.begin({ conversationId: turn.record.conversationId, requestId: randomUUID(), clarificationAnswer: { id: ask.id, answers: { color_style: '是' } } }, { message: '是', selection: changed }, new AbortController())
  assert.equal(next.input.selection?.fileKey, 'mock-file')
  const target = store.pause(next, requiredQuestions(next))
  assert.equal(target.questions[0].id, 'target_confirmation')
  next.release()
  const resumed = store.begin({ conversationId: turn.record.conversationId, requestId: randomUUID(), clarificationAnswer: { id: target.id, answers: { target_confirmation: '使用新选区' } } }, { message: '使用新选区', selection: changed }, new AbortController())
  assert.equal(executionInput(resumed.record).selection?.fileKey, 'different-file')
  resumed.release()
})

test('模型预检必须是自洽JSON，普通问句、工具产物与矛盾状态不能变为ready', () => {
  assert.deepEqual(parseAssessment('{"ready":true,"questions":[]}'), { ready: true, questions: [] })
  assert.throws(() => parseAssessment('可以开始执行了'), /有效结构/)
  assert.throws(() => parseAssessment('{"ready":true,"questions":[{"id":"color","label":"什么颜色"}]}'), /状态矛盾/)
  assert.throws(() => parseAssessment('{"ready":false,"questions":[]}'), /状态矛盾/)
  assert.throws(() => parseAssessment('{"ready":false,"questions":[{"id":"../bad","label":"缺什么"}]}'), /格式无效/)
})

test('取消会中止当前执行，且取消后不能被完成回调覆盖', t => {
  const { store } = fixture(t)
  const controller = new AbortController()
  const turn = store.begin({ requestId: randomUUID() }, { message: '只读检查' }, controller)
  store.running(turn)
  assert.equal(store.cancel(turn.record.conversationId).status, 'cancelled')
  assert.equal(controller.signal.aborted, true)
  store.finish(turn, 'completed')
  assert.equal(store.get(turn.record.conversationId).status, 'cancelled')
  turn.release()
})

test('上次进程中断不会自动重放工具；新任务清除原澄清上下文', t => {
  const { store, directory } = fixture(t)
  const turn = start(store, { message: '原始任务', selection })
  store.running(turn)
  const restored = createConversationStore(directory)
  assert.equal(restored.get(turn.record.conversationId).status, 'failed')
  turn.release()
  const next = restored.begin({ conversationId: turn.record.conversationId, requestId: randomUUID(), newTask: true }, { message: '全新的任务' }, new AbortController())
  assert.notEqual(next.record.taskId, turn.record.taskId)
  assert.equal(next.input.selection, undefined)
  assert.doesNotMatch(JSON.stringify(next.input.history), /原始任务/)
  next.release()
})


test('咨询解释不强制索要素材，明确要求随后执行时仍检查必需输入', t => {
  const { store } = fixture(t)
  for (const text of ['解释如何把 Figma 图层改成红色', '资源位延展是什么', '如何把标题改成红色']) {
    const turn = start(store, { message: text })
    assert.deepEqual(requiredQuestions(turn), [])
    turn.release()
  }
  const execute = start(store, { message: '解释如何把 Figma 图层改成红色，并帮我执行修改' })
  assert.equal(requiredQuestions(execute)[0].id, 'target')
  execute.release()
})

test('海报准备表单已传模板附件及人物JSON时不重复索要同一信息', t => {
  const { store } = fixture(t)
  const turn = start(store, { message: '请准备单人海报延展任务。先核对输入、图片服务和 Figma Bridge 成图导入能力。\n' + JSON.stringify({ template: '/mock-upload/template.png', records: [{ nickname: '主播A', referenceImages: ['/mock-upload/template.png', '/mock-upload/person.png'] }] }),
    skill: 'person-poster-extension', attachments: [{ id: 'template', name: 'template.png', kind: 'image', mime: 'image/png', size: 42, path: '/mock-upload/template.png' }] })
  assert.deepEqual(requiredQuestions(turn), [])
  turn.release()
})

test('选区确认只批准提出问题时的目标，再次变化必须重新确认', t => {
  const { store } = fixture(t)
  const first = start(store, { message: '把标题改红', selection })
  const initial = store.pause(first, [{ id: 'detail', label: '还有要求吗？', required: true }])
  first.release()
  const selectedA = { ...selection, revision: 2 }
  const changed = store.begin({ conversationId: first.record.conversationId, requestId: randomUUID(), clarificationAnswer: { id: initial.id, answers: { detail: '无' } } }, { message: '无', selection: selectedA }, new AbortController())
  const confirm = store.pause(changed, requiredQuestions(changed))
  changed.release()
  const selectedB = { ...selection, revision: 3 }
  const stale = store.begin({ conversationId: first.record.conversationId, requestId: randomUUID(), clarificationAnswer: { id: confirm.id, answers: { target_confirmation: '使用新选区' } } }, { message: '使用新选区', selection: selectedB }, new AbortController())
  assert.equal(executionInput(stale.record).selection?.revision, 1)
  assert.equal(requiredQuestions(stale)[0].id, 'target_confirmation')
  const repeated = store.pause(stale, requiredQuestions(stale))
  stale.release()
  const approved = store.begin({ conversationId: first.record.conversationId, requestId: randomUUID(), clarificationAnswer: { id: repeated.id, answers: { target_confirmation: '使用新选区' } } }, { message: '使用新选区', selection: selectedB }, new AbortController())
  assert.equal(executionInput(approved.record).selection?.revision, 3)
  store.ready(approved)
  approved.release()
  const later = store.begin({ conversationId: first.record.conversationId, requestId: randomUUID() }, { message: '继续', selection: { ...selection, revision: 4 } }, new AbortController())
  assert.equal(requiredQuestions(later)[0].id, 'target_confirmation')
  assert.equal(executionInput(later.record).selection?.revision, 3)
  later.release()
})
