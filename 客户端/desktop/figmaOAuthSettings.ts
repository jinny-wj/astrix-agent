import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { chmod, mkdir, open, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'

export const FIGMA_DESKTOP_REDIRECT_URI = 'http://127.0.0.1:5273/api/auth/figma/callback'
const SETTINGS_FILENAME = 'figma-oauth.enc.json'
const MAX_FILE_BYTES = 128 * 1024

/** Pass Electron's safeStorage from the main process; never use a plaintext fallback. */
export interface FigmaOAuthSecureStorage {
  isAsyncEncryptionAvailable(): Promise<boolean>
  encryptStringAsync(value: string): Promise<Buffer>
  decryptStringAsync(value: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }>
  getSelectedStorageBackend?(): string
}

/** Main-process data only. Do not send this object through renderer IPC. */
export interface FigmaOAuthSettings {
  clientId: string
  clientSecret: string
  redirectUri: typeof FIGMA_DESKTOP_REDIRECT_URI
}

async function assertSecureStorage(storage: FigmaOAuthSecureStorage) {
  if (!(await storage.isAsyncEncryptionAvailable()) || storage.getSelectedStorageBackend?.() === 'basic_text') {
    throw new Error('系统安全存储不可用，请解锁系统钥匙串后重试。')
  }
}

function parseSettings(payload: unknown): FigmaOAuthSettings {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('请填写完整的 Figma 应用连接信息。')
  }
  const source = payload as Record<string, unknown>
  const fields = [source.clientId, source.clientSecret]
  if (fields.some((value) => typeof value !== 'string' || value.length > 4096 || !value.trim() || /\p{Cc}/u.test(value))) {
    throw new Error('连接信息不能为空、超过 4096 个字符或包含控制字符。')
  }
  return {
    clientId: (source.clientId as string).trim(),
    clientSecret: (source.clientSecret as string).trim(),
    redirectUri: FIGMA_DESKTOP_REDIRECT_URI,
  }
}

export async function readFigmaOAuthSettings(
  dataDir: string,
  secureStorage: FigmaOAuthSecureStorage,
): Promise<FigmaOAuthSettings | null> {
  let file
  try {
    file = await open(join(dataDir, SETTINGS_FILENAME), constants.O_RDONLY | constants.O_NOFOLLOW)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw new Error('无法读取本机 Figma 连接配置，请重新保存连接信息。')
  }
  try {
    await assertSecureStorage(secureStorage)
    const stat = await file.stat()
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) throw new Error('Invalid settings file')
    const envelope: unknown = JSON.parse(await file.readFile('utf8'))
    if (!envelope || typeof envelope !== 'object') throw new Error('Invalid settings envelope')
    const { version, encrypted } = envelope as Record<string, unknown>
    if (version !== 1 || typeof encrypted !== 'string' || !encrypted || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encrypted)) {
      throw new Error('Invalid settings envelope')
    }
    const decrypted = await secureStorage.decryptStringAsync(Buffer.from(encrypted, 'base64'))
    return parseSettings(JSON.parse(decrypted.result))
  } catch {
    // Keychain and JSON errors can contain sensitive input; only return a fixed message.
    throw new Error('本机 Figma 连接配置无法解密，请解锁系统钥匙串或重新保存连接信息。')
  } finally {
    await file.close()
  }
}

export async function saveFigmaOAuthSettings(
  dataDir: string,
  payload: unknown,
  secureStorage: FigmaOAuthSecureStorage,
): Promise<void> {
  const settings = parseSettings(payload)
  await assertSecureStorage(secureStorage)
  const temporaryPath = join(dataDir, `.${SETTINGS_FILENAME}.${randomUUID()}.tmp`)
  try {
    const encrypted = await secureStorage.encryptStringAsync(JSON.stringify(settings))
    if (!encrypted.length) throw new Error('Encryption failed')
    const envelope = JSON.stringify({ version: 1, encrypted: encrypted.toString('base64') })
    if (Buffer.byteLength(envelope) > MAX_FILE_BYTES) throw new Error('Settings too large')
    await mkdir(dataDir, { recursive: true, mode: 0o700 })
    const file = await open(temporaryPath, 'wx', 0o600)
    try {
      await file.writeFile(envelope, 'utf8')
      await file.sync()
    } finally {
      await file.close()
    }
    await rename(temporaryPath, join(dataDir, SETTINGS_FILENAME))
    await chmod(join(dataDir, SETTINGS_FILENAME), 0o600)
  } catch {
    await unlink(temporaryPath).catch(() => undefined)
    throw new Error('无法安全保存 Figma 连接信息，请检查系统钥匙串和本机存储权限。')
  }
}
