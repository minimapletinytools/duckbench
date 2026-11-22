// Desktop viewer projects are real folders. Only a folder chosen by the user or in recents can be opened.
const fs = require('node:fs');
const path = require('node:path');
const types = /\.(step|stp|stl|html|py|md|txt|json|toml|csv|svg|ya?ml)$/i;
const limit = 128 * 1024 * 1024;
const allowedPart = part => part && !part.startsWith('.') && !['node_modules','__proto__','constructor','prototype'].includes(part) && !/[\\:\x00-\x1f]/.test(part);

function installProjects({app,dialog,ipcMain,window,readModel,buildPreview,reset}) {
  const stateFile = path.join(app.getPath('userData'),'viewer-projects.json');
  let recent=[];
  if(fs.existsSync(stateFile)) recent=JSON.parse(fs.readFileSync(stateFile,'utf8'));
  let current=null;
  function persist(next) {
    fs.mkdirSync(path.dirname(stateFile),{recursive:true});
    fs.writeFileSync(stateFile+'.tmp',JSON.stringify(next));
    fs.renameSync(stateFile+'.tmp',stateFile);
    recent=next;
  }
  function entries(root) {
    const names=[];
    function scan(dir,prefix) {
      for(const item of fs.readdirSync(dir,{withFileTypes:true})) {
        if(!allowedPart(item.name)) continue;
        const name=prefix+item.name;
        if(item.isDirectory()) scan(path.join(dir,item.name),name+'/');
        else if(item.isFile() && types.test(name)) names.push(name);
        if(names.length>10000) throw new Error('Project exceeds 10,000 supported files.');
      }
    }
    scan(root,'');
    return names.sort();
  }
  function open(root,meta={}) {
    root=fs.realpathSync(root);
    const paths=entries(root);
    const record={...recent.find(item=>item.id===root),...meta,id:root,name:path.basename(root),updated:Date.now()};
    persist([record,...recent.filter(item=>item.id!==root)]);
    reset();current=root;
    return {...record,paths};
  }
  function fileAt(root,name) {
    if(typeof name!=='string'||!name.split('/').every(allowedPart)||!types.test(name))throw new Error('Unsupported project file.');
    if(fs.realpathSync(root)!==root)throw new Error('Project folder moved. Open it again.');
    const target=path.join(root,...name.split('/'));
    // Reject links both in the leaf and in any parent before following them.
    let parent=root;
    for(const part of name.split('/')) {
      parent=path.join(parent,part);
      if(fs.existsSync(parent)&&fs.lstatSync(parent).isSymbolicLink())throw new Error('Select a file inside the project folder.');
    }
    return target;
  }
  function add(root,files,modelFiles) {
    const written=[],dirs=[];
    const plans=Object.entries({...files,...modelFiles}).map(([name,data])=>[fileAt(root,name),data]);
    for(const [target] of plans)if(fs.existsSync(target))throw new Error('File already exists: '+path.basename(target));
    try{
      for(const [target,data] of plans){
        const directory=path.dirname(target);
        const missing=fs.mkdirSync(directory,{recursive:true});
        if(missing)dirs.push([missing,directory]);
        fs.writeFileSync(target,data,{flag:'wx'});written.push(target);
      }
    }catch(error){
      for(const file of written)fs.unlinkSync(file);
      for(const [first,last] of dirs.reverse()){
        let dir=last;
        while(dir.startsWith(first)){try{fs.rmdirSync(dir);}catch{break;}if(dir===first)break;dir=path.dirname(dir);}
      }
      throw error;
    }
  }
  async function pickFolder(title) {
    const result=await dialog.showOpenDialog(window(),{title,properties:['openDirectory','createDirectory']});
    return result.filePaths[0];
  }
  function on(method,callback) {
    ipcMain.handle('viewer-project:'+method,(event,...args)=>{
      if(event.senderFrame!==window().webContents.mainFrame)throw new Error('Unknown window.');
      return callback(...args);
    });
  }
  function assertCurrent(id) {
    if(!current||current!==id)throw new Error('Select the project again.');
  }
  on('list',()=>recent);
  on('folder',async()=>{const root=await pickFolder('Open project folder');return root?open(root):null;});
  on('open',id=>{if(!recent.some(item=>item.id===id)||fs.realpathSync(id)!==id)throw new Error('Choose a recent folder.');return open(id);});
  on('close',()=>{reset();current=null;});
  on('forget',id=>{persist(recent.filter(item=>item.id!==id));if(current===id){reset();current=null;}});
  on('create',async(name,files,modelFiles,meta)=>{
    if(typeof name!=='string'||!allowedPart(name)||name.includes('/'))throw new Error('Enter a folder name.');
    const parent=await pickFolder('Choose where to create '+name);
    if(!parent)return null;
    const root=path.join(fs.realpathSync(parent),name);
    fs.mkdirSync(root);
    try{add(root,files,modelFiles);}catch(error){fs.rmdirSync(root);throw error;}
    return open(root,{activeFile:meta.activeFile,runTarget:meta.runTarget});
  });
  on('add',(id,files,modelFiles)=>{assertCurrent(id);add(id,files,modelFiles);return open(id);});
  on('read',async(id,name)=>{
    assertCurrent(id);
    reset();
    const file=fileAt(id,name);
    if(fs.statSync(file).size>limit)throw new Error('File exceeds 128 MiB.');
    return /\.(stp|step|stl|html)$/i.test(name)?{model:await readModel(file)}:{source:fs.readFileSync(file,'utf8')};
  });
  on('build',async(id,name)=>{
    assertCurrent(id);
    if(!/\.py$/i.test(name))throw new Error('Choose a Python model.');
    const {response}=await dialog.showMessageBox(window(),{type:'question',buttons:['Cancel','Build preview'],defaultId:0,cancelId:0,
      message:'Run '+name+' with desktop Python?',detail:'This script and its imports can access your files. Run projects you trust.'});
    if(response!==1)return null;
    assertCurrent(id);reset();return buildPreview(fileAt(id,name));
  });
  on('saveZip',async(filename,bytes)=>{
    const {filePath}=await dialog.showSaveDialog(window(),{title:'Export project ZIP',defaultPath:path.basename(filename),
      filters:[{name:'ZIP archive',extensions:['zip']}]});
    if(!filePath)return false;
    await fs.promises.writeFile(filePath,bytes);return true;
  });
  on('export',id=>{
    assertCurrent(id);
    const files=Object.create(null),modelFiles=Object.create(null);
    let size=0;
    for(const name of entries(id)){
      const file=fileAt(id,name);
      size+=fs.statSync(file).size;
      if(size>limit)throw new Error('Project exceeds the 128 MiB ZIP limit.');
      if(/\.stl$/i.test(name))modelFiles[name]=fs.readFileSync(file);
      else files[name]=fs.readFileSync(file,'utf8');
    }
    return {...recent.find(item=>item.id===id),files,modelFiles};
  });
}
module.exports={installProjects};
