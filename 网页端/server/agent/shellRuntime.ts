import { yieldSelectionContext } from './figmaSkills'
import { pickSkill, skillBody } from './skills'
import type { AgentRunInput, AgentRuntime, AgentUiMessage } from './types'

async function* localOrchestrator(
  input: AgentRunInput,
): AsyncGenerator<AgentUiMessage> {
  const skill = pickSkill(input.message, input.skill)
  if (input.emitRequestContext !== false) {
    yield { id: `m-${Date.now()}-user`, kind: 'user', text: input.message }
    yield {
      id: `m-${Date.now()}-skill`,
      kind: 'skill',
      name: skill,
      body: skillBody(skill),
    }
    yield* yieldSelectionContext(input.selection)
  }
  yield {
    id: `m-${Date.now()}-notice`,
    kind: 'text',
    text:
      '当前是显式开启的演示模式，不会调用 Codex / Claude / Hermes，也不会生成真实物料。'
      + '请在设置里确认已登录真实 Agent，或把 AGENT_BACKEND 设为 auto 后重试。',
  }
}

export function createShellRuntime(): AgentRuntime {
  return {
    meta: {
      mode: 'local',
      model: 'local-shell',
      shell: true,
      backend: 'local-shell',
    },
    async *run(input: AgentRunInput) {
      yield* localOrchestrator(input)
    },
  }
}

