import { query } from '@anthropic-ai/claude-agent-sdk'

const started = Date.now()
console.log('start')

const stream = query({
  prompt: '只回复一个词：ok。不要使用任何工具。',
  options: {
    cwd: process.cwd(),
    model: 'haiku',
    executable: 'node',
    settingSources: ['user'],
    systemPrompt: '你是简短助手。',
    allowedTools: [],
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    maxTurns: 1,
  },
})

for await (const event of stream) {
  const type = event?.type
  console.log(`[${Date.now() - started}ms] ${type}`)
  if (type === 'assistant') {
    const content = event.message?.content
    console.log('assistant content:', JSON.stringify(content))
    console.log('assistant error field:', event.error)
  }
  if (type === 'result') {
    console.log('result.is_error', event.is_error)
    console.log('result.subtype', event.subtype)
    console.log('result.terminal_reason', event.terminal_reason)
    console.log('result.result', event.result)
    console.log('result.errors', event.errors)
    break
  }
  if (type === 'auth_status' || type === 'system') {
    console.log(JSON.stringify(event).slice(0, 500))
  }
}
