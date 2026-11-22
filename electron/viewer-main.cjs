const {app, BrowserWindow, dialog, ipcMain, Menu} = require('electron');
const {execFile} = require('node:child_process');
const {readFile} = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const extensions = ['step','stp','stl','html'];
const supported = name => extensions.includes(path.extname(name).slice(1).toLowerCase());
let queued = process.argv.slice(1).find(arg => !arg.startsWith('-') && supported(arg));
let win, ready = false, generation = 0, child;

function pythonRequest(script,args,input) {
  const python = process.env.BUILD1234_PYTHON || path.join(app.isPackaged ? path.join(process.resourcesPath,'python') : path.join(root,'.venv'),
    process.platform === 'win32' ? (app.isPackaged ? 'python.exe' : 'Scripts/python.exe') : 'bin/python3');
  const importer = path.join(app.isPackaged ? process.resourcesPath : root,'python',script);
  return new Promise((resolve,reject) => {
    child = execFile(python,['-I',importer,...args],{maxBuffer:256*1024*1024},(error,stdout,stderr) => {
      if (error) return reject(new Error(stderr.trim().split('\n').pop() || error.message));
      try { resolve(JSON.parse(stdout)); } catch { reject(new Error('Could not decode the imported geometry.')); }
    });
    child.stdin.on('error',()=>{});
    child.stdin.end(input);
  });
}
async function buildPreview(filename){
  const code=await readFile(filename,'utf8');
  const response=await pythonRequest('runner.py',[],JSON.stringify({id:1,method:'run',params:{filename,code}})+'\n');
  if(response.error)throw new Error(response.error);
  return {name:path.basename(filename),version:1,scene:response.result.scene};
}
async function readModel(filename) {
  if (path.extname(filename).toLowerCase() !== '.html') {
    if (!supported(filename)) throw new Error('Choose a STEP, STL or Duckbench HTML file.');
    return pythonRequest('viewer_import.py',[filename]);
  }
  const html = await readFile(filename,'utf8');
  const match = html.match(/<script type="application\/json" id="duckbench-scene">([\s\S]*?)<\/script>/);
  if (!match) throw new Error('Select an HTML viewer exported from Duckbench.');
  return JSON.parse(match[1]);
}
async function openFile(filename) {
  if (!ready) { queued = filename; return; }
  const id = ++generation;
  child?.kill();
  win.webContents.send('viewer:model',{message:'Opening ' + path.basename(filename) + '…'});
  try {
    const model=await readModel(filename);
    if (id === generation) win.webContents.send('viewer:model',{model});
  } catch (error) {
    if (id === generation) win.webContents.send('viewer:model',{message:error.message});
  }
}
async function choose() {
  const {filePaths} = await dialog.showOpenDialog(win,{properties:['openFile'],filters:[{name:'CAD models and Duckbench scenes',extensions}]});
  if (filePaths[0]) await openFile(filePaths[0]);
}
app.on('open-file',(event,file) => { event.preventDefault(); void openFile(file); });
app.whenReady().then(() => {
  win = new BrowserWindow({title:'Duckbench Viewer',width:1150,height:810,webPreferences:{
    sandbox:true,contextIsolation:true,nodeIntegration:false,preload:path.join(__dirname,'viewer-preload.cjs'),
  }});
  win.webContents.setWindowOpenHandler(() => ({action:'deny'}));
  win.webContents.on('will-navigate',event => event.preventDefault());
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{role:'appMenu'}] : []),
    {label:'File',submenu:[{label:'Open model…',accelerator:'CmdOrCtrl+O',click:choose},{role:'close'}]},
    {role:'viewMenu'},
  ]));
  ipcMain.on('viewer:open',event => { if (event.senderFrame === win.webContents.mainFrame) void choose(); });
  ipcMain.on('viewer:ready',event => {
    if (event.senderFrame !== win.webContents.mainFrame) return;
    ready = true;
    if (queued) { const file = queued; queued = null; void openFile(path.resolve(file)); }
  });
  require('./viewer-projects.cjs').installProjects({app,dialog,ipcMain,window:()=>win,readModel,buildPreview,
    reset:()=>{generation++;child?.kill();}});
  win.loadFile(path.join(root,'dist','viewer','index.html'));
  win.on('closed',() => { generation++; ready = false; child?.kill(); });
});
app.on('window-all-closed',() => app.quit());
