import type { AgentAttachment } from '../src/types/agentComposer'

export type WebpageBrief = {
  url: string
  title: string
  description: string
  headings: string[]
  imageUrl?: string
}

const PRIVATE_IPV4 = /^(?:10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[0-1])\.)/

export function isBlockedCaptureHost(hostname: string) {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '')
  if (!host) return true
  if (
    host === 'localhost'
    || host.endsWith('.localhost')
    || host === '0.0.0.0'
    || host === '::1'
    || host === 'metadata.google.internal'
  ) {
    return true
  }
  if (PRIVATE_IPV4.test(host)) return true
  return false
}

function decodeEntities(value: string) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim()
}

function stripTags(value: string) {
  return decodeEntities(value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
}

function metaContent(html: string, key: string) {
  const property = new RegExp(
    `<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']*)["'][^>]*>`,
    'i',
  )
  const contentFirst = new RegExp(
    `<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${key}["'][^>]*>`,
    'i',
  )
  return decodeEntities(property.exec(html)?.[1] ?? contentFirst.exec(html)?.[1] ?? '')
}

function collectHeadings(html: string) {
  const matches = [...html.matchAll(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/gi)]
  const seen = new Set<string>()
  const headings: string[] = []
  for (const match of matches) {
    const text = stripTags(match[1] ?? '').slice(0, 120)
    if (!text || seen.has(text)) continue
    seen.add(text)
    headings.push(text)
    if (headings.length >= 8) break
  }
  return headings
}

export function extractWebpageBrief(html: string, pageUrl: string): WebpageBrief {
  const titleTag = stripTags(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '')
  const title = metaContent(html, 'og:title') || titleTag
  const description = (
    metaContent(html, 'og:description')
    || metaContent(html, 'description')
    || metaContent(html, 'twitter:description')
  ).slice(0, 400)
  const rawImage = metaContent(html, 'og:image') || metaContent(html, 'twitter:image')
  let imageUrl: string | undefined
  if (rawImage) {
    try {
      imageUrl = new URL(rawImage, pageUrl).toString()
    } catch {
      imageUrl = undefined
    }
  }
  return {
    url: pageUrl,
    title: title.slice(0, 200),
    description,
    headings: collectHeadings(html),
    ...(imageUrl ? { imageUrl } : {}),
  }
}

export function buildWebpageCapturePrompt(
  brief: WebpageBrief,
  image?: Pick<AgentAttachment, 'name' | 'path'>,
) {
  const lines = [
    `这是对 ${brief.url} 的静态 HTML 摘要，不是整页截图，也没有还原 DOM 结构。`,
    '请根据这些信息在真实 Figma 里设计对应视觉稿，保留原站信息架构、主视觉和关键模块。',
    '',
    `页面：${brief.url}`,
    brief.title ? `标题：${brief.title}` : '',
    brief.description ? `摘要：${brief.description}` : '',
    brief.headings.length > 0 ? `标题层级：\n${brief.headings.map((item) => `- ${item}`).join('\n')}` : '',
    image?.path
      ? `主视觉参考图已上传：${image.name}（本地路径 ${image.path}，请用 Read 查看）`
      : '',
  ]
  return lines.filter((line) => line !== '').join('\n')
}
