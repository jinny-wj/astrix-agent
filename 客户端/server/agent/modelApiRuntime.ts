import { randomUUID } from 'node:crypto'
import type { ModelApiConnectionResult, ModelApiSettings } from '../../src/types/modelApi.ts'
import { yieldSelectionContext } from './figmaSkills.ts'
import { skillBody } from './skills.ts'
import { buildStudioUserPrompt } from './studioPrompt.ts'
import type { AgentRuntime, AgentUiMessage } from './types.ts'
import { modelCompletion, normalizeModelBaseUrl } from '../../../网页端/workbench/server/model.mjs'

const CHAT_TIMEOUT_MS = 60_000
const TEST_TIMEOUT_MS = 15_000
const TEXT_ONLY_RULES = `当前连接仅支持文字交流。你只能使用本次请求中实际提供的文字和图层信息。
你不能直接读取本机文件、查看图片附件、执行命令或调用工具，也不能生成图片、写入文件或修改 Figma。
不要按照其他提示中的 Read、Shell、图像生成或写回步骤假装执行；没有真实结果时只能提供文字分析、方案或待执行指令，并明确说明能力限制。`

class ModelApiRequestError extends Error {}

function requestError(message: string) {
  return new ModelApiRequestError(message)
}

function connection(settings: ModelApiSettings) {
  try {
    const provider = settings.provider ?? 'openai'
    if (!['openai', 'anthropic', 'gemini'].includes(provider) || !settings.model.trim()) {
      throw new Error('Invalid configuration')
    }
    return { provider, baseUrl: normalizeModelBaseUrl(settings.baseUrl, provider), model: settings.model, apiKey: settings.apiKey }
  } catch {
    throw requestError('AI 模型 API 配置不完整，请检查服务地址、模型 ID 和 API Key。')
  }
}

function responseText(content: unknown) {
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  return content.flatMap((part: unknown) => {
    if (!part || typeof part !== 'object') return []
    const block = part as { type?: unknown; text?: unknown }
    return block.type === 'text' && typeof block.text === 'string' ? [block.text] : []
  }).join('\n').trim()
}

async function requestCompletion(
  settings: ModelApiSettings,
  messages: Array<{ role: 'system' | 'user'; content: string }>,
  timeoutMs: number,
  signal?: AbortSignal,
) {
  const config = connection(settings)
  const controller = new AbortController()
  let timedOut = false
  const onAbort = () => controller.abort()
  if (signal?.aborted) throw requestError('AI 模型请求已取消。')
  signal?.addEventListener('abort', onAbort, { once: true })
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  try {
    const result = await modelCompletion(config, messages, undefined, controller.signal)
    const text = responseText(result.content)
    if (!text) throw requestError('AI 模型服务未返回可用文本，请检查模型配置。')
    return text
  } catch (error) {
    if (signal?.aborted) throw requestError('AI 模型请求已取消。')
    if (timedOut) throw requestError('AI 模型服务请求超时，请稍后重试。')
    if (error instanceof ModelApiRequestError) throw error
    // Network/JSON errors and provider response bodies can contain credentials.
    throw requestError('AI 模型服务连接失败，请检查服务地址、授权和网络。')
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', onAbort)
  }
}

export function createModelApiRuntime(settings: ModelApiSettings): AgentRuntime {
  return {
    meta: { mode: 'remote', model: settings.model, shell: false, backend: 'model-api' },
    async *run(input): AsyncGenerator<AgentUiMessage> {
      if (!settings.enabled) throw requestError('请先启用并保存 AI 模型 API 配置。')
      const unsupportedAttachments = (input.attachments ?? []).filter((item) => item.kind !== 'text')
      const { skill, refs, prompt } = buildStudioUserPrompt({
        ...input,
        attachments: input.attachments?.map((item) => ({
          ...item,
          path: undefined,
          text: item.kind === 'text' ? item.text : undefined,
        })),
      })
      if (input.emitRequestContext !== false) {
        yield { id: randomUUID(), kind: 'user', text: input.message, refs }
        yield { id: randomUUID(), kind: 'skill', name: skill, body: skillBody(skill) }
        yield* yieldSelectionContext(input.selection)
      }
      if (unsupportedAttachments.length > 0) {
        yield {
          id: randomUUID(), kind: 'text',
          text: '当前 AI 模型 API 仅支持文字；图片和二进制附件的内容未发送。请提供文字描述，或切换支持这些附件的 Agent。',
        }
      }
      const text = await requestCompletion(settings, [
        { role: 'system', content: TEXT_ONLY_RULES },
        { role: 'user', content: `${prompt}\n\n${TEXT_ONLY_RULES}` },
      ], CHAT_TIMEOUT_MS, input.signal)
      yield { id: randomUUID(), kind: 'text', text }
    },
  }
}

export async function testModelApiConnection(
  settings: ModelApiSettings,
  signal?: AbortSignal,
): Promise<ModelApiConnectionResult> {
  try {
    await requestCompletion(settings, [
      { role: 'user', content: 'Reply OK.' },
    ], TEST_TIMEOUT_MS, signal)
    return { ok: true, message: '连接测试成功，模型已返回文本。' }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof ModelApiRequestError ? error.message : 'AI 模型服务连接失败，请检查配置后重试。',
    }
  }
}
