import { parseFigmaCreateInstruction, parseFigmaInstruction } from '../figmaInstruction.ts'
import { colors, ambiguousTitleColor, isReadOnlyConsultation } from './clarificationPolicy.ts'
import type { ConversationTurn } from './conversation.ts'

function colorAnswer(value: string) {
  return new RegExp(`^(?:改成|改为|设为|设置为|用)?\\s*(${colors})[。！!\\s]*$`, 'i').exec(value.trim())?.[1]
}

/** Only complete, parser-validated commands reach Bridge; chat history stays model data. */
export function confirmedFigmaInstruction(turn: ConversationTurn): string | undefined {
  const item = turn.record
  const source = item.originalRequest.trim()
  const selection = item.context.selection
  if (!selection || isReadOnlyConsultation(source) || /吗[？?]?|[？?]|建议|要不要|能不能|是否/.test(source)) return undefined
  let instruction = source
  const color = colorAnswer(item.answers.color || '')
  if (color && /颜色|填充|色值/.test(source)) {
    // Missing color is a single property operation, not permission to drop other edits.
    if (/(?:并|同时|然后)|[；;]/.test(source)) return undefined
    instruction = `颜色改成${color}`
  }
  if (ambiguousTitleColor(source)) {
    const value = new RegExp(`(${colors})[。！!\\s]*$`, 'i').exec(source)?.[1]
    if (!value) return undefined
    if (/修改文字颜色|改颜色/.test(item.answers.edit_kind || '')) instruction = `颜色改成${value}`
    else if (/替换文字内容|改文字内容/.test(item.answers.edit_kind || '')) instruction = `文字改成「${value}」`
    else return undefined
  }
  if (item.answers.value) {
    const fields = source.match(/字号|行高|间距|内边距|圆角|宽度|高度/g) || []
    const value = /^(?:设为|改为|改成)?\s*(-?\d+(?:\.\d+)?)\s*(px|像素|%)?[。！!\s]*$/.exec(item.answers.value)
    if (fields.length === 1 && value && !/(?:并|同时|然后)|[；;]/.test(source)) instruction = `${fields[0]}设为${value[1]}${value[2] || 'px'}`
  }
  if (item.answers.change_details) {
    // A vague original task can be completed by an explicit property command.
    const details = item.answers.change_details.trim()
    if (/^(?:颜色|填充|字号|行高|间距|内边距|圆角|宽度|高度|文字|文本)/.test(details)
      && parseFigmaInstruction(details, selection).ok) instruction = details
  }
  if (parseFigmaInstruction(instruction, selection).ok || parseFigmaCreateInstruction(instruction).ok) return instruction
  return undefined
}
