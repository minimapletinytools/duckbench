const {contextBridge,ipcRenderer}=require('electron');
const subscribe=(channel,callback)=>{const fn=(_,value)=>callback(value);ipcRenderer.on(channel,fn);return()=>ipcRenderer.removeListener(channel,fn);};
contextBridge.exposeInMainWorld('desktop',{
 readDownloadFile:path=>ipcRenderer.invoke('workspace:download-bytes',path),
 downloadCopy:(name,bytes)=>ipcRenderer.invoke('file:download-copy',name,bytes),
 restoreWorkspace:()=>ipcRenderer.invoke('workspace:restore'),
 ready:()=>ipcRenderer.send('file:ready'),onLaunch:callback=>subscribe('file:launch',callback),
 viewerAssets:()=>ipcRenderer.invoke('viewer:assets'),
 createFolder:name=>ipcRenderer.invoke('workspace:create-folder',name),
 createProjectFile:name=>ipcRenderer.invoke('workspace:create-file',name),
 renameProjectFile:(filename,relative)=>ipcRenderer.invoke('workspace:rename',filename,relative),
 revealFile:path=>ipcRenderer.invoke('workspace:reveal',path),
 saveProjectBuffer:data=>ipcRenderer.invoke('workspace:save-buffer',data),
 agentConfig:()=>ipcRenderer.invoke('agent:config'),
 agentRequest:(id,path,init)=>ipcRenderer.invoke('agent:request',id,path,init),
 abortAgentRequest:id=>ipcRenderer.invoke('agent:abort',id),
 onAgentChunk:callback=>subscribe('agent:chunk',callback),
 authorize:url=>ipcRenderer.invoke('agent:authorize',url),
 startMcp:(scope,instructions)=>ipcRenderer.invoke('agent:start',scope,instructions),
 stopMcp:()=>ipcRenderer.invoke('agent:stop'),
 onMcpCall:callback=>subscribe('agent:call',callback),
 replyMcp:(id,result)=>ipcRenderer.invoke('agent:reply',id,result),
 readProjectText:path=>ipcRenderer.invoke('workspace:agent-text',path),
 trashFile:filename=>ipcRenderer.invoke('file:trash',filename),openFolder:()=>ipcRenderer.invoke('workspace:open'),listFiles:directory=>ipcRenderer.invoke('workspace:list',directory),readFile:filename=>ipcRenderer.invoke('workspace:read',filename),request:request=>ipcRenderer.invoke('runner:request',request),cancel:()=>ipcRenderer.invoke('runner:cancel'),open:()=>ipcRenderer.invoke('file:open'),save:data=>ipcRenderer.invoke('file:save',data),onLog:callback=>subscribe('runner:log',callback),onFileChanged:callback=>subscribe('file:changed',callback)});
