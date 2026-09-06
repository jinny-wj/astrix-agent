import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { yieldSelectionContext } from './figmaSkills'
import { skillBody } from './skills'
import { buildStudioUserPrompt } from './studioPrompt'
import type { AgentRunInput, AgentRuntime, AgentUiMessage } from './types'
import { childEnv } from './whichBin'

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function itemType(item: Record<string, unknown>) {
  return typeof item.type === 'string'
    ? item.type
    : typeof item.item_type === 'string'
      ? item.item_type
      : ''
}

export function createCodexRuntime(options: {
  bin: string
  model: string
  cwd: string
}): AgentRuntime {
  return {
    meta: {
      mode: 'codex',
      model: options.model || 'auto',
      shell: false,
      backend: 'codex-cli',
    },
    async *run(input: AgentRunInput): AsyncGenerator<AgentUiMessage> {
      const { skill, refs, prompt } = buildStudioUserPrompt(input)
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

      const args = [
        'exec',
        '--ephemeral',
        '--json',
        '--skip-git-repo-check',
        '--sandbox',
        'read-only',
        '-C',
        options.cwd,
      ]
      const model = input.model || options.model
      if (model && model !== 'auto' && model !== 'haiku') {
        args.push('-m', model)
      }
      args.push('-')

      const child = spawn(options.bin, args, {
        cwd: options.cwd,
        env: childEnv(),
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      child.stdin.write(prompt)
      child.stdin.end()

      const onAbort = () => {
        if (!child.killed) child.kill('SIGTERM')
      }
      input.signal?.addEventListener('abort', onAbort, { once: true })

      const stderrChunks: string[] = []
      child.stderr.on('data', (chunk: Buffer) => {
        stderrChunks.push(chunk.toString('utf8'))
      })

      const lines = createInterface({ input: child.stdout })
      let emittedResponse = false
      try {
        for await (const line of lines) {
          if (input.signal?.aborted) break
          const trimmed = line.trim()
          if (!trimmed.startsWith('{')) continue
          let parsed: unknown
          try {
            parsed = JSON.parse(trimmed)
          } catch {
            continue
          }
          const event = asRecord(parsed)
          if (!event || typeof event.type !== 'string') continue
          const item = asRecord(event.item)
          if (
            (event.type === 'item.started' || event.type === 'item.updated' || event.type === 'item.completed')
            && item
          ) {
            const kind = itemType(item)
            const id = typeof item.id === 'string' ? item.id : makeId('codex')
            if (kind === 'command_execution' || kind === 'mcp_tool_call') {
              const command = typeof item.command === 'string'
                ? item.command
                : typeof item.tool === 'string'
                  ? item.tool
                  : 'tool'
              yield {
                id,
                kind: 'tool',
                provider: 'Codex',
                tool: kind === 'mcp_tool_call' ? 'MCP' : 'Shell',
                action: command.slice(0, 120),
                status: event.type === 'item.completed'
                  ? item.status === 'failed'
                    || (typeof item.exit_code === 'number' && item.exit_code !== 0)
                    ? 'error'
                    : 'success'
                  : 'running',
              }
              continue
            }
            if (
              (kind === 'agent_message' || kind === 'assistant_message')
              && event.type === 'item.completed'
              && typeof item.text === 'string'
              && item.text.trim()
            ) {
              emittedResponse = true
              yield {
                id,
                kind: 'text',
                text: item.text.trim(),
              }
            }
          }
          if (event.type === 'error') {
            const message = typeof event.message === 'string'
              ? event.message
              : 'Codex 执行失败'
            throw new Error(message)
          }
          if (event.type === 'turn.failed') {
            const error = asRecord(event.error)
            throw new Error(
              typeof error?.message === 'string' ? error.message : 'Codex 本轮失败',
            )
          }
        }
      } finally {
        input.signal?.removeEventListener('abort', onAbort)
        lines.close()
      }

      const exitCode: number = await new Promise((resolve, reject) => {
        child.once('error', reject)
        child.once('close', (code) => resolve(code ?? 1))
      })
      if (exitCode !== 0 && !input.signal?.aborted) {
        const detail = stderrChunks.join('').trim().slice(0, 400)
        throw new Error(detail || `Codex 退出码 ${exitCode}`)
      }
      if (!input.signal?.aborted && !emittedResponse) {
        throw new Error('Codex 未返回可用内容')
      }
    },
  }
}
