const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('zaimUpdates', {
  state: () => ipcRenderer.invoke('zaim:update-state'),
  check: () => ipcRenderer.invoke('zaim:update-check'),
  download: () => ipcRenderer.invoke('zaim:update-download'),
  install: () => ipcRenderer.invoke('zaim:update-install'),
  subscribe: callback => {
    const listener = (_event, state) => callback(state)
    ipcRenderer.on('zaim:update-state', listener)
    return () => ipcRenderer.removeListener('zaim:update-state', listener)
  },
})
