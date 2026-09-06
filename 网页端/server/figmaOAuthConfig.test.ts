import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createFigmaOAuthMiddleware } from './figmaOAuthPlugin.ts'

test('团队 ID 可通过产品接口持久化配置', async (context) => {
  const dataDirectory = await mkdtemp(join(tmpdir(), 'ds-figma-config-'))
  const previous = process.env.DESIGN_STUDIO_DATA_DIR
  process.env.DESIGN_STUDIO_DATA_DIR = dataDirectory
  context.after(async () => {
    if (previous === undefined) delete process.env.DESIGN_STUDIO_DATA_DIR
    else process.env.DESIGN_STUDIO_DATA_DIR = previous
    await rm(dataDirectory, { recursive: true, force: true })
  })

  const middleware = createFigmaOAuthMiddleware({
    clientId: 'client-id',
    clientSecret: 'client-secret',
    redirectUri: 'http://127.0.0.1:5273/api/auth/figma/callback',
  })
  const server = createServer((request, response) => {
    middleware(request, response, () => {
      response.statusCode = 404
      response.end('Not Found')
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  context.after(() => server.close())
  const address = server.address() as AddressInfo
  const url = `http://127.0.0.1:${address.port}/api/auth/figma/library/config`

  const saved = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ teamIds: ['1234567890', '1234567890', '9876543210'] }),
  })
  assert.equal(saved.status, 200)
  const savedBody = await saved.json() as { teamIds: string[]; reauthorize: boolean }
  assert.deepEqual(savedBody.teamIds, ['1234567890', '9876543210'])
  assert.equal(savedBody.reauthorize, false)

  const loaded = await fetch(url)
  const loadedBody = await loaded.json() as { teamIds: string[]; configured: boolean }
  assert.deepEqual(loadedBody.teamIds, ['1234567890', '9876543210'])
  assert.equal(loadedBody.configured, true)

  const disk = JSON.parse(
    await readFile(join(dataDirectory, 'figma-library-config.json'), 'utf8'),
  ) as { teamIds: string[] }
  assert.deepEqual(disk.teamIds, loadedBody.teamIds)

  const fromUrl = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      teamIds: ['https://www.figma.com/files/team/555666777888999'],
      merge: true,
    }),
  })
  assert.equal(fromUrl.status, 200)
  const merged = await fromUrl.json() as { teamIds: string[]; reauthorize: boolean }
  assert.deepEqual(merged.teamIds, ['1234567890', '9876543210', '555666777888999'])
  assert.equal(merged.reauthorize, false)

  const start = await fetch(
    `http://127.0.0.1:${address.port}/api/auth/figma/start?returnTo=/`,
    { redirect: 'manual' },
  )
  assert.equal(start.status, 302)
  const authorize = new URL(start.headers.get('location') ?? 'https://invalid.example')
  const continuation = decodeURIComponent(authorize.searchParams.get('cont') ?? '')
  const authorizeRequest = new URL(continuation, 'https://www.figma.com')
  assert.deepEqual(authorizeRequest.searchParams.get('scope')?.split(' '), [
    'current_user:read', 'file_content:read', 'file_metadata:read',
  ])
  assert.doesNotMatch(continuation, /projects:read/)

  const nativeStart = await fetch(
    `http://127.0.0.1:${address.port}/api/auth/figma/start?direct=1&returnTo=/`,
    { redirect: 'manual' },
  )
  assert.equal(nativeStart.status, 302)
  const nativeAuthorize = new URL(nativeStart.headers.get('location')!)
  assert.equal(nativeAuthorize.origin, 'https://www.figma.com')
  assert.equal(nativeAuthorize.pathname, '/oauth')
  assert.equal(nativeAuthorize.searchParams.get('scope'), authorizeRequest.searchParams.get('scope'))
  assert.equal(nativeAuthorize.searchParams.get('code_challenge_method'), 'S256')
  assert.match(nativeStart.headers.get('set-cookie') ?? '', /HttpOnly/)

  const invalid = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ teamIds: ['not-a-team'] }),
  })
  assert.equal(invalid.status, 400)
})

test('未完成的 Figma 登录流程在服务重启后仍可继续', async (context) => {
  const dataDirectory = await mkdtemp(join(tmpdir(), 'ds-figma-pending-'))
  const previous = process.env.DESIGN_STUDIO_DATA_DIR
  process.env.DESIGN_STUDIO_DATA_DIR = dataDirectory
  context.after(async () => {
    if (previous === undefined) delete process.env.DESIGN_STUDIO_DATA_DIR
    else process.env.DESIGN_STUDIO_DATA_DIR = previous
    await rm(dataDirectory, { recursive: true, force: true })
  })

  const state = 'pending-state-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  await writeFile(
    join(dataDirectory, 'figma-oauth-pending.json'),
    JSON.stringify({
      version: 1,
      flows: [[
        state,
        {
          state,
          verifier: 'pending-verifier-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          returnTo: '/',
          createdAt: Date.now(),
        },
      ]],
    }),
    'utf8',
  )

  const middleware = createFigmaOAuthMiddleware({
    clientId: 'client-id',
    clientSecret: 'client-secret',
    redirectUri: 'http://127.0.0.1:5273/api/auth/figma/callback',
  })
  const server = createServer((request, response) => {
    middleware(request, response, () => {
      response.statusCode = 404
      response.end('Not Found')
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  context.after(() => server.close())
  const address = server.address() as AddressInfo

  const callback = await fetch(
    `http://127.0.0.1:${address.port}/api/auth/figma/callback?code=not-a-real-code&state=${state}`,
    { redirect: 'manual' },
  )
  assert.equal(callback.status, 302)
  const location = callback.headers.get('location') ?? ''
  assert.match(location, /figma_auth=exchange_failed/)
})

test('browser authorization returns to the initiating desktop session without exposing its claim', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-handoff-'))
  const previous = process.env.DESIGN_STUDIO_DATA_DIR
  const originalFetch = globalThis.fetch
  process.env.DESIGN_STUDIO_DATA_DIR = directory
  globalThis.fetch = async (input, init) => {
    if (String(input) === 'https://api.figma.com/v1/oauth/token') {
      return Response.json({ access_token: 'test-access', expires_in: 3600 })
    }
    if (String(input) === 'https://api.figma.com/v1/me') {
      return Response.json({ id: 'test-user', handle: 'Test user' })
    }
    return originalFetch(input, init)
  }
  context.after(async () => {
    globalThis.fetch = originalFetch
    if (previous === undefined) delete process.env.DESIGN_STUDIO_DATA_DIR
    else process.env.DESIGN_STUDIO_DATA_DIR = previous
    await rm(directory, { recursive: true, force: true })
  })
  const middleware = createFigmaOAuthMiddleware({
    clientId: 'test-client', clientSecret: 'test-secret',
    redirectUri: 'http://127.0.0.1:5273/api/auth/figma/callback',
  })
  const server = createServer((request, response) => middleware(request, response, () => response.end()))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  context.after(() => server.close())
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/auth/figma`
  for (const cancelled of [false, true]) {
    const start = await fetch(base + '/start?handoff=1&returnTo=/agent')
    assert.equal(start.status, 200)
    const cookie = start.headers.getSetCookie()[0].split(';')[0]
    assert.match(start.headers.getSetCookie()[0], /HttpOnly/)
    const html = await start.text()
    const target = new URL(JSON.parse(/link.href = (".*?");/.exec(html)![1]))
    const state = target.searchParams.get('state')!
    assert.ok(!html.includes(cookie.split('=')[1]))
    const poll = () => fetch(base + '/handoff', { headers: { Cookie: cookie } })
    assert.deepEqual(await (await poll()).json(), { pending: true })
    assert.equal((await fetch(base + '/handoff')).status, 410)
    assert.equal((await fetch(base + '/handoff', { headers: { Cookie: 'design_studio_figma_handoff=' + state } })).status, 410)
    const callback = await fetch(base + '/callback?state=' + state + (cancelled ? '&error=access_denied' : '&code=test-code'), { redirect: 'manual' })
    assert.equal(callback.status, 302)
    const completed = await poll()
    const body = await completed.json() as { redirect: string }
    assert.match(body.redirect, cancelled ? /access_denied/ : /connected/)
    const sessionCookie = completed.headers.getSetCookie().find((value) => value.startsWith('design_studio_figma_session='))
    if (cancelled) {
      assert.equal(sessionCookie, undefined)
    } else {
      assert.ok(sessionCookie)
      const session = await fetch(base + '/session', { headers: { Cookie: sessionCookie.split(';')[0] } })
      assert.equal((await session.json() as { authenticated: boolean }).authenticated, true)
    }
    assert.equal((await poll()).status, 410)
  }
})
