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
  const authorizeRequest = new URL(start.headers.get('location') ?? 'https://invalid.example')
  assert.equal(authorizeRequest.origin, 'https://www.figma.com')
  assert.equal(authorizeRequest.pathname, '/oauth')
  assert.equal(authorizeRequest.searchParams.get('client_id'), 'client-id')
  assert.equal(authorizeRequest.searchParams.get('response_type'), 'code')
  assert.equal(authorizeRequest.searchParams.get('redirect_uri'), 'http://127.0.0.1:5273/api/auth/figma/callback')
  assert.equal(authorizeRequest.searchParams.get('code_challenge_method'), 'S256')
  assert.match(authorizeRequest.searchParams.get('code_challenge') ?? '', /^[A-Za-z0-9_-]{43}$/)
  assert.match(authorizeRequest.searchParams.get('state') ?? '', /^[A-Za-z0-9_-]{43}$/)
  assert.deepEqual(authorizeRequest.searchParams.get('scope')?.split(' '), [
    'current_user:read', 'file_content:read', 'file_metadata:read',
  ])
  assert.doesNotMatch(authorizeRequest.toString(), /projects:read|client_secret|client-secret/)

  const switchAccount = await fetch(
    `http://127.0.0.1:${address.port}/api/auth/figma/start?select_account=1&returnTo=/`,
    { redirect: 'manual' },
  )
  assert.equal(switchAccount.status, 302)
  const picker = new URL(switchAccount.headers.get('location')!)
  assert.equal(picker.origin, 'https://www.figma.com')
  assert.equal(picker.pathname, '/switch_user')
  const pickerAuthorize = new URL(picker.searchParams.get('cont')!, picker.origin)
  assert.equal(pickerAuthorize.pathname, '/oauth')
  assert.equal(pickerAuthorize.searchParams.get('scope'), authorizeRequest.searchParams.get('scope'))
  assert.equal(pickerAuthorize.searchParams.get('code_challenge_method'), 'S256')

  const switchInBrowser = await fetch(
    `http://127.0.0.1:${address.port}/api/auth/figma/start?handoff=1&select_account=1&returnTo=/`,
  )
  assert.equal(switchInBrowser.status, 200)
  const switchHtml = await switchInBrowser.text()
  const browserPicker = new URL(JSON.parse(/link.href = (".*?");/.exec(switchHtml)![1]))
  assert.equal(browserPicker.origin, 'https://www.figma.com')
  assert.equal(browserPicker.pathname, '/switch_user')
  assert.equal(new URL(browserPicker.searchParams.get('cont')!, browserPicker.origin).pathname, '/oauth')

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
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    if (String(input) === 'https://api.figma.com/v1/oauth/token') {
      return Response.json({ error: 'invalid_grant' }, { status: 400 })
    }
    return originalFetch(input, init)
  }
  process.env.DESIGN_STUDIO_DATA_DIR = dataDirectory
  context.after(async () => {
    globalThis.fetch = originalFetch
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
    assert.match(html, /请在系统浏览器确认权限/)
    assert.doesNotMatch(html, /授权页已打开/)
    const target = new URL(JSON.parse(/link.href = (".*?");/.exec(html)![1]))
    assert.equal(target.origin, 'https://www.figma.com')
    assert.equal(target.pathname, '/oauth')
    assert.equal(target.searchParams.get('code_challenge_method'), 'S256')
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

test('missing OAuth configuration shows one retry action without developer setup or authorization', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-oauth-unconfigured-'))
  const previous = process.env.DESIGN_STUDIO_DATA_DIR
  process.env.DESIGN_STUDIO_DATA_DIR = directory
  context.after(async () => {
    if (previous === undefined) delete process.env.DESIGN_STUDIO_DATA_DIR
    else process.env.DESIGN_STUDIO_DATA_DIR = previous
    await rm(directory, { recursive: true, force: true })
  })
  const middleware = createFigmaOAuthMiddleware({
    clientId: '', clientSecret: '',
    redirectUri: 'http://127.0.0.1:5273/api/auth/figma/callback',
  })
  const server = createServer((request, response) => middleware(request, response, () => response.end()))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  context.after(() => server.close())
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const returnTo = '/agent?project=42&name="<poster>"&figma_auth=connected#images'
  const start = await fetch(`${base}/api/auth/figma/start?${new URLSearchParams({ handoff: '1', desktop: '1', returnTo })}`)
  assert.equal(start.status, 503)
  assert.match(start.headers.get('content-type') ?? '', /text\/html/)
  assert.equal(start.headers.get('cache-control'), 'no-store')
  assert.match(start.headers.get('content-security-policy') ?? '', /default-src 'none'/)
  assert.match(start.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/)
  assert.equal(start.headers.get('referrer-policy'), 'no-referrer')
  assert.equal(start.headers.get('set-cookie'), null)
  const html = await start.text()
  assert.match(html, /Figma 连接暂不可用/)
  assert.match(html, /Astrix 的连接服务尚未就绪/)
  assert.equal(html.match(/<a\b/g)?.length, 1)
  assert.doesNotMatch(html, /<script|window\.open|FIGMA_OAUTH_CLIENT|<poster>|design_studio_figma_handoff|developers\/apps|\/api\/auth\/figma\/setup|Client ID|Client Secret|配置应用授权|<form|<input/)
  const retryLink = /href="([^\"]+)">重新连接 Figma<\/a>/.exec(html)?.[1]
  assert.ok(retryLink)
  const retry = new URL(retryLink.replace(/&amp;/g, '&'), base)
  assert.equal(retry.origin, base)
  assert.equal(retry.pathname, '/api/auth/figma/start')
  assert.equal(retry.searchParams.get('handoff'), '1')
  assert.equal(retry.searchParams.get('desktop'), '1')
  const destination = new URL(retry.searchParams.get('returnTo')!, base)
  assert.equal(destination.pathname, '/agent')
  assert.equal(destination.searchParams.get('project'), '42')
  assert.equal(destination.searchParams.get('name'), '"<poster>"')
  assert.equal(destination.searchParams.has('figma_auth'), false)
  assert.equal(destination.hash, '#images')
  assert.equal((await fetch(base + '/api/auth/figma/handoff')).status, 410)
  const session = await fetch(base + '/api/auth/figma/session')
  assert.deepEqual(await session.json(), { configured: false, authenticated: false, user: null })
  const invalid = await fetch(`${base}/api/auth/figma/start?${new URLSearchParams({ handoff: '1', returnTo: '//other.example' })}`)
  assert.equal(invalid.status, 400)
  assert.equal(invalid.headers.get('set-cookie'), null)
  const webPage = await fetch(`${base}/api/auth/figma/start?${new URLSearchParams({ returnTo: '/agent' })}`)
  assert.equal(webPage.status, 503)
  const webHtml = await webPage.text()
  assert.match(webHtml, /Figma 连接暂不可用/)
  assert.equal(webHtml.match(/<a\b/g)?.length, 1)
  assert.doesNotMatch(webHtml, /\/api\/auth\/figma\/setup|developers\/apps|desktop=|handoff=/)
})

test('expired browser handoff cannot claim a session or complete its old callback', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-handoff-expired-'))
  const previous = process.env.DESIGN_STUDIO_DATA_DIR
  process.env.DESIGN_STUDIO_DATA_DIR = directory
  context.after(async () => {
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
  const start = await fetch(base + '/start?handoff=1&returnTo=/agent')
  const cookie = start.headers.getSetCookie()[0].split(';')[0]
  const html = await start.text()
  const authorize = new URL(JSON.parse(/link.href = (".*?");/.exec(html)![1]))
  const expiredTime = Date.now() + 11 * 60 * 1000
  context.mock.method(Date, 'now', () => expiredTime)
  const claim = await fetch(base + '/handoff', { headers: { Cookie: cookie } })
  assert.equal(claim.status, 410)
  assert.deepEqual(await claim.json(), { error: 'AUTH_HANDOFF_EXPIRED' })
  assert.equal(claim.headers.get('set-cookie'), null)
  const callback = await fetch(`${base}/callback?${new URLSearchParams({ state: authorize.searchParams.get('state')!, code: 'expired-code' })}`, { redirect: 'manual' })
  assert.equal(callback.status, 302)
  assert.match(callback.headers.get('location') ?? '', /figma_auth=invalid_state/)
  assert.ok(callback.headers.getSetCookie().every((value) => !value.startsWith('design_studio_figma_session=')))
})
