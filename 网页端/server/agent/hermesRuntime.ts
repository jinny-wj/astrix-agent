import { spawn } from 'node:child_process'
import { yieldSelectionContext } from './figmaSkills'
import { skillBody } from './skills'
import { buildStudioUserPrompt } from './studioPrompt'
import type { AgentRunInput, AgentRuntime, AgentUiMessage } from './types'
import { childEnv } from './whichBin'

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function createHermesRuntime(options: {
  bin: string
  model: string
  cwd: string
}): AgentRuntime {
  return {
    meta: {
      mode: 'hermes',
      model: options.model || 'auto',
      shell: false,
      backend: 'hermes-agent',
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

      const args = ['-z', prompt, '--in', options.cwd]
      const model = input.model || options.model
      if (model && model !== 'auto' && model !== 'haiku') {
        args.push('-m', model)
      }

      const child = spawn(options.bin, args, {
        cwd: options.cwd,
        env: childEnv(),
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      const onAbort = () => {
        if (!child.killed) child.kill('SIGTERM')
      }
      input.signal?.addEventListener('abort', onAbort, { once: true })

      const stderrChunks: string[] = []
      child.stderr.on('data', (chunk: Buffer) => {
        stderrChunks.push(chunk.toString('utf8'))
      })

      let buffer = ''
      const textId = makeId('text')
      for await (const chunk of child.stdout) {
        if (input.signal?.aborted) break
        buffer += chunk.toString('utf8')
      }
      const finalText = buffer.trim()
      if (/API call failed|usage limit|authentication failed|HTTP\s+(?:401|403|429|5\d\d)/i.test(finalText)) {
        throw new Error(finalText.slice(0, 400))
      }
      if (finalText) {
        yield { id: textId, kind: 'text', text: finalText }
      }

      const exitCode: number = await new Promise((resolve, reject) => {
        child.once('error', reject)
        child.once('close', (code) => resolve(code ?? 1))
      })
      input.signal?.removeEventListener('abort', onAbort)
      if (exitCode !== 0 && !input.signal?.aborted) {
        const detail = stderrChunks.join('').trim().slice(0, 400)
        throw new Error(detail || `Hermes 退出码 ${exitCode}`)
      }
    },
  }
}
