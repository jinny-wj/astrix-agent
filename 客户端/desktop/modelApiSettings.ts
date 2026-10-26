import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { ModelApiDraft, ModelApiPublicSettings, ModelApiSettings } from '../src/types/modelApi.ts'
import type { FigmaOAuthSecureStorage } from './figmaOAuthSettings.ts'
import { normalizeModelBaseUrl } from '../../网页端/workbench/server/model.mjs'

export type ModelApiSecureStorage = FigmaOAuthSecureStorage

const SETTINGS_FILENAME = 'model-api.enc.json'
const MAX_FILE_BYTES = 128 * 1024
const INVALID_SETTINGS = '模型 API 配置格式不正确，请检查服务地址、模型名称和 API Key。'
const INCOMPLETE_SETTINGS = '启用模型 API 前，请填写服务地址和模型名称。'
const READ_ERROR = '无法读取本机模型 API 配置，请解锁系统安全存储或重新保存配置。'
const SAVE_ERROR = '无法安全保存模型 API 配置，请检查系统安全存储和本机存储权限。'
const CLEAR_ERROR = '无法清除本机模型 API 配置，请检查本机存储权限。'

async function assertSecureStorage(storage: ModelApiSecureStorage) {
  if (!(await storage.isAsyncEncryptionAvailable()) || storage.getSelectedStorageBackend?.() === 'basic_text') {
    throw new Error('Secure storage unavailable')
  }
}

function field(value: unknown, maxLength: number): string {
  if (typeof value !== 'string' || value.length > maxLength || /\p{Cc}/u.test(value)) {
    throw new Error(INVALID_SETTINGS)
  }
  return value.trim()
}

function normalizeBaseUrl(value: unknown, provider: ModelApiSettings['provider']): string {
  const input = field(value, 2048)
  if (!input) return ''
  try {
    if (/\/\/[^/]*@/.test(input) || input.includes('#')) throw new Error()
    return normalizeModelBaseUrl(input, provider)
  } catch {
    throw new Error(INVALID_SETTINGS)
  }
}

function parseDraft(payload: unknown): ModelApiDraft {
  // Getters, URL parser errors, and encryption errors must never echo caller input.
  try {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error()
    const source = payload as Record<string, unknown>
    if (typeof source.enabled !== 'boolean') throw new Error()
    const provider = source.provider === undefined ? 'openai' : source.provider
    if (provider !== 'openai' && provider !== 'anthropic' && provider !== 'gemini') throw new Error()
    return {
      provider,
      baseUrl: normalizeBaseUrl(source.baseUrl, provider),
      model: field(source.model, 512),
      apiKey: source.apiKey === undefined ? undefined : field(source.apiKey, 8192),
      enabled: source.enabled,
    }
  } catch {
    throw new Error(INVALID_SETTINGS)
  }
}

function complete(settings: ModelApiSettings): boolean {
  return Boolean(settings.baseUrl && settings.model)
}

function sameConnection(draft: ModelApiDraft, previous: ModelApiSettings | null): boolean {
  if (!previous || (draft.provider ?? 'openai') !== (previous.provider ?? 'openai')) return false
  try { return new URL(draft.baseUrl).origin === new URL(previous.baseUrl).origin } catch { return false }
}

/** Validate a draft for either persistence or an explicit connection test. */
export function normalizeModelApiDraft(payload: unknown, previous: ModelApiSettings | null): ModelApiSettings {
  const draft = parseDraft(payload)
  const settings: ModelApiSettings = { ...draft, apiKey: draft.apiKey || (sameConnection(draft, previous) ? previous?.apiKey : '') || '' }
  if (settings.enabled && !complete(settings)) throw new Error(INCOMPLETE_SETTINGS)
  return settings
}

async function assertDirectory(dataDir: string): Promise<void> {
  const info = await lstat(dataDir)
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Invalid settings directory')
}

async function assertTarget(dataDir: string): Promise<void> {
  try {
    const info = await lstat(join(dataDir, SETTINGS_FILENAME))
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('Invalid settings file')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

export async function readModelApiSettings(
  dataDir: string,
  secureStorage: ModelApiSecureStorage,
): Promise<ModelApiSettings | null> {
  let file
  try {
    await assertDirectory(dataDir)
    file = await open(join(dataDir, SETTINGS_FILENAME), constants.O_RDONLY | constants.O_NOFOLLOW)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw new Error(READ_ERROR)
  }
  try {
    const info = await file.stat()
    if (!info.isFile() || info.size > MAX_FILE_BYTES) throw new Error()
    // Bound the actual read too, in case the file grows after stat().
    const bytes = Buffer.alloc(MAX_FILE_BYTES + 1)
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0)
    if (bytesRead > MAX_FILE_BYTES) throw new Error()
    const envelope: unknown = JSON.parse(bytes.subarray(0, bytesRead).toString('utf8'))
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) throw new Error()
    const { version, encrypted } = envelope as Record<string, unknown>
    if (version !== 1 || typeof encrypted !== 'string' || !encrypted || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encrypted)) throw new Error()
    await assertSecureStorage(secureStorage)
    const decrypted = await secureStorage.decryptStringAsync(Buffer.from(encrypted, 'base64'))
    const draft = parseDraft(JSON.parse(decrypted.result))
    if (draft.apiKey === undefined) throw new Error()
    const settings: ModelApiSettings = { ...draft, apiKey: draft.apiKey }
    if (settings.enabled && !complete(settings)) throw new Error()
    return settings
  } catch {
    throw new Error(READ_ERROR)
  } finally {
    await file.close().catch(() => undefined)
  }
}

export async function saveModelApiSettings(
  dataDir: string,
  payload: unknown,
  secureStorage: ModelApiSecureStorage,
): Promise<ModelApiSettings> {
  const draft = parseDraft(payload)
  let previous: ModelApiSettings | null
  try {
    previous = draft.apiKey ? null : await readModelApiSettings(dataDir, secureStorage)
  } catch {
    throw new Error(SAVE_ERROR)
  }
  const settings = normalizeModelApiDraft(draft, previous)
  const temporaryPath = join(dataDir, `.${SETTINGS_FILENAME}.${randomUUID()}.tmp`)
  try {
    await assertSecureStorage(secureStorage)
    const encrypted = await secureStorage.encryptStringAsync(JSON.stringify(settings))
    if (!encrypted.length) throw new Error()
    const envelope = JSON.stringify({ version: 1, encrypted: encrypted.toString('base64') })
    if (Buffer.byteLength(envelope) > MAX_FILE_BYTES) throw new Error()
    await mkdir(dataDir, { recursive: true, mode: 0o700 })
    await assertDirectory(dataDir)
    await assertTarget(dataDir)
    const file = await open(temporaryPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600)
    try {
      await file.chmod(0o600)
      await file.writeFile(envelope, 'utf8')
      await file.sync()
    } finally {
      await file.close()
    }
    await rename(temporaryPath, join(dataDir, SETTINGS_FILENAME))
    return settings
  } catch {
    await unlink(temporaryPath).catch(() => undefined)
    throw new Error(SAVE_ERROR)
  }
}

export async function clearModelApiSettings(dataDir: string): Promise<void> {
  try {
    await assertDirectory(dataDir)
    await assertTarget(dataDir)
    await unlink(join(dataDir, SETTINGS_FILENAME))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error(CLEAR_ERROR)
  }
}

export function publicModelApiSettings(settings: ModelApiSettings | null): ModelApiPublicSettings {
  return {
    provider: settings?.provider ?? 'openai',
    baseUrl: settings?.baseUrl ?? '',
    model: settings?.model ?? '',
    enabled: settings?.enabled ?? false,
    hasApiKey: Boolean(settings?.apiKey),
    configured: settings ? complete(settings) : false,
  }
}
