import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { ModelApiSettings } from '../src/types/modelApi.ts'
import type { FigmaOAuthSecureStorage } from './figmaOAuthSettings.ts'
import {
  clearModelApiSettings,
  normalizeModelApiDraft,
  publicModelApiSettings,
  readModelApiSettings,
  saveModelApiSettings,
} from './modelApiSettings.ts'
import { testModelApiConnection } from '../server/agent/modelApiRuntime.ts'

export function registerModelApiIpc(ipc: Pick<IpcMain, 'handle'>, options: {
  isTrusted: (event: IpcMainInvokeEvent) => boolean
  dataDirectory: string
  secureStorage: FigmaOAuthSecureStorage
  getServer: () => { configureModelApi(settings: ModelApiSettings | null): void } | null
}) {
  // Serialize reads and mutations so a delayed save cannot undo a later clear.
  let pending: Promise<unknown> = Promise.resolve()
  const register = (channel: string, action: (payload: unknown) => Promise<unknown>) => {
    ipc.handle(channel, (event, payload: unknown) => {
      if (!options.isTrusted(event)) throw new Error('无法访问 AI 模型配置。')
      const result = pending.then(() => action(payload))
      pending = result.catch(() => undefined)
      return result
    })
  }
  const read = () => readModelApiSettings(options.dataDirectory, options.secureStorage)
  const server = () => {
    const active = options.getServer()
    if (!active) throw new Error('请关闭其他 Astrix 实例，再重新打开客户端后配置。')
    return active
  }

  register('desktop-model-api:get', async () => publicModelApiSettings(await read()))
  register('desktop-model-api:save', async payload => {
    const active = server()
    const settings = await saveModelApiSettings(options.dataDirectory, payload, options.secureStorage)
    active.configureModelApi(settings)
    return publicModelApiSettings(settings)
  })
  register('desktop-model-api:clear', async () => {
    const active = server()
    await clearModelApiSettings(options.dataDirectory)
    active.configureModelApi(null)
    return publicModelApiSettings(null)
  })
  register('desktop-model-api:test', async payload => {
    server()
    const settings = normalizeModelApiDraft(payload, await read())
    // Test the entered draft without saving it or enabling it for chat.
    const complete = normalizeModelApiDraft({ ...settings, enabled: true }, null)
    return testModelApiConnection(complete)
  })
}
