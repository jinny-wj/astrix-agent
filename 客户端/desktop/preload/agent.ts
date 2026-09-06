import { contextBridge, ipcRenderer } from 'electron'

type IntentListener = (intent: unknown) => void

contextBridge.exposeInMainWorld(
  'designStudioAgentHost',
  Object.freeze({
    hidePanel() {
      ipcRenderer.send('desktop-agent:hide')
    },
    onUiAction(listener: (action: string) => void) {
      const wrapped = (_event: Electron.IpcRendererEvent, action: string) => {
        if (action === 'skills' || action === 'close-menu') listener(action)
      }
      ipcRenderer.on('desktop-agent:ui-action', wrapped)
      return () => ipcRenderer.removeListener('desktop-agent:ui-action', wrapped)
    },
    updateProfile(profile: unknown) {
      ipcRenderer.send('desktop-profile:update', profile)
    },
    installBridge() {
      ipcRenderer.send('desktop-agent:install-bridge')
    },
    getIntent() {
      return ipcRenderer.invoke('desktop-agent:get-intent')
    },
    getContext() {
      return ipcRenderer.invoke('desktop-agent:get-context')
    },
    onIntent(listener: IntentListener) {
      if (typeof listener !== 'function') return () => {}
      const wrapped = (_event: Electron.IpcRendererEvent, intent: unknown) => {
        listener(intent)
      }
      ipcRenderer.on('desktop-agent:intent', wrapped)
      return () => ipcRenderer.removeListener('desktop-agent:intent', wrapped)
    },
    onContext(listener: IntentListener) {
      if (typeof listener !== 'function') return () => {}
      const wrapped = (_event: Electron.IpcRendererEvent, context: unknown) => {
        listener(context)
      }
      ipcRenderer.on('desktop-agent:context', wrapped)
      return () => ipcRenderer.removeListener('desktop-agent:context', wrapped)
    },
    openNewCanvas(intent?: { skill?: string; prompt?: string }) {
      ipcRenderer.send('desktop-agent:open-new-canvas', intent ?? {})
    },
  }),
)
