import test from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeChromeProfile } from './chromeProfile.ts'

test('header uses only profile display fields and safe HTTPS images', () => {
  assert.deepEqual(sanitizeChromeProfile({ name: 'Astrix', avatarUrl: 'https://example.com/avatar.png', email: 'not-forwarded' }), { name: 'Astrix', avatarUrl: 'https://example.com/avatar.png' })
  for (const avatarUrl of ['javascript:alert(1)', 'file:///tmp/a.png', 'http://example.com/a', 'https://user:pass@example.com/a', 'invalid']) {
    assert.equal(sanitizeChromeProfile({ name: 'A', avatarUrl })?.avatarUrl, null)
  }
  assert.equal(sanitizeChromeProfile(null), null)
})
