// The retained desktop design app preserves its direct authorization and retry UI.
import { createFigmaOAuthMiddleware as sharedMiddleware, figmaOAuthPlugin as sharedPlugin } from '../../网页端/workbench/server/figma-oauth.mjs'
import type { FigmaOAuthPluginOptions } from '../../网页端/workbench/server/figma-oauth.mjs'
export type { FigmaOAuthPluginOptions }
const desktopOptions = (options: FigmaOAuthPluginOptions): FigmaOAuthPluginOptions => ({
  accountPickerByDefault: false, unconfiguredStartPage: true, ...options,
})
export const createFigmaOAuthMiddleware = (options: FigmaOAuthPluginOptions) => sharedMiddleware(desktopOptions(options))
export const figmaOAuthPlugin = (options: FigmaOAuthPluginOptions) => sharedPlugin(desktopOptions(options))
