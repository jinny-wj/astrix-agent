import assert from 'node:assert/strict'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  FIGMA_DESKTOP_REDIRECT_URI,
  readFigmaOAuthSettings,
  saveFigmaOAuthSettings,
  type FigmaOAuthSecureStorage,
} from './figmaOAuthSettings.ts'

function testStorage(): FigmaOAuthSecureStorage {
  const key = randomBytes(32)
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

test('desktop Figma settings encrypt, replace atomically, and pin the local callback', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'astrix-oauth-settings-'))
  t.after(() => rm(dataDir, { recursive: true, force: true }))
  const storage = testStorage()
  assert.equal(await readFigmaOAuthSettings(dataDir, storage), null)
  const credentials = { clientId: 'astrix-test-client', clientSecret: 'test-secret-with-private-value' }
  assert.equal(await saveFigmaOAuthSettings(dataDir, { ...credentials, redirectUri: 'https://other.example/' }, storage), undefined)
  assert.deepEqual(await readFigmaOAuthSettings(dataDir, storage), { ...credentials, redirectUri: FIGMA_DESKTOP_REDIRECT_URI })
  const [filename] = await readdir(dataDir)
  const saved = await readFile(join(dataDir, filename), 'utf8')
  assert.equal(saved.includes(credentials.clientId), false)
  assert.equal(saved.includes(credentials.clientSecret), false)
  assert.equal((await stat(join(dataDir, filename))).mode & 0o777, 0o600)
  await saveFigmaOAuthSettings(dataDir, { ...credentials, clientSecret: 'replacement-private-value' }, storage)
  assert.deepEqual(await readdir(dataDir), [filename])
  assert.equal((await readFigmaOAuthSettings(dataDir, storage))?.clientSecret, 'replacement-private-value')
})

test('desktop Figma settings reject malformed fields before changing a saved configuration', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'astrix-oauth-validation-'))
  t.after(() => rm(dataDir, { recursive: true, force: true }))
  const storage = testStorage()
  const credentials = { clientId: 'existing-client', clientSecret: 'existing-private-value' }
  await saveFigmaOAuthSettings(dataDir, credentials, storage)
  for (const payload of [null, [], {}, { ...credentials, clientId: 123 }, { ...credentials, clientSecret: '' }, { ...credentials, clientId: ' ' }, { ...credentials, clientSecret: 'a'.repeat(4097) }, { ...credentials, clientId: 'a\nb' }, { ...credentials, clientSecret: 'a\u0000b' }, { ...credentials, clientId: 'a\u0085b' }]) {
    await assert.rejects(saveFigmaOAuthSettings(dataDir, payload, storage))
  }
  assert.deepEqual(await readFigmaOAuthSettings(dataDir, storage), { ...credentials, redirectUri: FIGMA_DESKTOP_REDIRECT_URI })
})

test('desktop Figma settings refuse unavailable or plaintext secure storage without persisting credentials', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'astrix-oauth-keychain-'))
  t.after(() => rm(dataDir, { recursive: true, force: true }))
  const credentials = { clientId: 'test-client', clientSecret: 'test-private-value' }
  for (const storage of [
    { ...testStorage(), isAsyncEncryptionAvailable: async () => false },
    { ...testStorage(), getSelectedStorageBackend: () => 'basic_text' },
    { ...testStorage(), encryptStringAsync: async () => { throw new Error(credentials.clientSecret) } },
  ]) {
    await assert.rejects(saveFigmaOAuthSettings(dataDir, credentials, storage), (error: Error) => !error.message.includes(credentials.clientSecret))
  }
  assert.deepEqual(await readdir(dataDir), [])
})

test('desktop Figma settings do not return corrupt data or raw decryption errors', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'astrix-oauth-corrupt-'))
  t.after(() => rm(dataDir, { recursive: true, force: true }))
  const storage = testStorage()
  const credentials = { clientId: 'test-client', clientSecret: 'private-value-in-error' }
  await saveFigmaOAuthSettings(dataDir, credentials, storage)
  await assert.rejects(readFigmaOAuthSettings(dataDir, { ...storage, decryptStringAsync: async () => { throw new Error(credentials.clientSecret) } }), (error: Error) => !error.message.includes(credentials.clientSecret))
  const [filename] = await readdir(dataDir)
  await writeFile(join(dataDir, filename), JSON.stringify(credentials))
  await assert.rejects(readFigmaOAuthSettings(dataDir, storage))
})

test('waiting for keychain leaves the event loop responsive and preserves saved data on denial', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'astrix-oauth-pending-'))
  t.after(() => rm(dataDir, { recursive: true, force: true }))
  const storage = testStorage()
  await saveFigmaOAuthSettings(dataDir, { clientId: 'test-client', clientSecret: 'test-value' }, storage)
  const [filename] = await readdir(dataDir)
  const before = await readFile(join(dataDir, filename))
  let deny!: (error: Error) => void
  let started!: () => void
  const reached = new Promise<void>(resolve => { started = resolve })
  const pending = readFigmaOAuthSettings(dataDir, {
    ...storage,
    decryptStringAsync: () => { started(); return new Promise((_resolve, reject) => { deny = reject }) },
  })
  const rejected = assert.rejects(pending, /无法解密/)
  await reached
  await new Promise<void>(resolve => setImmediate(resolve))
  deny(new Error('keychain denied'))
  await rejected
  assert.deepEqual(await readFile(join(dataDir, filename)), before)
  assert.equal((await readFigmaOAuthSettings(dataDir, storage))?.clientId, 'test-client')
})
