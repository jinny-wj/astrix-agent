import { composerPromptBlock } from './composer'
import { inferRefs, pickSkill } from './skills'
import { selectionPromptBlock } from './figmaSkills'
import type { AgentRunInput } from './types'

export const DESIGN_SYSTEM_PROMPT = `你是 Design Studio WJ 的设计协作 Agent。

当前主要处理：一键美化主播照片、资源位延展、人物战报、可编辑视觉稿和 Figma 图层修改。
用户在 Figma 里点选的图层会出现在请求里；请针对这些图层给可执行方案。

输出规则：
1. 用简洁中文回复。预选了且仓库内存在对应文件时，先 Read 对应的 skills/<name>/SKILL.md；不得读取不存在的 skill 路径。
2. 人物战报必须展示模板缩略图（Markdown 图片），按用户编号继续；生成流程见 skills/battle-report/SKILL.md。
3. 一键美化必须保脸：可换衣服/背景/光影，不能换脸。
4. 资源位延展先确认规格，再给出 2-3 套方案要点（构图/主色/标题层级/导出注意）。
5. 不要修改仓库文件，不要安装依赖。不要向用户透露 API、token、内部 URL。
6. Figma OAuth 只能读取图层，不能直接改画布节点。不要假装已经写回 Figma 原文件；给出明确改法和文案即可。
7. 用户提到定时、轮询、持续跟进时，遵循 skills/loop/SKILL.md（Codex 官方 loop）。
8. 用户提到 Hermes、跨会话记忆、定时网关时，遵循 skills/hermes/SKILL.md。
9. 结尾用简短清单总结下一步。`

export function buildStudioUserPrompt(input: AgentRunInput) {
  const skill = pickSkill(input.message, input.skill)
  const refs = skill === 'kv-resource-extension' ? inferRefs(input.message) : []
  const extraRefs = [
    ...(input.attachments ?? []).map((item) => ({
      name: item.name,
      size: item.kind,
      output: item.mime,
    })),
    ...(input.contextRefs ?? []).map((item) => ({
      name: item.label,
      size: item.kind,
      output: item.detail ?? item.skill ?? '',
    })),
  ]
  const layerBlock = selectionPromptBlock(input.selection)
  const composerBlock = composerPromptBlock({
    instructions: input.instructions,
    contextRefs: input.contextRefs,
    attachments: input.attachments,
    cwd: input.cwd,
  })
  const prompt =
    `${DESIGN_SYSTEM_PROMPT}\n\n`
    + `用户请求：${input.message}\n`
    + `预选 Skill：${skill}\n`
    + `相关规格：${refs.map((ref) => `${ref.name} ${ref.size}`).join('；') || '无'}\n`
    + (layerBlock ? `${layerBlock}\n` : '')
    + (composerBlock ? `${composerBlock}\n` : '')
    + `请开始处理。`
  return { skill, refs: [...refs, ...extraRefs], prompt }
}
