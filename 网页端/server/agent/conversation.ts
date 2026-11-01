import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentRunInput, AgentUiMessage } from './types.ts'
import { pickSkill } from './skills.ts'
import { ambiguousTitleColor, isReadOnlyConsultation } from './clarificationPolicy.ts'

export type ClarificationQuestion = { id: string; label: string; required: true; options?: string[] }
export type ConversationStatus = 'idle' | 'ready' | 'assessing' | 'awaiting_user' | 'running' | 'completed' | 'failed' | 'cancelled'
export type PendingClarification = { id: string; taskId: string; questions: ClarificationQuestion[] }
export type ConversationSnapshot = {
  conversationId: string
  taskId: string
  status: ConversationStatus
  originalRequest: string
  messages: AgentUiMessage[]
  pending?: PendingClarification
  updatedAt: string
  error?: string
}
type SavedInput = Omit<AgentRunInput, 'signal' | 'history' | 'phase' | 'emitRequestContext'>
type SavedConversation = ConversationSnapshot & {
  context: SavedInput
  answers: Record<string, string>
  answerLabels: Record<string, string>
  history: Array<{ role: 'user' | 'assistant'; content: string }>
  processedRequests: string[]
  currentRequestId?: string
  proposedSelection?: AgentRunInput['selection']
}
export type ConversationRequest = {
  conversationId?: unknown
  requestId?: unknown
  newTask?: unknown
  clarificationAnswer?: unknown
}
export type ConversationTurn = {
  record: SavedConversation
  input: AgentRunInput
  requestId: string
  replay: boolean
  release: () => void
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const fault = (message: string, status = 409) => Object.assign(new Error(message), { status })
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))
const clone = <T>(value: T): T => structuredClone(value)
const question = (id: string, label: string, options?: string[]): ClarificationQuestion => ({ id, label, required: true, ...(options ? { options } : {}) })

function selectionIdentity(selection: AgentRunInput['selection']) {
  return selection ? JSON.stringify([selection.fileKey, selection.sessionId, selection.pageId, selection.revision, selection.nodes.map(node => node.id).sort()]) : ''
}

function mergeById<T extends { id: string }>(previous: T[] = [], next: T[] = [], max = 20) {
  const values = new Map(previous.map(value => [value.id, value]))
  for (const value of next) values.set(value.id, value)
  return [...values.values()].slice(-max)
}

/** Application-owned conversations survive ephemeral model processes and server restarts. */
export function createConversationStore(directory: string) {
  const active = new Map<string, AbortController>()
  const cache = new Map<string, SavedConversation>()
  const requests = new Map<string, string>()
  try {
    const entries = JSON.parse(readFileSync(join(directory, 'request-index.json'), 'utf8')) as Array<[string, string]>
    for (const [requestId, conversationId] of entries) if (uuid.test(requestId) && uuid.test(conversationId)) requests.set(requestId, conversationId)
  } catch { /* A first run has no index. */ }
  const indexRequest = (requestId: string, conversationId: string) => {
    requests.set(requestId, conversationId)
    while (requests.size > 5_000) requests.delete(requests.keys().next().value!)
    const target = join(directory, 'request-index.json')
    const temporary = `${target}.${randomUUID()}.tmp`
    writeFileSync(temporary, JSON.stringify([...requests]), { mode: 0o600 })
    renameSync(temporary, target)
  }
  const path = (id: string) => {
    if (!uuid.test(id)) throw fault('会话标识无效', 400)
    return join(directory, `${id}.json`)
  }
  const save = (item: SavedConversation) => {
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    item.updatedAt = new Date().toISOString()
    const target = path(item.conversationId)
    const temporary = `${target}.${randomUUID()}.tmp`
    writeFileSync(temporary, JSON.stringify(item), { mode: 0o600 })
    renameSync(temporary, target)
    cache.set(item.conversationId, item)
  }
  const get = (id: string) => {
    const cached = cache.get(id)
    if (cached) return cached
    let item: SavedConversation
    try { item = JSON.parse(readFileSync(path(id), 'utf8')) as SavedConversation } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw fault('未找到该会话，请新建会话', 404)
      throw error
    }
    if (item.conversationId !== id || !Array.isArray(item.messages) || !item.context) throw fault('会话记录无法读取', 409)
    // A stopped process must never silently replay a possibly completed tool action.
    if (item.status === 'running' || item.status === 'assessing') {
      item.status = 'failed'
      item.error = '上次运行已中断，任务上下文已保留；请确认实际结果后重试。'
      save(item)
    }
    cache.set(id, item)
    return item
  }
  const snapshot = (item: SavedConversation): ConversationSnapshot => clone({
    conversationId: item.conversationId, taskId: item.taskId, status: item.status,
    originalRequest: item.originalRequest, messages: item.messages, pending: item.pending,
    updatedAt: item.updatedAt, ...(item.error ? { error: item.error } : {}),
  })
  const append = (item: SavedConversation, message: AgentUiMessage) => {
    const index = item.messages.findIndex(existing => existing.id === message.id)
    if (index >= 0) item.messages[index] = clone(message)
    else item.messages.push(clone(message))
    item.messages = item.messages.slice(-200)
    save(item)
  }
  const begin = (request: ConversationRequest, input: AgentRunInput, controller: AbortController): ConversationTurn => {
    if (request.conversationId !== undefined && (typeof request.conversationId !== 'string' || !uuid.test(request.conversationId))) throw fault('会话标识无效', 400)
    if (request.requestId !== undefined && (typeof request.requestId !== 'string' || !uuid.test(request.requestId))) throw fault('请求标识无效', 400)
    const requestId = typeof request.requestId === 'string' ? request.requestId : randomUUID()
    const indexed = requests.get(requestId)
    const id = typeof request.conversationId === 'string' ? request.conversationId : indexed || randomUUID()
    if (indexed && indexed !== id) throw fault('该请求标识已属于另一个会话', 409)
    let item: SavedConversation
    if (request.conversationId || indexed) item = clone(get(id))
    else item = { conversationId: id, taskId: randomUUID(), status: 'idle', originalRequest: input.message, messages: [], context: { message: input.message }, answers: {}, answerLabels: {}, history: [], processedRequests: [], updatedAt: new Date().toISOString() } as SavedConversation
    if (item.processedRequests.includes(requestId) || item.currentRequestId === requestId) return { record: item, input, requestId, replay: true, release() {} }
    if (active.has(id)) throw fault('该会话正在处理上一条消息，请稍后重试')
    if (item.status === 'cancelled' && request.newTask !== true) throw fault('该任务已取消，请新建任务')
    const hasPending = item.status === 'awaiting_user' && item.pending
    const supplied = request.clarificationAnswer
    if (supplied !== undefined && (!record(supplied) || typeof supplied.id !== 'string' || !record(supplied.answers))) throw fault('澄清回答格式无效', 400)
    if (record(supplied) && (!hasPending || supplied.id !== item.pending?.id)) throw fault('这组澄清问题已失效，请刷新会话后回答')
    if (request.newTask === true || item.status === 'completed' || !item.context.skill) {
      const previous: Partial<SavedInput> = request.newTask === true ? {} : item.context
      item.taskId = randomUUID()
      item.originalRequest = input.message
      item.answers = {}
      item.answerLabels = {}
      item.pending = undefined
      item.context = { ...previous, ...input, signal: undefined, history: undefined, phase: undefined, emitRequestContext: undefined } as SavedInput
      if (request.newTask === true) item.history = []
      else {
        item.context.selection = input.selection ?? previous.selection
        item.context.attachments = mergeById(previous.attachments, input.attachments, 8)
        item.context.contextRefs = mergeById(previous.contextRefs, input.contextRefs)
        item.context.instructions = mergeById(previous.instructions, input.instructions, 12)
      }
      item.context.skill = pickSkill(input.message, input.skill)
    } else {
      item.context.attachments = mergeById(item.context.attachments, input.attachments, 8)
      item.context.contextRefs = mergeById(item.context.contextRefs, input.contextRefs)
      item.context.instructions = mergeById(item.context.instructions, input.instructions, 12)
      item.context.model = input.model ?? item.context.model
      item.context.backend = input.backend ?? item.context.backend
      if (hasPending) {
        const answers = record(supplied) ? supplied.answers as Record<string, unknown> : {}
        const questions = item.pending!.questions
        for (const [key, value] of Object.entries(answers)) {
          if (!questions.some(q => q.id === key) || typeof value !== 'string' || !value.trim() || value.length > 8_000) throw fault('请回答当前澄清问题', 400)
          item.answers[key] = value.trim()
          item.answerLabels[key] = questions.find(q => q.id === key)!.label
        }
        if (!Object.keys(answers).length) {
          if (questions.length === 1) {
            item.answers[questions[0].id] = input.message
            item.answerLabels[questions[0].id] = questions[0].label
          } else {
            for (const q of questions) {
              if (/都保持|全部保持|均不变/.test(input.message) || q.id === 'activity_date' && /日期|时间/.test(input.message) || q.id === 'activity_name' && /活动名|名称/.test(input.message) || q.id === 'season_text' && /Spring|Summer|Autumn|Winter|季节|字样/i.test(input.message)) {
                item.answers[q.id] = input.message
                item.answerLabels[q.id] = q.label
              }
            }
          }
        }
      }
      const previousProposal = item.proposedSelection
      const obsoleteTargetAnswer = previousProposal && input.selection
        && selectionIdentity(previousProposal) !== selectionIdentity(input.selection)
        && Boolean(item.answers.target_confirmation)
      if (obsoleteTargetAnswer) {
        delete item.answers.target_confirmation
        delete item.answerLabels.target_confirmation
      }
      if (input.selection && selectionIdentity(input.selection) !== selectionIdentity(item.context.selection)) {
        if (!item.context.selection?.nodes.length) item.context.selection = clone(input.selection)
        else item.proposedSelection = clone(input.selection)
      }
      if (item.answers.target_confirmation && item.proposedSelection) {
        if (/使用新选区|使用当前|改用新|当前选区/.test(item.answers.target_confirmation)) item.context.selection = item.proposedSelection
        item.proposedSelection = undefined
        delete item.answers.target_confirmation
        delete item.answerLabels.target_confirmation
      }
      item.history.push({ role: 'user', content: input.message.slice(0, 20_000) })
    }
    item.status = 'assessing'
    item.currentRequestId = requestId
    item.error = undefined
    append(item, { id: `user-${requestId}`, kind: 'user', text: input.message })
    if (item.history.at(-1)?.content !== input.message) item.history.push({ role: 'user', content: input.message.slice(0, 20_000) })
    item.history = item.history.slice(-40)
    active.set(id, controller)
    save(item)
    indexRequest(requestId, id)
    return { record: item, input: executionInput(item, controller.signal), requestId, replay: false, release: () => { if (active.get(id) === controller) active.delete(id) } }
  }
  const pause = (turn: ConversationTurn, questions: ClarificationQuestion[]) => {
    const item = turn.record
    item.status = 'awaiting_user'
    item.pending = { id: randomUUID(), taskId: item.taskId, questions }
    const message: AgentUiMessage = { id: item.pending.id, kind: 'clarification', taskId: item.taskId, questions, status: 'awaiting_user' }
    append(item, message)
    item.history.push({ role: 'assistant', content: questions.map(q => q.label).join('\n') })
    item.processedRequests = [...item.processedRequests, turn.requestId].slice(-100)
    save(item)
    return message
  }
  const finish = (turn: ConversationTurn, status: 'completed' | 'failed' | 'cancelled', error?: string) => {
    const item = turn.record
    if (item.status === 'cancelled' && status !== 'cancelled') return
    item.status = status
    item.error = error
    if (status === 'completed' || status === 'cancelled') item.pending = undefined
    item.processedRequests = [...item.processedRequests, turn.requestId].slice(-100)
    save(item)
  }
  return {
    get: (id: string) => snapshot(get(id)), snapshot, begin, pause, finish, append,
    ready(turn: ConversationTurn) { turn.record.status = 'ready'; turn.record.pending = undefined; turn.record.processedRequests = [...turn.record.processedRequests, turn.requestId].slice(-100); save(turn.record) },
    running(turn: ConversationTurn) { turn.record.status = 'running'; turn.record.pending = undefined; save(turn.record) },
    remember(turn: ConversationTurn, message: AgentUiMessage) {
      if (message.kind === 'user') return
      append(turn.record, message)
      if (message.kind === 'text') turn.record.history.push({ role: 'assistant', content: message.text.slice(0, 20_000) })
      save(turn.record)
    },
    cancel(id: string) {
      const item = get(id)
      active.get(id)?.abort()
      item.status = 'cancelled'
      item.pending = undefined
      save(item)
      return snapshot(item)
    },
  }
}

export function executionInput(item: SavedConversation, signal?: AbortSignal): AgentRunInput {
  const answers = Object.entries(item.answers).filter(([key]) => key !== 'target_confirmation').map(([key, value]) => `${item.answerLabels[key] || key}：${value}`)
  return { ...clone(item.context), message: item.originalRequest + (answers.length ? `\n\n用户已补充确认：\n${answers.join('\n')}` : ''), history: clone(item.history.slice(-40)), signal, emitRequestContext: false }
}

export function requiredQuestions(turn: ConversationTurn): ClarificationQuestion[] {
  const { record: item } = turn
  const input = executionInput(item)
  const text = input.message
  const selection = input.selection
  const skill = item.context.skill
  const questions: ClarificationQuestion[] = []
  if (isReadOnlyConsultation(item.originalRequest)) return []
  const hard = new Set(['template', 'source_image', 'source_kv', 'poster_template', 'people', 'target', 'color'])
  const add = (id: string, label: string, options?: string[]) => { if (hard.has(id) || !item.answers[id]) questions.push(question(id, label, options)) }
  if (item.proposedSelection) return [question('target_confirmation', '文件或选区已变化：这次继续原任务的目标，还是使用当前新选区？', ['继续原目标', '使用新选区'])]
  if (skill === 'battle-report') {
    if (!/\b(302[6-9]|303[0-5]|303[78]|000[1-8])\b/.test(text) && !input.attachments?.some(a => a.kind === 'image') && !selection?.nodes.length) add('template', '请选择战报模板编号，或提供要修改的模板图片／Figma 选区。')
    if (/季节|春季|夏季|秋季|冬季|主题|活动/.test(text) && /改|换|调整/.test(text)) {
      const nodeText = (selection?.nodes ?? []).map(n => n.characters || n.name).join('\n')
      if (/spring|summer|autumn|winter|春日|春季|夏季|秋季|冬季/i.test(nodeText)) add('season_text', '原稿中的季节字样需要改成什么，还是保持不变？')
      if (/活动|节|季/.test(nodeText)) add('activity_name', '原稿中的活动名称需要改成什么，还是保持不变？')
      if (/\d{1,2}[.月/-]\d{1,2}/.test(nodeText)) add('activity_date', '原稿中的活动日期保留，还是更新？更新时请提供日期。')
    }
  }
  if (skill === 'portrait-beautify' && !input.attachments?.some(a => a.kind === 'image') && !selection?.nodes.length) add('source_image', '请提供需要美化的人物原图，或在 Figma 中选择对应图片图层。')
  if (skill === 'kv-resource-extension' && !input.attachments?.some(a => a.kind === 'image') && !selection?.nodes.length) add('source_kv', '请提供源 KV／主视觉图片，或在 Figma 中选择要延展的画板。')
  if (skill === 'person-poster-extension') {
    if (!input.attachments?.some(a => a.kind === 'image') && !selection?.nodes.length) add('poster_template', '请提供完整的海报模板图片，或选择模板画板。')
    if (!input.attachments?.some(a => /人物表格解析|nickname|昵称/.test(a.text || '')) && !/records\s*[:：]|"records"|人物名单|昵称[:：]/.test(text)) add('people', '请提供人物表，或逐人填写完整昵称及对应的原始照片。')
  }
  if (ambiguousTitleColor(item.originalRequest)) add('edit_kind', '这里是修改标题文字的颜色，还是把文字内容替换成色名？', ['修改文字颜色', '替换文字内容'])
  if (['layer-edit', 'h5-edit', 'image-adjust'].includes(skill || '') && /改|换|调整|修改|设为|设置|调大|缩小|移动|删除/.test(item.originalRequest)) {
    if (!selection?.nodes.length && !input.attachments?.some(a => a.kind === 'text')) add('target', '请先选择要操作的 Figma 图层，或提供明确的目标文件。')
    if (/好看|优化一下|调整一下|改一下|美观/.test(item.originalRequest) && !/颜色|填充|字号|行高|间距|内边距|圆角|宽度|高度|文字|文本/.test(item.originalRequest) && !item.answers.change_details) add('change_details', '具体想改哪些内容？例如文字、颜色、字号、间距或尺寸，以及期望结果。')
    if (/改.{0,4}颜色|颜色.{0,4}改/.test(item.originalRequest) && !/#[a-f\d]{6}|红|橙|黄|绿|青|蓝|紫|黑|白|灰|粉/i.test(text)) add('color', '需要改成什么颜色？可以提供色名或十六进制色值。')
    if (/字号|行高|间距|内边距|圆角|宽度|高度/.test(item.originalRequest) && !/\d/.test(text)) {
      delete item.answers.value
      add('value', '请补充要设置的具体数值和单位。')
    }
  }
  return questions.slice(0, 8)
}

export const ASSESSMENT_RULES = `你只做需求完整性检查，不执行任务，不调用工具，不运行命令，不读取文件，不写入或修改 Figma。
根据原任务、已提供的上下文和用户补充，判断执行所必需的信息是否齐全。已有明确默认值或上下文的信息不要重复询问。
仅返回 JSON：信息齐全时 {"ready":true,"questions":[]}；缺关键信息时 {"ready":false,"questions":[{"id":"稳定的英文标识","label":"面向用户的具体问题","required":true,"options":["可选答案"]}]}。
最多8个问题，一次询问所有关键缺项。不能以建议、假设或工具调用代替用户对关键歧义的确认。`

export function parseAssessment(text: string): { ready: boolean; questions: ClarificationQuestion[] } {
  const raw = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  let result: unknown
  try { result = JSON.parse(raw) } catch { throw fault('需求检查未返回有效结构，任务未执行；请重试。') }
  if (!record(result) || typeof result.ready !== 'boolean' || !Array.isArray(result.questions) || result.questions.length > 8) throw fault('需求检查结果无效，任务未执行。')
  const seen = new Set<string>()
  const questions = result.questions.map((q: unknown) => {
    if (!record(q) || typeof q.id !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(q.id) || seen.has(q.id) || typeof q.label !== 'string' || !q.label.trim()) throw fault('需求检查问题格式无效，任务未执行。')
    seen.add(q.id)
    const options = Array.isArray(q.options) ? q.options.filter((v): v is string => typeof v === 'string' && v.length <= 500).slice(0, 8) : undefined
    return question(q.id, q.label.slice(0, 2_000), options)
  })
  if (result.ready !== (questions.length === 0)) throw fault('需求检查状态矛盾，任务未执行。')
  return { ready: result.ready, questions }
}
