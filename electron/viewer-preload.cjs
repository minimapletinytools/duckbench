const {contextBridge,ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('cadViewer',{
  open: () => ipcRenderer.send('viewer:open'),
  ready: () => ipcRenderer.send('viewer:ready'),
  onModel: callback => ipcRenderer.on('viewer:model', (_event, model) => callback(model)),
});
