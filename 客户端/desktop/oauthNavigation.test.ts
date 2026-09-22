import assert from 'node:assert/strict'
import test from 'node:test'
import { canNavigateFigmaOAuth, canOpenFigmaAuthInBrowser, browserOAuthStartUrl } from './oauthNavigation.ts'

test('native OAuth only admits Figma and the exact local callback origin', () => {
  const origin = 'http://127.0.0.1:5273'
  for (const url of ['https://www.figma.com/oauth', 'https://figma.com/login', `${origin}/api/auth/figma/callback`]) {
    assert.equal(canNavigateFigmaOAuth(url, origin), true, url)
  }
  for (const url of ['https://accounts.google.com/', 'https://www.figma.com.evil.test/', 'http://www.figma.com/oauth', 'https://www.figma.com:444/oauth', 'https://user@www.figma.com/oauth', 'http://127.0.0.1:5274/', 'javascript:alert(1)', 'invalid']) {
    assert.equal(canNavigateFigmaOAuth(url, origin), false, url)
  }
})

test('desktop browser handoff stays in its own session and only opens official destinations', () => {
  const origin = 'http://127.0.0.1:5273'
  const url = new URL(browserOAuthStartUrl(`${origin}/api/auth/figma/start?direct=1&returnTo=%2Fagent`, origin))
  assert.equal(url.searchParams.get('handoff'), '1')
  assert.equal(url.searchParams.has('direct'), false)
  assert.equal(url.searchParams.get('returnTo'), '/agent')
  for (const path of ['/oauth?state=test', '/switch_user?cont=%2Foauth', '/developers/apps']) assert.equal(canOpenFigmaAuthInBrowser(`https://www.figma.com${path}`), true)
  for (const path of ['/file/anything', '/oauth/evil']) assert.equal(canOpenFigmaAuthInBrowser(`https://www.figma.com${path}`), false)
  for (const url of ['https://www.figma.com.evil.test/oauth', 'https://user@www.figma.com/oauth', 'http://www.figma.com/oauth', 'https://www.figma.com:444/oauth']) assert.equal(canOpenFigmaAuthInBrowser(url), false)
  assert.throws(() => browserOAuthStartUrl('https://evil.test/api/auth/figma/start', origin))
})
