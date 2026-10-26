import assert from 'node:assert/strict'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  clearModelApiSettings,
  normalizeModelApiDraft,
  publicModelApiSettings,
  readModelApiSettings,
  saveModelApiSettings,
  type ModelApiSecureStorage,
} from './modelApiSettings.ts'

const settings = { provider: 'openai' as const, baseUrl: 'https://model.example/v1', model: 'team/model.v1', apiKey: 'fixture-private-value', enabled: true }
const filename = 'model-api.enc.json'

function testStorage(key = randomBytes(32)): ModelApiSecureStorage {
  return {
    isAsyncEncryptionAvailable: async () => true,
    async encryptStringAsync(value) {
      const nonce = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', key, nonce)
      const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
      return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext])
    },
    async decryptStringAsync(value) {
      const decipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12))
      decipher.setAuthTag(value.subarray(12, 28))
      return { result: Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString('utf8'), shouldReEncrypt: false }
    },
  }
}

async function temporaryDirectory(t: { after: (callback: () => Promise<void>) => void }) {
  const path = await mkdtemp(join(tmpdir(), 'astrix-model-api-'))
  t.after(() => rm(path, { recursive: true, force: true }))
  return path
}

test('model API settings persist encrypted, survive restart, and expose only public state', async (t) => {
  const dataDir = await temporaryDirectory(t)
  const encryptionKey = randomBytes(32)
  assert.equal(await readModelApiSettings(dataDir, testStorage(encryptionKey)), null)
  assert.deepEqual(await saveModelApiSettings(dataDir, { ...settings, baseUrl: `${settings.baseUrl}/chat/completions///` }, testStorage(encryptionKey)), settings)
  assert.deepEqual(await readModelApiSettings(dataDir, testStorage(encryptionKey)), settings)
  assert.deepEqual(await readdir(dataDir), [filename])
  const serialized = await readFile(join(dataDir, filename), 'utf8')
  for (const value of [settings.apiKey, settings.baseUrl, settings.model]) assert.equal(serialized.includes(value), false)
  assert.equal((await stat(join(dataDir, filename))).mode & 0o777, 0o600)
  assert.deepEqual(publicModelApiSettings(settings), { provider: 'openai', baseUrl: settings.baseUrl, model: settings.model, enabled: true, configured: true, hasApiKey: true })
  assert.equal('apiKey' in publicModelApiSettings(settings), false)
  assert.deepEqual(publicModelApiSettings(null), { provider: 'openai', baseUrl: '', model: '', enabled: false, configured: false, hasApiKey: false })
})

test('editing other fields retains the saved API key and failed replacement preserves the original file', async (t) => {
  const dataDir = await temporaryDirectory(t)
  const storage = testStorage()
  await saveModelApiSettings(dataDir, settings, storage)
  for (const apiKey of [undefined, '', '   ']) {
    const result = await saveModelApiSettings(dataDir, { ...settings, model: 'organization/model.name', apiKey }, storage)
    assert.equal(result.apiKey, settings.apiKey)
    assert.equal(result.model, 'organization/model.name')
  }
  const before = await readFile(join(dataDir, filename))
  await assert.rejects(saveModelApiSettings(dataDir, { ...settings, apiKey: 'fixture-replacement' }, {
    ...storage,
    encryptStringAsync: async () => { throw new Error('private-encryption-diagnostic') },
  }), /无法安全保存/)
  assert.deepEqual(await readFile(join(dataDir, filename)), before)
  assert.deepEqual(await readdir(dataDir), [filename])
  assert.equal((await readModelApiSettings(dataDir, storage))?.apiKey, settings.apiKey)
})

test('disabled incomplete drafts can be saved, enabling requires address and model, and anonymous endpoints are allowed', async (t) => {
  const dataDir = await temporaryDirectory(t)
  const storage = testStorage()
  const draft = { provider: 'openai', baseUrl: '', model: '', apiKey: '', enabled: false } as const
  assert.deepEqual(await saveModelApiSettings(dataDir, { baseUrl: '', model: '', enabled: false }, storage), draft)
  assert.deepEqual(await readModelApiSettings(dataDir, storage), draft)
  assert.equal(publicModelApiSettings(draft).configured, false)
  for (const incomplete of [
    { ...settings, baseUrl: '' },
    { ...settings, model: '' },
  ]) await assert.rejects(saveModelApiSettings(dataDir, incomplete, storage), /启用模型 API 前/)
  assert.deepEqual(await readModelApiSettings(dataDir, storage), draft)
  assert.equal((await saveModelApiSettings(dataDir, { ...settings, apiKey: '' }, storage)).apiKey, '')
})

test('connection-test normalization reuses validation and saved key without persisting or changing state', () => {
  const previous = { ...settings }
  assert.deepEqual(normalizeModelApiDraft({ ...settings, baseUrl: `${settings.baseUrl}/chat/completions`, apiKey: '' }, previous), settings)
  assert.deepEqual(previous, settings)
  assert.throws(() => normalizeModelApiDraft(null, previous), /格式不正确/)
  assert.throws(() => normalizeModelApiDraft({ baseUrl: '', model: '', enabled: true }, null), /启用模型 API 前/)
})

test('clearing is idempotent and removes the saved configuration without needing secure storage', async (t) => {
  const dataDir = await temporaryDirectory(t)
  const storage = testStorage()
  await clearModelApiSettings(dataDir)
  await saveModelApiSettings(dataDir, settings, storage)
  await clearModelApiSettings(dataDir)
  await clearModelApiSettings(dataDir)
  assert.equal(await readModelApiSettings(dataDir, storage), null)
  assert.deepEqual(await readdir(dataDir), [])
})

test('service addresses allow arbitrary HTTP(S) origins and query parameters while rejecting malformed URLs', async (t) => {
  const dataDir = await temporaryDirectory(t)
  const storage = testStorage()
  for (const baseUrl of ['https://model.example/v1/', 'http://127.0.0.1:1234/v1', 'http://localhost:1234/v1', 'http://[::1]:1234/v1', 'http://model.example/v1', 'http://192.168.1.2:1234/v1', 'http://localhost.example/v1', 'https://model.example/v1?api-version=custom']) {
    const result = await saveModelApiSettings(dataDir, { ...settings, baseUrl }, storage)
    assert.equal(result.baseUrl, baseUrl.replace(/\/+$/, ''))
  }
  const before = await readFile(join(dataDir, filename))
  for (const baseUrl of [
    'https://name:private-diagnostic@model.example/v1', 'https://@model.example/v1',
    'https://model.example/v1#private-diagnostic', 'file:///private-diagnostic', 'private-diagnostic',
    'https://model.example/\nprivate-diagnostic',
  ]) {
    await assert.rejects(saveModelApiSettings(dataDir, { ...settings, baseUrl }, storage), (error: Error) => error.message.includes('格式不正确') && !error.message.includes('private-diagnostic'))
  }
  assert.deepEqual(await readFile(join(dataDir, filename)), before)
})

test('invalid input and secure storage failures return fixed errors without exposing caller values', async (t) => {
  const dataDir = await temporaryDirectory(t)
  const storage = testStorage()
  const diagnostic = 'private-input-diagnostic'
  for (const payload of [
    null, [], {}, { ...settings, provider: 'unrecognized' }, { ...settings, enabled: 'true' }, { ...settings, baseUrl: 42 },
    { ...settings, model: `model\u0085${diagnostic}` }, { ...settings, model: 'x'.repeat(513) },
    { ...settings, apiKey: `key\u0000${diagnostic}` }, { ...settings, apiKey: 'x'.repeat(8193) },
    { get baseUrl() { throw new Error(diagnostic) }, model: '', enabled: false },
  ]) await assert.rejects(saveModelApiSettings(dataDir, payload, storage), (error: Error) => error.message.includes('格式不正确') && !error.message.includes(diagnostic))
  for (const unavailable of [
    { ...storage, isAsyncEncryptionAvailable: async () => false },
    { ...storage, getSelectedStorageBackend: () => 'basic_text' },
    { ...storage, isAsyncEncryptionAvailable: async () => { throw new Error(diagnostic) } },
    { ...storage, encryptStringAsync: async () => { throw new Error(diagnostic) } },
  ]) await assert.rejects(saveModelApiSettings(dataDir, settings, unavailable), (error: Error) => error.message.includes('无法安全保存') && !error.message.includes(diagnostic))
  assert.deepEqual(await readdir(dataDir), [])
})

test('native protocols normalize their own endpoints and never inherit another source or protocol key', async (t) => {
  const dataDir = await temporaryDirectory(t)
  const storage = testStorage()
  await saveModelApiSettings(dataDir, settings, storage)
  const otherOrigin = await saveModelApiSettings(dataDir, { ...settings, baseUrl: 'https://other.example/v1', apiKey: '' }, storage)
  assert.equal(otherOrigin.apiKey, '')
  await saveModelApiSettings(dataDir, settings, storage)
  const claude = await saveModelApiSettings(dataDir, { ...settings, provider: 'anthropic', baseUrl: settings.baseUrl + '/messages', apiKey: '' }, storage)
  assert.equal(claude.provider, 'anthropic')
  assert.equal(claude.baseUrl, settings.baseUrl)
  assert.equal(claude.apiKey, '')
  const gemini = normalizeModelApiDraft({ ...settings, provider: 'gemini', baseUrl: 'https://proxy.example/v1beta/models/custom-model:generateContent?api-version=1', apiKey: '' }, settings)
  assert.equal(gemini.provider, 'gemini')
  assert.equal(gemini.baseUrl, 'https://proxy.example/v1beta?api-version=1')
  assert.equal(gemini.apiKey, '')
})

test('encrypted legacy settings default to OpenAI without rewriting the saved envelope', async (t) => {
  const dataDir = await temporaryDirectory(t)
  const storage = testStorage()
  const { provider: _provider, ...legacy } = settings
  const encrypted = await storage.encryptStringAsync(JSON.stringify(legacy))
  await writeFile(join(dataDir, filename), JSON.stringify({ version: 1, encrypted: encrypted.toString('base64') }))
  const before = await readFile(join(dataDir, filename))
  assert.deepEqual(await readModelApiSettings(dataDir, storage), settings)
  assert.deepEqual(await readFile(join(dataDir, filename)), before)
})

test('corrupt, oversized, and undecryptable files never expose raw data or storage diagnostics', async (t) => {
  const dataDir = await temporaryDirectory(t)
  const storage = testStorage()
  await saveModelApiSettings(dataDir, settings, storage)
  await assert.rejects(readModelApiSettings(dataDir, { ...storage, decryptStringAsync: async () => { throw new Error(settings.apiKey) } }), (error: Error) => error.message.includes('无法读取') && !error.message.includes(settings.apiKey))
  for (const content of [JSON.stringify(settings), 'x'.repeat(128 * 1024 + 1), JSON.stringify({ version: 1, encrypted: 'invalid-base64!' })]) {
    await writeFile(join(dataDir, filename), content)
    await assert.rejects(readModelApiSettings(dataDir, storage), /无法读取/)
  }
})

test('symbolic links are rejected and their targets are untouched', async (t) => {
  const dataDir = await temporaryDirectory(t)
  const linkedDir = await temporaryDirectory(t)
  const target = join(linkedDir, 'untouched.txt')
  const storage = testStorage()
  await writeFile(target, 'untouched')
  await symlink(target, join(dataDir, filename))
  await assert.rejects(readModelApiSettings(dataDir, storage), /无法读取/)
  await assert.rejects(saveModelApiSettings(dataDir, settings, storage), /无法安全保存/)
  await assert.rejects(clearModelApiSettings(dataDir), /无法清除/)
  assert.equal(await readFile(target, 'utf8'), 'untouched')
  const directoryLink = join(dataDir, 'linked-directory')
  await symlink(linkedDir, directoryLink)
  await assert.rejects(saveModelApiSettings(directoryLink, settings, storage), /无法安全保存/)
  await assert.rejects(readModelApiSettings(directoryLink, storage), /无法读取/)
  await assert.rejects(clearModelApiSettings(directoryLink), /无法清除/)
  assert.deepEqual(await readdir(linkedDir), ['untouched.txt'])
})
