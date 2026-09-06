import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld(
  'designStudioHost',
  Object.freeze({
    updateProfile(profile: unknown) {
      ipcRenderer.send('desktop-profile:update', profile)
    },
    onChromeAction(listener: (action: string) => void) {
      const wrapped = (_event: unknown, action: string) => listener(action)
      ipcRenderer.on('desktop-home:chrome-action', wrapped)
      return () => ipcRenderer.removeListener('desktop-home:chrome-action', wrapped)
    },
    openFigmaLayer(payload: unknown) {
      ipcRenderer.send('desktop-home:open-figma', payload)
    },
    onOpenStudio(listener: (payload: unknown) => void) {
      const wrapped = (_event: unknown, payload: unknown) => listener(payload)
      ipcRenderer.on('desktop-home:open-studio', wrapped)
      return () => {
        ipcRenderer.removeListener('desktop-home:open-studio', wrapped)
      }
    },
    clearFigmaWebSession() {
      return ipcRenderer.invoke('desktop-home:clear-figma-session') as Promise<boolean>
    },
  }),
)
