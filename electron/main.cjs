const {app,BrowserWindow,ipcMain,dialog,shell}=require('electron');
const {spawn,execFile}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
let win,child,watcher,watchedFile,workspace,next=0,buffer='';
const pending=new Map();
const openedFiles=new Set();
function stop(){const old=child;child=null;old?.kill('SIGKILL');for(const p of pending.values())p.reject(new Error('Python stopped. Run again to restart.'));pending.clear();buffer='';}
function start(){
 if(child)return;
 const python=process.env.BUILD1234_PYTHON || (app.isPackaged ? path.join(process.resourcesPath,'python',process.platform==='win32'?'python.exe':'bin/python3') : path.join(root,'.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python'));
 if(!fs.existsSync(python))throw new Error('Python environment missing. Run uv sync in the project, or set BUILD1234_PYTHON to a Python executable with build123d and ocp-tessellate installed.');
 child=spawn(python,['-u',path.join(app.isPackaged ? root.replace(/\.asar$/,'.asar.unpacked') : root,'python/runner.py')],{stdio:['pipe','pipe','pipe']});
 const current=child;
 current.stdout.setEncoding('utf8');
 current.stdout.on('data',chunk=>{buffer+=chunk;let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);try{const msg=JSON.parse(line),p=pending.get(msg.id);if(p){pending.delete(msg.id);msg.error?p.reject(new Error(msg.error)):p.resolve(msg.result);}}catch{win.webContents.send('runner:log',line+'\n');}}});
 current.stderr.on('data',chunk=>win?.webContents.send('runner:log',chunk.toString()));
 current.on('error',error=>{if(child===current){for(const p of pending.values())p.reject(error);stop();}});
 current.on('exit',()=>{if(child===current)stop();});
}
function watch(filename){
 openedFiles.add(fs.realpathSync(filename));
 watcher?.close();watchedFile=filename;
 let timer;
 watcher=fs.watch(path.dirname(filename),(_,name)=>{if(name&&name.toString()!==path.basename(filename))return;clearTimeout(timer);timer=setTimeout(()=>{try{win.webContents.send('file:changed',{filename,code:fs.readFileSync(filename,'utf8')});}catch{}},200);});
}
ipcMain.handle('runner:request',(_,request)=>{start();const id=++next;return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});child.stdin.write(JSON.stringify({...request,id})+'\n');});});
ipcMain.handle('runner:cancel',()=>stop());
const modelExt=/\.(step|stp|stl|html)$/i;
const fileTypes=[{name:'Duckbench files',extensions:['py','step','stp','stl','html','txt','json','csv','md','toml','svg']}];
async function readDocument(filename){
 if(!modelExt.test(filename)){watch(filename);return {filename,code:fs.readFileSync(filename,'utf8')};}
 let model;
 if(/\.html$/i.test(filename)){
   const html=await fs.promises.readFile(filename,'utf8');
   const data=html.match(/<script type="application\/json" id="duckbench-scene">([\s\S]*?)<\/script>/);
   if(!data)throw new Error('Choose a viewer HTML exported by Duckbench.');
   model=JSON.parse(data[1]);
 }else{
   const python=process.env.BUILD1234_PYTHON || (app.isPackaged ? path.join(process.resourcesPath,'python',process.platform==='win32'?'python.exe':'bin/python3') : path.join(root,'.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python'));
   const script=path.join(app.isPackaged?root.replace(/\.asar$/,'.asar.unpacked'):root,'python/viewer_import.py');
   model=await new Promise((resolve,reject)=>execFile(python,['-I',script,filename],{maxBuffer:256*1024*1024},(err,out,log)=>{
     if(err)return reject(new Error(log.trim().split('\n').pop()||err.message));
     try{resolve(JSON.parse(out));}catch(error){reject(error);}
   }));
 }
 return {filename,model};
}
ipcMain.handle('file:open',async()=>{
 const pick=await dialog.showOpenDialog(win,{filters:fileTypes,properties:['openFile']});
 return pick.filePaths[0]?readDocument(pick.filePaths[0]):null;
});
let queued=process.argv.slice(1).find(arg=>!arg.startsWith('-')&&modelExt.test(arg)),rendererReady=false;
async function deliver(){
 if(!rendererReady||!queued)return;
 const file=queued;queued=null;
 try{win.webContents.send('file:launch',await readDocument(path.resolve(file)));}
 catch(error){win.webContents.send('file:launch',{error:error.message});}
}
app.on('open-file',(event,file)=>{event.preventDefault();queued=file;void deliver();});
ipcMain.on('file:ready',()=>{rendererReady=true;void deliver();});
ipcMain.handle('file:save',async(_,data)=>{let filename=data.filename;if(!path.isAbsolute(filename)||filename!==watchedFile){const picked=await dialog.showSaveDialog(win,{defaultPath:path.join(workspace||'',path.basename(filename||'model.py')),filters:[{name:'Python',extensions:['py']}]});if(picked.canceled)return null;filename=picked.filePath;}fs.writeFileSync(filename,data.code);filename=fs.realpathSync(filename);watch(filename);return filename;});
function workspacePath(filename){
 if(!workspace)throw new Error('Open a folder first.');
 const resolved=fs.realpathSync(filename);
 const relative=path.relative(workspace,resolved);
 if(relative.startsWith('..') || path.isAbsolute(relative))throw new Error('File is outside the open folder.');
 return resolved;
}
function explorerName(name){return !name.startsWith('.') && name!=='node_modules' && name!=='release';}
function explorerPath(filename){
 const target=workspacePath(filename);
 if(path.relative(workspace,target).split(path.sep).some(part=>!explorerName(part)))throw new Error('Select a file or folder in Explorer.');
 return target;
}
function entries(directory){
 return fs.readdirSync(directory,{withFileTypes:true}).filter(item=>explorerName(item.name)).filter(item=>item.isDirectory() || item.isFile()).map(item=>({name:item.name,path:path.join(directory,item.name),directory:item.isDirectory()})).sort((a,b)=>Number(b.directory)-Number(a.directory)||a.name.localeCompare(b.name));
}
function workspaceStateFile(){return path.join(app.getPath('userData'),'workbench-workspace.json');}
function enterWorkspace(dir){
 const root=fs.realpathSync(dir),children=entries(root);
 if(workspace!==root){watcher?.close();watcher=null;watchedFile=null;workspace=root;}
 return {root,name:path.basename(root),entries:children};
}
ipcMain.handle('workspace:open',async()=>{
 const picked=await dialog.showOpenDialog(win,{title:'Open workspace folder',properties:['openDirectory','createDirectory']});
 if(!picked.filePaths[0])return null;
 const folder=enterWorkspace(picked.filePaths[0]);
 fs.writeFileSync(workspaceStateFile(),JSON.stringify({root:folder.root}));
 return folder;
});
ipcMain.handle('workspace:restore',()=>{
 try{return enterWorkspace(JSON.parse(fs.readFileSync(workspaceStateFile(),'utf8')).root);}
 catch{return null;}
});
ipcMain.handle('workspace:list',(_,directory)=>entries(explorerPath(directory)));
ipcMain.handle('workspace:download-bytes',(_,filename)=>fs.promises.readFile(explorerPath(filename)));
ipcMain.handle('file:download-copy',async(_,name,bytes)=>{
 const picked=await dialog.showSaveDialog(win,{title:'Download a copy',defaultPath:path.basename(name)});
 if(picked.filePath)await fs.promises.writeFile(picked.filePath,bytes);
});
ipcMain.handle('workspace:read',(_,filename)=>readDocument(explorerPath(filename)));
ipcMain.handle('workspace:agent-text', (_,filename) => {
 const target=explorerPath(filename);
 if(!/\.(py|json|txt|csv|svg|step|stp|md|toml|yaml|yml)$/i.test(target)) throw new Error('Select a project text file.');
 const stat=fs.statSync(target);
 if(!stat.isFile() || stat.size>4*1024*1024) throw new Error('Select a text file under 4 MiB.');
 return fs.readFileSync(target,'utf8');
});
ipcMain.handle('workspace:create-folder',(_,relative)=>{
 if(typeof relative!=='string'||path.isAbsolute(relative)||relative.split(/[\\/]/).some(part=>!part||!explorerName(part)))throw new Error('Enter a workspace-relative folder name.');
 let parent=workspace;
 for(const part of relative.split(/[\\/]/)){
   parent=path.join(explorerPath(parent),part);
   if(!fs.existsSync(parent))fs.mkdirSync(parent);
   else if(!fs.lstatSync(parent).isDirectory())throw new Error('A file already uses that name.');
 }
 return parent;
});
ipcMain.handle('workspace:create-file',(_,relative)=>{
 if(typeof relative!=='string'||path.isAbsolute(relative)||relative.split(/[\\/]/).some(part=>!part||!explorerName(part)||part==='..'))throw new Error('Enter a project-relative name.');
 const parent=explorerPath(path.join(workspace,path.dirname(relative)));
 const target=path.join(parent,path.basename(relative));
 fs.writeFileSync(target,'',{flag:'wx'});watch(target);return target;
});
ipcMain.handle('workspace:rename',(_,filename,relative)=>{
 const source=explorerPath(filename);
 if(!fs.lstatSync(source).isFile())throw new Error('Only files can be renamed.');
 if(typeof relative!=='string'||path.isAbsolute(relative)||relative.split(/[\\/]/).some(part=>!part||!explorerName(part)||part==='..'))throw new Error('Enter a project-relative name.');
 let parent=workspace;
 for(const part of relative.split(/[\\/]/).slice(0,-1)){
   parent=path.join(explorerPath(parent),part);
   if(!fs.existsSync(parent))fs.mkdirSync(parent);
   else if(!fs.lstatSync(parent).isDirectory())throw new Error('A file already uses that folder name.');
 }
 const target=path.join(explorerPath(parent),path.basename(relative));
 if(fs.existsSync(target))throw new Error(relative+' already exists.');
 fs.renameSync(source,target);return target;
});
ipcMain.handle('workspace:reveal',(_,filename)=>shell.showItemInFolder(explorerPath(filename)));
ipcMain.handle('workspace:save-buffer',(_,data)=>{
 const target=explorerPath(data.filename);
 if(fs.readFileSync(target,'utf8')!==data.saved)throw new Error(path.basename(target)+' changed on disk. Reopen it before saving.');
 fs.writeFileSync(target,data.code,'utf8');
});
ipcMain.handle('viewer:assets',()=>JSON.parse(fs.readFileSync(path.join(root,'dist/standalone/renderer.json'),'utf8')));
ipcMain.handle('file:trash',async(_,filename)=>{
 if(typeof filename!=='string'||!path.isAbsolute(filename))throw new Error('Select an existing file first.');
 // Only regular files explicitly opened by the user or inside the selected workspace.
 if(!fs.lstatSync(filename).isFile())throw new Error('Only regular files can be moved to Trash.');
 const resolved=fs.realpathSync(filename);
 if(!openedFiles.has(resolved))workspacePath(filename);
 await shell.trashItem(resolved);
 openedFiles.delete(resolved);
 if(watchedFile===filename||watchedFile===resolved){watcher?.close();watcher=null;watchedFile=null;}
});
app.whenReady().then(()=>{const icon=path.join(root,'dist/icons/duck-512.png');if(process.platform==='darwin')app.dock?.setIcon(icon);win=new BrowserWindow({icon,width:1450,height:920,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});win.webContents.setWindowOpenHandler(({url})=>{if(url.startsWith('https://'))shell.openExternal(url);return {action:'deny'};});win.webContents.on('will-navigate',event=>event.preventDefault());require('./agent.cjs').installAgent({win,ipcMain,shell});win.loadFile(path.join(root,'dist/index.html'));});
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',()=>{watcher?.close();stop();});
