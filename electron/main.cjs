const {app,BrowserWindow,ipcMain,dialog,shell}=require('electron');
const {spawn}=require('node:child_process');
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
ipcMain.handle('file:open',async()=>{const {canceled,filePaths}=await dialog.showOpenDialog(win,{filters:[{name:'Python',extensions:['py']}],properties:['openFile']});if(canceled)return null;const filename=filePaths[0];watch(filename);return {filename,code:fs.readFileSync(filename,'utf8')};});
ipcMain.handle('file:save',async(_,data)=>{let filename=data.filename;if(!path.isAbsolute(filename)||filename!==watchedFile){const picked=await dialog.showSaveDialog(win,{defaultPath:path.basename(filename||'model.py'),filters:[{name:'Python',extensions:['py']}]});if(picked.canceled)return null;filename=picked.filePath;}fs.writeFileSync(filename,data.code);watch(filename);return filename;});
function workspacePath(filename){
 if(!workspace)throw new Error('Open a folder first.');
 const resolved=fs.realpathSync(filename);
 const relative=path.relative(workspace,resolved);
 if(relative.startsWith('..') || path.isAbsolute(relative))throw new Error('File is outside the open folder.');
 return resolved;
}
function entries(directory){
 return fs.readdirSync(directory,{withFileTypes:true}).filter(item=>!item.name.startsWith('.') && item.name!=='node_modules' && item.name!=='release').filter(item=>item.isDirectory() || item.isFile()).map(item=>({name:item.name,path:path.join(directory,item.name),directory:item.isDirectory()})).sort((a,b)=>Number(b.directory)-Number(a.directory)||a.name.localeCompare(b.name));
}
ipcMain.handle('workspace:open',async()=>{
 const picked=await dialog.showOpenDialog(win,{properties:['openDirectory']});
 if(picked.canceled)return null;
 workspace=fs.realpathSync(picked.filePaths[0]);
 return {root:workspace,name:path.basename(workspace),entries:entries(workspace)};
});
ipcMain.handle('workspace:list',(_,directory)=>entries(workspacePath(directory)));
ipcMain.handle('workspace:read',(_,filename)=>{filename=workspacePath(filename);const code=fs.readFileSync(filename,'utf8');watch(filename);return {filename,code};});
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
app.whenReady().then(()=>{win=new BrowserWindow({width:1450,height:920,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});win.webContents.setWindowOpenHandler(({url})=>{if(url.startsWith('https://'))shell.openExternal(url);return {action:'deny'};});win.webContents.on('will-navigate',event=>event.preventDefault());win.loadFile(path.join(root,'dist/index.html'));});
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',()=>{watcher?.close();stop();});
