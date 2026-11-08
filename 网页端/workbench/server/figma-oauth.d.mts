import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import type { Server } from 'node:http'

export type FigmaCatalogCandidate = { url: string; projectId?: string | number; accountId?: string }
export type FigmaCatalogFile = { key: string; name: string; url: string; thumbnailUrl: string | null; lastModified: string | null; editorType: string | null; accountId: string; source: string; projectId?: string | number }
export type FigmaOAuthMiddleware = ((request: IncomingMessage, response: ServerResponse, next: () => void) => void) & {
  resolveCatalogFile(request: IncomingMessage, response: ServerResponse, url: string): Promise<{ accountId: string; file: FigmaCatalogFile }>
  getCatalogContext(request: IncomingMessage, response: ServerResponse): Promise<{ accountId: string; user: { id: string; name: string } }>
  setCatalogCandidates(callback?: (context: { accountId: string }) => Promise<FigmaCatalogCandidate[]> | FigmaCatalogCandidate[]): void
}

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
  getCatalogCandidates?: (context: { accountId: string }) => Promise<FigmaCatalogCandidate[]> | FigmaCatalogCandidate[]
}

export function createFigmaOAuthMiddleware(options: FigmaOAuthPluginOptions): FigmaOAuthMiddleware
export function getFigmaOAuthMiddlewareForServer(server: Server | null | undefined): FigmaOAuthMiddleware | null
export function figmaOAuthPlugin(options: FigmaOAuthPluginOptions): Plugin
