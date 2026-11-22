const {contextBridge,ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('cadViewer',{
  open: () => ipcRenderer.send('viewer:open'),
  projects:Object.fromEntries(['list','folder','create','open','close','forget','read','export','add','build','saveZip'].map(name=>
    [name,(...args)=>ipcRenderer.invoke('viewer-project:'+name,...args)])),
  ready: () => ipcRenderer.send('viewer:ready'),
  onModel: callback => ipcRenderer.on('viewer:model', (_event, model) => callback(model)),
});
