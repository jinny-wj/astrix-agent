import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'

export const DESKTOP_APP_ID = 'design-studio-wj'
export const DESKTOP_PROTOCOL_VERSION = 1

export function createDesktopStatusMiddleware() {
  return (
    request: IncomingMessage,
    response: ServerResponse,
    next: () => void,
  ) => {
    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (
      request.method !== 'GET'
      || requestUrl.pathname !== '/api/desktop/status'
    ) {
      next()
      return
    }

    response.statusCode = 200
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('Content-Type', 'application/json; charset=utf-8')
    response.end(JSON.stringify({
      ok: true,
      app: DESKTOP_APP_ID,
      protocolVersion: DESKTOP_PROTOCOL_VERSION,
    }))
  }
}

export function desktopStatusPlugin(): Plugin {
  const middleware = createDesktopStatusMiddleware()
  return {
    name: 'design-studio-desktop-status',
    configureServer(server) {
      server.middlewares.use(middleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware)
    },
  }
}
