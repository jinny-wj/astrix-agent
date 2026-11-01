import { useState } from 'react'
import type { Message } from '../../../data/agentScript'
import type { ClarificationAnswer } from '../../../types/agentConversation'
import { hasRequiredAnswers } from '../../../services/agentConversation'

export default function ClarificationCard({ message, active, disabled, onAnswer }: {
  message: Extract<Message, { kind: 'clarification' }>
  active: boolean
  disabled: boolean
  onAnswer: (answer: ClarificationAnswer) => void
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({})
  return (
    <form
      className={`rounded-[12px] border p-[12px] ${active ? 'border-[#c9cff9] bg-[#f5f5ff]' : 'border-[#e7e8ee] bg-[#fafafa]'}`}
      onSubmit={event => {
        event.preventDefault()
        if (active && !disabled && hasRequiredAnswers(message.questions, answers)) onAnswer({ id: message.id, answers })
      }}
    >
      <p className="text-[13px] font-semibold text-[#454c7d]">{active ? '补充信息后继续原任务' : '历史追问'}</p>
      {active && <p className="mt-[4px] text-[11.5px] leading-relaxed text-[#73778b]">任务已暂停。原需求、附件和目标图层已保留，也可以在下方输入框直接回答。</p>}
      <div className="mt-[10px] space-y-[10px]">
        {message.questions.map((question, index) => (
          <label key={question.id} className="block text-[12px] text-[#464953]">
            <span className="mb-[5px] block">{index + 1}. {question.label}{question.required ? ' *' : ''}</span>
            {active && (
              <>
                {question.options?.length ? (
                  <div className="mb-[5px] flex flex-wrap gap-[4px]">
                    {question.options.map(option => <button
                      key={option} type="button" disabled={disabled}
                      className="rounded-[6px] border border-[#d9dcef] bg-white px-[7px] py-[4px] text-[11.5px] hover:bg-[#eeeeff] disabled:opacity-50"
                      onClick={() => setAnswers(current => ({ ...current, [question.id]: option }))}
                    >{option}</button>)}
                  </div>
                ) : null}
                <textarea
                  aria-label={question.label} required={question.required}
                  maxLength={4000} rows={2} disabled={disabled}
                  value={answers[question.id] ?? ''}
                  onChange={event => setAnswers(current => ({ ...current, [question.id]: event.target.value }))}
                  className="w-full resize-y rounded-[7px] border border-[#d9dcef] bg-white px-[9px] py-[7px] text-[12px] outline-none focus:border-[#777dda] disabled:opacity-50"
                  placeholder="填写你的要求，或选择上方选项"
                />
              </>
            )}
          </label>
        ))}
      </div>
      {active && <button
        type="submit" disabled={disabled || !hasRequiredAnswers(message.questions, answers)}
        className="mt-[10px] rounded-[7px] bg-[#6765d8] px-[11px] py-[7px] text-[12px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
      >提交补充，继续原任务</button>}
    </form>
  )
}
