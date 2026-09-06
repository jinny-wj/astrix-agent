import { query } from '@anthropic-ai/claude-agent-sdk'
import { yieldSelectionContext } from './figmaSkills'
import { skillBody } from './skills'
import { DESIGN_SYSTEM_PROMPT, buildStudioUserPrompt } from './studioPrompt'
import type { AgentRunInput, AgentRuntime, AgentUiMessage } from './types'

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    const record = asRecord(block)
    if (!record) continue
    if (record.type === 'text' && typeof record.text === 'string') {
      parts.push(record.text)
    }
  }
  return parts.join('\n').trim()
}

function extractToolUses(content: unknown): Array<{
  id: string
  name: string
  input: Record<string, unknown>
}> {
  if (!Array.isArray(content)) return []
  const tools: Array<{
    id: string
    name: string
    input: Record<string, unknown>
  }> = []
  for (const block of content) {
    const record = asRecord(block)
    if (!record || record.type !== 'tool_use') continue
    if (typeof record.id !== 'string' || typeof record.name !== 'string') continue
    tools.push({
      id: record.id,
      name: record.name,
      input: asRecord(record.input) ?? {},
    })
  }
  return tools
}

function extractToolResults(content: unknown): Array<{
  toolUseId: string
  isError: boolean
}> {
  if (!Array.isArray(content)) return []
  const results: Array<{ toolUseId: string; isError: boolean }> = []
  for (const block of content) {
    const record = asRecord(block)
    if (!record || record.type !== 'tool_result') continue
    if (typeof record.tool_use_id !== 'string') continue
    results.push({
      toolUseId: record.tool_use_id,
      isError: Boolean(record.is_error),
    })
  }
  return results
}

function summarizeToolAction(
  name: string,
  input: Record<string, unknown>,
): string {
  if (typeof input.file_path === 'string') return String(input.file_path)
  if (typeof input.path === 'string') return String(input.path)
  if (typeof input.pattern === 'string') return String(input.pattern)
  if (typeof input.query === 'string') return String(input.query)
  if (typeof input.command === 'string') return String(input.command).slice(0, 80)
  return name
}

export function createClaudeRuntime(options: {
  model: string
  cwd: string
}): AgentRuntime {
  return {
    meta: {
      mode: 'claude',
      model: options.model,
      shell: false,
      backend: 'claude-agent-sdk',
    },
    async *run(input: AgentRunInput): AsyncGenerator<AgentUiMessage> {
      const { skill, refs, prompt } = buildStudioUserPrompt(input)
      const toolUiIds = new Map<
        string,
        { uiId: string; name: string; action: string }
      >()
      let reads = 0
      let searches = 0
      let emittedCollected = false

      if (input.emitRequestContext !== false) {
        yield {
          id: makeId('user'),
          kind: 'user',
          text: input.message,
          refs,
        }
        yield {
          id: makeId('skill'),
          kind: 'skill',
          name: skill,
          body: skillBody(skill),
        }
        yield* yieldSelectionContext(input.selection)
      }

      const requestedModel = input.model || options.model
      const claudeModel = requestedModel && requestedModel !== 'auto'
        ? requestedModel
        : undefined

      const stream = query({
        prompt,
        options: {
          cwd: options.cwd,
          ...(claudeModel ? { model: claudeModel } : {}),
          settingSources: ['user'],
          systemPrompt: DESIGN_SYSTEM_PROMPT,
          allowedTools: ['Read', 'Grep', 'Glob', 'Bash'],
          disallowedTools: [
            'Write',
            'Edit',
            'MultiEdit',
            'NotebookEdit',
            'WebSearch',
            'WebFetch',
          ],
          permissionMode: 'bypassPermissions',
          allowDangerouslySkipPermissions: true,
          maxTurns: 6,
        },
      })

      let emittedResponse = false
      for await (const event of stream) {
        if (input.signal?.aborted) break
        const record = asRecord(event)
        if (!record || typeof record.type !== 'string') continue

        if (
          record.type === 'system'
          && record.subtype === 'api_retry'
          && (record.error === 'authentication_failed'
            || record.error_status === 401)
        ) {
          throw new Error(
            'Claude 未登录或登录已过期。请在终端执行 `claude login` 后重试。',
          )
        }

        if (record.type === 'assistant') {
          const message = asRecord(record.message)
          const content = message?.content
          const text = extractText(content)
          const tools = extractToolUses(content)

          for (const tool of tools) {
            const uiId = makeId('tool')
            const action = summarizeToolAction(tool.name, tool.input)
            toolUiIds.set(tool.id, { uiId, name: tool.name, action })
            if (tool.name === 'Read') reads += 1
            if (tool.name === 'Grep' || tool.name === 'Glob') searches += 1
            yield {
              id: uiId,
              kind: 'tool',
              provider: 'Claude',
              tool: tool.name,
              action,
              status: 'running',
            }
          }

          if (!emittedCollected && (reads > 0 || searches > 0)) {
            emittedCollected = true
            yield {
              id: makeId('collected'),
              kind: 'collected',
              read: Math.max(reads, 1),
              search: Math.max(searches, 0),
            }
          }

          if (text) {
            emittedResponse = true
            yield {
              id: makeId('text'),
              kind: 'text',
              text,
            }
          }
          continue
        }

        if (record.type === 'user') {
          const message = asRecord(record.message)
          for (const result of extractToolResults(message?.content)) {
            const tracked = toolUiIds.get(result.toolUseId)
            if (!tracked) continue
            yield {
              id: tracked.uiId,
              kind: 'tool',
              provider: 'Claude',
              tool: tracked.name,
              action: tracked.action,
              status: result.isError ? 'error' : 'success',
              note: result.isError ? '执行失败' : '已完成',
            }
          }
          continue
        }

        if (record.type === 'result') {
          if (record.is_error) {
            const detail =
              typeof record.result === 'string' && record.result
                ? record.result
                : typeof record.terminal_reason === 'string'
                  ? record.terminal_reason
                  : 'Claude Agent 执行失败'
            throw new Error(detail)
          }
          const resultText =
            typeof record.result === 'string'
              ? record.result.trim()
              : ''
          if (resultText && resultText.length > 0 && resultText.length < 800) {
            emittedResponse = true
            yield {
              id: makeId('text'),
              kind: 'text',
              text: resultText,
            }
          }
        }
      }

      if (!input.signal?.aborted && !emittedResponse) {
        throw new Error('Claude 未返回可用内容')
      }
    },
  }
}
