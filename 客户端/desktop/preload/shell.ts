import { contextBridge, ipcRenderer } from 'electron'

type StateListener = (state: unknown) => void

contextBridge.exposeInMainWorld(
  'desktopWorkspace',
  Object.freeze({
    action(action: string, value?: string) {
      ipcRenderer.send('desktop-shell:action', action, value)
    },
    onState(listener: StateListener) {
      if (typeof listener !== 'function') return () => {}
      const wrapped = (_event: Electron.IpcRendererEvent, state: unknown) => {
        listener(state)
      }
      ipcRenderer.on('desktop-shell:state', wrapped)
      return () => ipcRenderer.removeListener('desktop-shell:state', wrapped)
    },
  }),
)
