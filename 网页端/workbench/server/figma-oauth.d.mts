import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'

export type FigmaOAuthPluginOptions = {
  clientId: string
  clientSecret: string
  redirectUri: string
  teamIds?: string[]
  dataDirectory?: string
  cookieNamespace?: string
  allowedOrigin?: string
  accountPickerByDefault?: boolean
  unconfiguredStartPage?: boolean
}

export function createFigmaOAuthMiddleware(options: FigmaOAuthPluginOptions): (
  request: IncomingMessage,
  response: ServerResponse,
  next: () => void,
) => void
export function figmaOAuthPlugin(options: FigmaOAuthPluginOptions): Plugin
