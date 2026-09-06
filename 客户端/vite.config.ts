import { defineConfig, loadEnv, type ProxyOptions } from 'vite'
import react from '@vitejs/plugin-react'
import { agentPlugin } from './server/agentPlugin'
import { figmaBridgePlugin } from './server/figmaBridgePlugin'
import { figmaOAuthPlugin } from './server/figmaOAuthPlugin'
import { figmaRecentsPlugin } from './server/figmaRecentsPlugin'
import { desktopStatusPlugin } from './server/desktopStatusPlugin'
import { webCapturePlugin } from './server/webCapturePlugin'

const DEFAULT_FIGMA_OAUTH_REDIRECT_URI =
  'http://127.0.0.1:5273/api/auth/figma/callback'
const DEFAULT_AGENT_MODEL = 'auto'

const figmaProxy = (): ProxyOptions => ({
  target: 'https://api.figma.com',
  changeOrigin: true,
  rewrite: (path) => path.replace(/^\/api\/figma/, '/v1'),
  configure: (proxy) => {
    proxy.on('proxyReq', (proxyReq, req) => {
      const token = req.headers['x-design-studio-figma-token']
      if (typeof token === 'string' && token) proxyReq.setHeader('X-Figma-Token', token)
      proxyReq.removeHeader('x-design-studio-figma-token')
    })
  },
})

function resolveAgentBackend(
  value: string | undefined,
): 'auto' | 'codex' | 'claude' | 'hermes' | 'shell' {
  const normalized = (value ?? 'auto').trim().toLowerCase()
  if (
    normalized === 'codex'
    || normalized === 'claude'
    || normalized === 'hermes'
    || normalized === 'shell'
    || normalized === 'auto'
  ) {
    return normalized
  }
  return 'auto'
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [
      react(),
      desktopStatusPlugin(),
      agentPlugin({
        backend: resolveAgentBackend(env.AGENT_BACKEND),
        model: env.AGENT_MODEL?.trim() || DEFAULT_AGENT_MODEL,
        allowDemoFallback: env.AGENT_ALLOW_DEMO_FALLBACK === '1',
      }),
      figmaBridgePlugin(),
      webCapturePlugin(),
      figmaOAuthPlugin({
        clientId: env.FIGMA_OAUTH_CLIENT_ID?.trim() ?? '',
        clientSecret: env.FIGMA_OAUTH_CLIENT_SECRET?.trim() ?? '',
        redirectUri:
          env.FIGMA_OAUTH_REDIRECT_URI?.trim()
          || DEFAULT_FIGMA_OAUTH_REDIRECT_URI,
        teamIds: (env.FIGMA_TEAM_IDS ?? '')
          .split(/[,\s]+/)
          .map((item) => item.trim())
          .filter(Boolean),
      }),
      figmaRecentsPlugin(),
    ],
    server: {
      port: 5273,
      host: '127.0.0.1',
      proxy: { '/api/figma': figmaProxy() },
    },
    preview: {
      port: 5273,
      host: '127.0.0.1',
      proxy: { '/api/figma': figmaProxy() },
    },
  }
})
