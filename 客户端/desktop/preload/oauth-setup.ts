import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('figmaOAuthSetup', Object.freeze({
  save(payload: { clientId: string; clientSecret: string }) {
    return ipcRenderer.invoke('desktop-oauth:save', {
      clientId: payload.clientId,
      clientSecret: payload.clientSecret,
    }) as Promise<{ ok: boolean; message?: string }>
  },
}))
