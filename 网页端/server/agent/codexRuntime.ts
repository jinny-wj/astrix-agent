import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { yieldSelectionContext } from './figmaSkills'
import { skillBody } from './skills'
import { buildStudioUserPrompt } from './studioPrompt'
import type { AgentRunInput, AgentRuntime, AgentUiMessage } from './types'
import { codexChildEnv, getCodexCliStatus, isCodexModelUnavailable, resolveCodexModel } from '../../../网页端/workbench/server/codex-cli.mjs'
import type { CodexCliStatus } from '../../../网页端/workbench/server/codex-cli.mjs'

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
  probeStatus?: (options: { bin: string; signal?: AbortSignal }) => Promise<CodexCliStatus>
  probeModel?: (options: { bin: string; signal?: AbortSignal; model?: string }) => Promise<string>
}): AgentRuntime {
  return {
    meta: {
      mode: 'codex',
      model: options.model || 'auto',
      shell: false,
      backend: 'codex-cli',
    },
    async *run(input: AgentRunInput): AsyncGenerator<AgentUiMessage> {
      input.signal?.throwIfAborted()
      const status = await (options.probeStatus ?? getCodexCliStatus)({ bin: options.bin, signal: input.signal })
      if (!status.ready) throw new Error(status.message)
      // Reuse only the local model identifier. Provider, API routes and all
      // other user configuration remain ignored by this ChatGPT-only process.
      const model = await (options.probeModel ?? resolveCodexModel)({
        bin: options.bin, signal: input.signal,
        model: options.model && !['auto', 'haiku'].includes(options.model) ? options.model : '',
      })
      input.signal?.throwIfAborted()
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
        '--ignore-user-config',
        '--config', 'model_provider="openai"',
        '--config', 'forced_login_method="chatgpt"',
        '--ephemeral',
        '--json',
        '--skip-git-repo-check',
        '--sandbox',
        'read-only',
        '-C',
        options.cwd,
      ]
      if (input.phase === 'assess') {
        args.push('--config', 'mcp_servers={}', '--config', 'web_search="disabled"')
        for (const feature of ['shell_tool', 'unified_exec', 'apps', 'plugins', 'hooks', 'multi_agent', 'browser_use', 'browser_use_external', 'computer_use', 'image_generation']) args.push('--disable', feature)
      }
      // Generic/API model selector IDs are never used to choose Codex's model.
      if (model) {
        args.push('-m', model)
      }
      args.push('-')

      const child = spawn(options.bin, args, {
        cwd: options.cwd,
        env: codexChildEnv(),
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      // Register process completion before consuming stdout: a fast process can
      // close before readline's async iterator has drained its last event.
      let processError: Error | undefined
      let timedOut = false
      let outputBytes = 0
      let stderr = ''
      let terminationTimer: ReturnType<typeof setTimeout> | undefined
      const exited = new Promise<number>((resolve) => {
        child.once('error', () => { processError = new Error('无法启动本机 Codex，请检查 CLI 安装。'); resolve(1) })
        child.once('close', code => resolve(code ?? 1))
      })
      const stop = () => {
        if (!child.pid || child.exitCode !== null || child.signalCode !== null) return
        child.kill('SIGTERM')
        if (!terminationTimer) {
          terminationTimer = setTimeout(() => {
            if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
          }, 1000)
          terminationTimer.unref()
        }
      }
      const timeout = setTimeout(() => { timedOut = true; stop() }, 180_000)
      const onAbort = stop
      input.signal?.addEventListener('abort', onAbort, { once: true })
      if (input.signal?.aborted) stop()
      child.stdin.on('error', () => { /* Process failure is handled by exited. */ })
      child.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString('utf8')).slice(-8000) })
      child.stdin.end(prompt)

      const lines = createInterface({ input: child.stdout })
      let emittedResponse = false
      try {
        for await (const line of lines) {
          if (input.signal?.aborted) break
          outputBytes += Buffer.byteLength(line, 'utf8')
          if (outputBytes > 4 * 1024 * 1024) throw new Error('Codex 本轮输出过长，请缩小任务后重试。')
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
            throw new Error(publicCodexFailure(message))
          }
          if (event.type === 'turn.failed') {
            const error = asRecord(event.error)
            throw new Error(publicCodexFailure(typeof error?.message === 'string' ? error.message : ''))
          }
        }
        const exitCode = await exited
        input.signal?.throwIfAborted()
        if (timedOut) throw new Error('本机 Codex 请求超时，请稍后重试。')
        if (processError) throw processError
        if (exitCode !== 0) throw new Error(publicCodexFailure(stderr))
        if (!emittedResponse) throw new Error('Codex 未返回可用内容')
      } catch (error) {
        stop()
        await exited
        throw error
      } finally {
        input.signal?.removeEventListener('abort', onAbort)
        clearTimeout(timeout)
        lines.close()
        // Also stop the child if the consumer closes this async generator early.
        stop()
        await exited
        if (terminationTimer) clearTimeout(terminationTimer)
      }
    },
  }
}

function publicCodexFailure(detail: string): string {
  if (/usage limit|quota|rate.?limit|exhausted/i.test(detail)) return '本机 Codex 账号额度暂不可用，请查看 Codex 用量后重试；不会自动改用 API。'
  if (/login|logged in|auth|credential|unauthorized|401/i.test(detail)) return '本机 Codex 登录不可用，请在终端运行 codex login，使用 ChatGPT 账号登录。'
  if (isCodexModelUnavailable(detail)) return '当前 ChatGPT 账号无法使用此 Codex 模型。请在工作台 AI 连接中指定账号可用的 Codex 模型，或检查账号权限；不会自动使用其他模型或 API。'
  return '本机 Codex 执行失败，请检查 CLI 登录与当前账号可用性后重试。'
}
