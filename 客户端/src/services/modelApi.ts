import type {
  ModelApiConnectionResult,
  ModelApiDraft,
  ModelApiPublicSettings,
} from '../types/modelApi'

export const MODEL_API_SETTINGS_CHANGED = 'design-studio:model-api-change'

export function hasDesktopModelApiSettings(): boolean {
  const host = typeof window === 'undefined' ? undefined : window.designStudioHost
  return Boolean(
    host?.getModelApiSettings
    && host.saveModelApiSettings
    && host.clearModelApiSettings
    && host.testModelApiSettings,
  )
}

function desktopHost() {
  if (!hasDesktopModelApiSettings()) throw new Error('请在 Astrix 客户端中配置。')
  return window.designStudioHost!
}

export async function getModelApiSettings(): Promise<ModelApiPublicSettings> {
  return desktopHost().getModelApiSettings!()
}

export async function saveModelApiSettings(draft: ModelApiDraft): Promise<ModelApiPublicSettings> {
  const settings = await desktopHost().saveModelApiSettings!(draft)
  window.dispatchEvent(new Event(MODEL_API_SETTINGS_CHANGED))
  return settings
}

export async function clearModelApiSettings(): Promise<ModelApiPublicSettings> {
  const settings = await desktopHost().clearModelApiSettings!()
  window.dispatchEvent(new Event(MODEL_API_SETTINGS_CHANGED))
  return settings
}

export async function testModelApiSettings(draft: ModelApiDraft): Promise<ModelApiConnectionResult> {
  return desktopHost().testModelApiSettings!(draft)
}
