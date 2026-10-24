'use strict';

// A small new preload, deliberately independent of the recovered IPC bundle.
const { contextBridge, ipcRenderer } = require('electron');
const windowCall = (method) => ipcRenderer.invoke('m0-local:window', method);
const chooseWorkspace = (initialPath) => ipcRenderer.invoke('m0-local:choose-workspace', initialPath);

contextBridge.exposeInMainWorld('m0LocalDesktop', Object.freeze({
  isDesktop: true,
  chooseWorkspace,
  openCanvasWindow: value => ipcRenderer.invoke('m0-local:open-canvas-window', value),
  minimize: () => windowCall('minimize'),
  toggleMaximize: () => windowCall('toggleMaximize'),
  close: () => windowCall('close'),
  getInfo: () => windowCall('getInfo'),
  getBaseURL: () => windowCall('getBaseURL'),
  figmaHost: Object.freeze({
    available: () => ipcRenderer.invoke('m0-local:figma-host','available'),
    show: value => ipcRenderer.invoke('m0-local:figma-host','show',value),
    hide: () => ipcRenderer.invoke('m0-local:figma-host','hide'),
    updateBounds: bounds => ipcRenderer.invoke('m0-local:figma-host','updateBounds',bounds),
    getStatus: () => ipcRenderer.invoke('m0-local:figma-host','getStatus'),
    openExternal: url => ipcRenderer.invoke('m0-local:figma-host','openExternal',url),
    revealBridgePlugin: value => ipcRenderer.invoke('m0-local:figma-host','revealBridgePlugin',value),
    onStatus: callback => {
      if(typeof callback!=='function')return()=>{};
      const listener=(_event,status)=>callback(status);
      ipcRenderer.on('m0-local:figma-status',listener);
      return()=>ipcRenderer.removeListener('m0-local:figma-status',listener);
    },
  }),
  nativeEditor: Object.freeze({
    available: () => ipcRenderer.invoke('m0-local:native-editor', 'available'),
    show: value => ipcRenderer.invoke('m0-local:native-editor', 'show', value),
    hide: () => ipcRenderer.invoke('m0-local:native-editor', 'hide'),
    updateBounds: bounds => ipcRenderer.invoke('m0-local:native-editor', 'updateBounds', bounds),
    getStatus: () => ipcRenderer.invoke('m0-local:native-editor', 'getStatus'),
    marketplaceStatus: () => ipcRenderer.invoke('m0-local:native-editor', 'marketplaceStatus'),
    openTerminal: () => ipcRenderer.invoke('m0-local:native-editor', 'openTerminal'),
    showExtensions: () => ipcRenderer.invoke('m0-local:native-editor', 'showExtensions'),
    installVSIX: () => ipcRenderer.invoke('m0-local:native-editor', 'installVSIX'),
  }),
}));
// Business APIs are authored by public/local-runtime.js for both browser and
// desktop. Defining incomplete versions here would suppress those adapters.
// No window.electron flag: the recovered frontend continues its web startup path.
