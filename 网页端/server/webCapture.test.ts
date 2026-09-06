import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildWebpageCapturePrompt,
  extractWebpageBrief,
  isBlockedCaptureHost,
} from './webCapture.ts'

test('extractWebpageBrief reads title, description, og image and headings', () => {
  const html = `
    <html>
      <head>
        <title>Example Store</title>
        <meta property="og:title" content="春季上新">
        <meta name="description" content="官网简介">
        <meta property="og:description" content="春季系列现已开售">
        <meta property="og:image" content="/hero.png">
      </head>
      <body>
        <h1>春季系列</h1>
        <h2>新品外套</h2>
        <h2>春季系列</h2>
      </body>
    </html>
  `
  const brief = extractWebpageBrief(html, 'https://shop.example.com/home')
  assert.equal(brief.title, '春季上新')
  assert.equal(brief.description, '春季系列现已开售')
  assert.equal(brief.imageUrl, 'https://shop.example.com/hero.png')
  assert.deepEqual(brief.headings, ['春季系列', '新品外套'])
  const prompt = buildWebpageCapturePrompt(brief, {
    name: 'hero.png',
    path: '/tmp/hero.png',
  })
  assert.match(prompt, /静态 HTML 摘要/)
  assert.match(prompt, /不是整页截图/)
  assert.match(prompt, /\/tmp\/hero\.png/)
})

test('isBlockedCaptureHost rejects private hosts', () => {
  assert.equal(isBlockedCaptureHost('localhost'), true)
  assert.equal(isBlockedCaptureHost('127.0.0.1'), true)
  assert.equal(isBlockedCaptureHost('10.0.0.8'), true)
  assert.equal(isBlockedCaptureHost('192.168.1.1'), true)
  assert.equal(isBlockedCaptureHost('example.com'), false)
})
