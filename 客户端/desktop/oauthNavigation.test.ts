import assert from 'node:assert/strict'
import test from 'node:test'
import { canNavigateFigmaOAuth } from './oauthNavigation.ts'

test('native OAuth only admits Figma and the exact local callback origin', () => {
  const origin = 'http://127.0.0.1:5273'
  for (const url of ['https://www.figma.com/oauth', 'https://figma.com/login', `${origin}/api/auth/figma/callback`]) {
    assert.equal(canNavigateFigmaOAuth(url, origin), true, url)
  }
  for (const url of ['https://accounts.google.com/', 'https://www.figma.com.evil.test/', 'http://www.figma.com/oauth', 'https://www.figma.com:444/oauth', 'https://user@www.figma.com/oauth', 'http://127.0.0.1:5274/', 'javascript:alert(1)', 'invalid']) {
    assert.equal(canNavigateFigmaOAuth(url, origin), false, url)
  }
})
