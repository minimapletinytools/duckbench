import './style.css';
import {viewerPage} from './standalone/template.js';
import {validPath} from './agent/tools.js';
import {bindTreeKeyboard,requestFilename} from './workspace-controls.js';
import {createAgentPanel} from './agent/panel.js';
import {agentProject} from './agent/project.js';
import {installExplorerSearch} from './explorer-search.js';
import {installAbout} from './about.js';
import {PanelShell} from './panels.js';
import {createEditor} from './editor.js';
import {createCadPanel} from './cad-panel.js';
import {createRuntime} from './runtime.js';
import {createViewerFeedback} from './viewer-feedback.js';
import {explorerDownload} from './explorer-download.js';
import {createFileActions} from './file-actions.js';
import {openProjectStore,migrateExample} from './project-store.js';
import {exportProject,restoreArchive} from './project-archive.js';

import EXAMPLE from '../examples/duck.py?raw';

const $=id=>document.getElementById(id);
const element=(className,html)=>{const node=document.createElement('div');node.className=className;node.innerHTML=html;return node;};
const shell=new PanelShell($('app'));
const disposeAbout=installAbout();
$('toolbar').innerHTML='<button id="open-folder">Open folder</button><button id="open">Open file</button>'+(window.desktop?'<button id="save">Save</button><span class="toolbar-divider"></span>':'')+'<button id="run" class="primary" disabled>▶ Run</button><button id="cancel" disabled>■ Stop</button><button id="step" disabled>STEP ↓</button><button id="stl" disabled>STL ↓</button><button id="export-viewer" disabled title="Export an offline interactive viewer">Viewer HTML ↓</button>';
const explorer=element('explorer-panel','<div class="panel-toolbar"><strong>Explorer</strong><button id="new-file" class="new-file-button" title="Create a blank Python file"><span aria-hidden="true">＋</span> New file</button></div><div id="workspace-name" class="workspace-name">OPEN FILES</div><small id="storage-kind" class="storage-kind"></small><input id="find-file" class="explorer-search" type="search" aria-label="Find a file" placeholder="Find a file…" /><div id="file-tree" class="explorer-tree" role="tree"></div><div class="explorer-hint">Open a folder to browse your project.</div>');
const source=element('editor-panel','<div class="panel-toolbar"><span id="filename">duck.py</span><span id="dirty" hidden>●</span><span class="panel-spacer"></span><span>Python</span></div><div id="editor" class="monaco-host"></div>');
const preview=element('viewer-panel','<div class="panel-toolbar"><span id="model-state">No model yet</span><span class="panel-spacer"></span><span id="export-source" hidden></span><span id="elapsed"></span></div><div class="viewport-wrap"><div id="cad-view"></div><div id="empty-state"><h2>Please run your model to preview</h2><button id="empty-run" class="primary" disabled>▶ Run</button></div></div><div id="error-banner" role="alert" hidden><span id="error-message"></span><button id="dismiss-error" aria-label="Dismiss error">×</button></div>');
const consolePanel=element('console-panel','<div class="panel-toolbar"><strong>OUTPUT</strong><span class="panel-spacer"></span><button id="clear-log">Clear</button></div><pre id="logs"></pre>');
shell.register({id:'explorer',title:'Explorer',slot:'left',element:explorer});
shell.register({id:'source',title:'Code',slot:'center',element:source});
shell.register({id:'preview',title:'Preview',slot:'center',element:preview});
shell.register({id:'console',title:'Output',slot:'bottom',element:consolePanel});
shell.activate('source');
$('statusbar').innerHTML='<span id="runtime-status" role="status">Ready to run</span><span id="cache-status" role="status"></span><span class="panel-spacer"></span><span id="position">Python</span><span class="status-text">result → model</span>';
const fileInput=document.createElement('input');fileInput.type='file';fileInput.accept='.py';fileInput.hidden=true;document.body.append(fileInput);
const folderInput=document.createElement('input');folderInput.type='file';folderInput.webkitdirectory=true;folderInput.multiple=true;folderInput.hidden=true;document.body.append(folderInput);
let filename='duck.py',initial=EXAMPLE;
try{filename=localStorage.getItem('build1234.filename')||filename;initial=localStorage.getItem('build1234.code')??initial;}catch{}
initial=migrateExample(filename,initial,EXAMPLE);
let startupDraft;
if(window.desktop){try{startupDraft=JSON.parse(localStorage.getItem('duckbench.desktopDraft'));}catch{}}
let projectStore=null,projectRecord=null,startupCacheError=null;
if(!window.desktop){
 try{
  projectStore=await openProjectStore();
  filename=filename.replaceAll('\\','/');if(!validPath(filename))filename='duck.py';
  const files={[filename]:initial};
  if(initial!==EXAMPLE&&!Object.hasOwn(files,'duck.py'))files['duck.py']=EXAMPLE;
  projectRecord=await projectStore.defaultProject(files,filename,EXAMPLE);
  filename=Object.hasOwn(projectRecord.files,projectRecord.activeFile)?projectRecord.activeFile:Object.keys(projectRecord.files)[0]||'untitled.py';
  initial=projectRecord.files[filename]??'';
  try{localStorage.removeItem('build1234.code');localStorage.removeItem('build1234.filename');}catch{}
  navigator.storage?.persist?.().catch(()=>{});
 }catch(reason){startupCacheError=reason;}
}
let cacheTimer,cacheQueue=Promise.resolve(),lastSavedCache='',cacheReady=false,projectChanging=false;
let changing=false,runtime,busy=false,exporting=false,canExport=false,hasModel=false,generation=0,builtFilename=filename;
let builtSnapshot=null,projectRevision=0,buildNeedsSetup=false,progressMessage='Building model…',deleting=false;
let browserFolders=new Set(projectRecord?.folders||[]);
let workspace=projectRecord?{name:projectRecord.name}:null,browserFiles={...projectRecord?.files},treeEntries=projectRecord?browserTree(projectRecord.files):[];
let expandedFolders=new Set(projectRecord?.expanded||[]),runTarget=projectRecord?.runTarget||null;
let lastScene=null,lastAttempt=null,importedModel=false;
const basename=path=>path?.split(/[\\/]/).pop()||'';
const runPath=()=>runTarget||filename;
function folderPrefs(){return 'duckbench.folder.'+workspace.root;}
function saveFolderPrefs(){
 if(window.desktop&&workspace?.root){try{localStorage.setItem(folderPrefs(),JSON.stringify({activeFile:filename,runTarget,expanded:[...expandedFolders]}));}catch{}}
}
function setRunTarget(path){runTarget=path;saveFolderPrefs();renderTree();buttons();}
function dirtyHelpers(target){
 return window.desktop&&workspace ? [...documents].filter(([path,doc])=>path!==target&&inWorkspace(path)&&doc.code!==doc.saved) : [];
}
function runLabel(){return (dirtyHelpers(runPath()).length?'Save changed files & Run ':'Run ')+basename(runPath());}

const documents=new Map(projectRecord?Object.entries(projectRecord.files).map(([name,code])=>[name,{code,saved:code}]):[[filename,{code:initial,saved:initial}]]);
if(!documents.has(filename))documents.set(filename,{code:initial,saved:initial});
const editor=createEditor($('editor'),{value:initial,onChange:()=>{if(changing)return;const doc=documents.get(filename);doc.code=editor.getValue();projectRevision++;sync();},onCursor:position=>{$('position').textContent=`Ln ${position.lineNumber}, Col ${position.column}`;}});
editor.setFilename(filename);
const cad=createCadPanel($('cad-view'));
const feedback=createViewerFeedback(preview,()=>run());
const exportsBar=document.createElement('div');exportsBar.className='geometry-exports';
exportsBar.append($('step'),$('stl'),$('export-viewer'));preview.querySelector('.panel-toolbar').after(exportsBar);
const fileActions=createFileActions({isDiskFile:path=>!!window.desktop&&/^(\/|[A-Za-z]:[\\/])/.test(path),removeFile,onError:error,actions:entry=>{
 const relative=entry.root?'':window.desktop?(inWorkspace(entry.path)?project.relative(entry.path):''):entry.path;
 const parent=entry.directory?relative:(relative||'').split('/').slice(0,-1).join('/');
 const items=[
   {label:'New file…',run:()=>createEntry(parent,false)},
   {label:'New folder…',run:()=>createEntry(parent,true)}
 ];
 if(entry.root)return items;
 items.push({label:entry.directory?'Download folder (ZIP)':'Download file',run:()=>downloadEntry(entry)});
 if(!entry.directory&&!entry.readOnly){
   if(entry.path.endsWith('.py')&&(!window.desktop||!workspace||inWorkspace(entry.path)))items.push({label:entry.path===runTarget?'Unpin run target':'Set as run target',run:()=>setRunTarget(entry.path===runTarget?null:entry.path)});
   const agentPath=project.relative(entry.path);
   if(agentPath)items.push({label:'Ask agent about this file',run:()=>agent.attach(agentPath)});
 }
 if(window.desktop&&inWorkspace(entry.path))items.push({label:'Reveal in file manager',run:()=>window.desktop.revealFile(entry.path)});
 return items;
}});
if(!window.desktop){
 $('open-folder').textContent='Import folder';$('open').textContent='Import file';
 const note=document.createElement('p');note.className='cache-notice';note.textContent='Saved in this browser, not to disk or the cloud. Use Export ZIP for a backup.';explorer.append(note);
}
$('storage-kind').textContent=window.desktop?'Files on disk':'Saved in this browser';
$('open-folder').textContent=window.desktop?'Open workspace…':'Import folder';
const fileCommands=document.createElement('div');
fileCommands.className='explorer-commands';
fileCommands.append($('open-folder'),$('open'));
explorer.tabIndex=0;
fileActions.bind(explorer,{root:true});
async function createEntry(parent,isFolder){
 if(window.desktop&&!workspace){
   if(!isFolder){$('new-file').click();return;}
   if(!await pickWorkspace())return;
 }
 const value=await requestFilename(isFolder?'parts':'model.py',isFolder?'New folder name':'New file name');
 if(!value)return;
 if(!validPath(value)||value.split('/').some(part=>part.startsWith('.')||['constructor','prototype','__proto__'].includes(part)))throw new Error('Enter a relative name.');
 const name=parent?parent+'/'+value:value;
 let key=name;
 if(window.desktop){
   if(isFolder)await window.desktop.createFolder(name);
   else key=await window.desktop.createProjectFile(name);
   treeEntries=await window.desktop.listFiles(workspace.root);
 }else{
   const existing=[...documents.keys(),...Object.keys(projectRecord?.modelFiles||{})];
   if(existing.some(path=>path===name||path.startsWith(name+'/')||name.startsWith(path+'/'))||
      [...browserFolders].some(path=>path===name||path.startsWith(name+'/')))throw new Error('A file or folder already uses that name.');
   if(isFolder)browserFolders.add(name);else browserFiles[name]='';
   treeEntries=browserTree(browserFiles);
 }
 const parts=name.split('/');
 for(let i=1;i<parts.length;i++){
   const dir=parts.slice(0,i).join('/');
   expandedFolders.add(window.desktop?project.key(dir):dir);
 }
 if(!isFolder)load({filename:key,code:''});saveFolderPrefs();renderTree();if(!isFolder)editor.focus();
}
async function downloadEntry(entry){
 const result=await explorerDownload(entry,{
   list:path=>window.desktop.listFiles(path),
   read:async path=>{
     const doc=documents.get(path);
     if(window.desktop&&(!doc||inWorkspace(path)&&doc.code===doc.saved))return window.desktop.readDownloadFile(path);
     if(doc)return doc.code;
     return projectRecord?.modelFiles?.[path]??browserFiles[path];
   }
 });
 if(window.desktop)await window.desktop.downloadCopy(result.name,result.bytes);
 else download(result.bytes,result.name,entry.directory?'application/zip':'application/octet-stream');
}
if(!window.desktop){
 const button=(title,action)=>{const b=document.createElement('button');b.textContent=title;b.onclick=action;fileCommands.append(b);return b;};
 button('Export ZIP',()=>exportProject({...projectRecord,name:'Default Project',...cachePayload()})).id='export-zip';
 const zip=document.createElement('input');zip.id='zip-input';zip.type='file';zip.accept='.zip';zip.hidden=true;fileCommands.append(zip);
 button('Restore ZIP…',()=>zip.click());
 zip.onchange=async()=>{
   const file=zip.files[0];zip.value='';if(!file)return;
   try{
     if(file.size>128*1024*1024)throw new Error('Project ZIP is too large.');
     const restored=restoreArchive(new Uint8Array(await file.arrayBuffer()),file.name);
     if(!confirm('Replace the contents of Default Project with '+file.name+'?'))return;
     await changeProject(async()=>{await replaceBrowserFiles(restored,true);});
   }catch(reason){cacheFailure(reason);}
 };
 // Only people with older, additional projects see recovery downloads.
 for(const old of projectRecord?await projectStore.list().catch(()=>[]):[]){
   if(old.id!==projectRecord?.id)button('Export '+old.name+' ZIP',()=>exportProject(old));
 }
}
explorer.querySelector('.panel-toolbar').after(fileCommands);
const project=agentProject({
 workspace:()=>workspace, documents, filename:()=>filename, desktop:window.desktop,
 host:{
  output:()=>$('logs').textContent,
  selection:()=>({file:project.relative(filename),...editor.selection()}),
  build:agentBuild,
  async describe(){
   if(!hasModel)throw new Error('No model is shown. Build one first (run_build).');
   if(importedModel)throw new Error('The preview shows '+basename(builtFilename)+', opened from a file rather than built, so it cannot be measured.');
   return runtime.call('describe',{build_id:lastScene.build});
  },
  async screenshot(view){
   const shot=await cad.screenshot(view);
   return {image:shot,text:`Screenshot of ${hasModel?basename(builtFilename):'the preview'} (${view} view, ${shot.width}×${shot.height}).`+(stalePreview()?' The code has changed since this model was built.':'')};
  },
  picks:limit=>({picks:cad.picks(limit)}),
  api:args=>{if(!runtime)throw new Error('Python is not available.');return runtime.call('api',args);},
  source:args=>{if(!runtime)throw new Error('Python is not available.');return runtime.call('source',args);},
  camera:args=>{const camera=cad.camera(args);return {...camera,...(stalePreview()?{note:'The code has changed since this model was built.'}:{})};},
  write:agentWrite,remove:removeFile,rename:agentRename,
  /** Save one buffer to disk (desktop), for an MCP client's change. */
  async save(key){const doc=documents.get(key);if(!window.desktop||!doc||doc.code===doc.saved)return;const code=doc.code;await window.desktop.saveProjectBuffer({filename:key,saved:doc.saved,code});doc.saved=code;sync();},
 },
 preview:()=>({status:$('runtime-status').textContent,runTarget:project.relative(runPath()),lastAttempt:lastAttempt?.target?lastAttempt:null,lastSuccessful:hasModel?project.relative(builtFilename):null,lastSuccessfulId:hasModel&&project.relative(builtFilename)?lastScene.build:null,stale:hasModel&&snapshot()!==builtSnapshot}),
});
const agent=createAgentPanel(project,{
 run,runLabel,
 show:()=>{if($('right-slot').hidden)shell.toggle('right');},
 close:()=>{shell.toggle('right');$('toggle-agent').focus();},
});
shell.register({id:'agent',title:'Agent',slot:'right',element:agent.element});
const refreshSearch=installExplorerSearch({
 input:$('find-file'),tree:$('file-tree'),fileRow,sync,
 entries:()=>[...[...documents.keys()].filter(path=>!inWorkspace(path)).map(path=>({name:path.split(/[\\/]/).pop(),path})),...treeEntries],
 listDirectory:path=>window.desktop.listFiles(path),
});
shell.onLayout(()=>{editor.layout();cad.layout();});
function cachePayload(){return {files:projectFiles(),folders:[...browserFolders],activeFile:filename,runTarget,expanded:[...expandedFolders]};}
function cacheFailure(reason){$('cache-status').textContent='Not saved — browser cache error';$('cache-status').title=reason.message||String(reason);$('cache-status').classList.add('cache-error');error(reason);}
function scheduleCache(){
 if(!cacheReady||projectChanging||window.desktop)return;
 if(JSON.stringify(cachePayload())===lastSavedCache)return;
 $('cache-status').textContent='Unsaved changes';
 clearTimeout(cacheTimer);cacheTimer=setTimeout(()=>{void flushCache().catch(cacheFailure);},250);
}
function flushCache(){
 if(window.desktop||!cacheReady)return Promise.resolve();
 clearTimeout(cacheTimer);
 if(!projectRecord||!projectStore)return Promise.reject(new Error('Browser storage is unavailable. Download your files to keep them.'));
 const payload=cachePayload(),serialized=JSON.stringify(payload),id=projectRecord.id;
 const task=cacheQueue.catch(()=>{}).then(async()=>{
  if(serialized===lastSavedCache)return;
  $('cache-status').textContent='Saving to cache…';
  const saved=await projectStore.save({...projectRecord,...payload,id});
  projectRecord=saved;lastSavedCache=serialized;
  for(const [path,code] of Object.entries(payload.files)){const doc=documents.get(path);if(doc&&doc.code===code){doc.saved=code;doc.untitled=false;}}
  $('cache-status').classList.remove('cache-error');$('cache-status').title='';
  $('cache-status').textContent=JSON.stringify(cachePayload())===lastSavedCache?'Saved to browser cache':'Unsaved changes';
  $('dirty').hidden=!dirty();
  updateFileRows();
 });
 cacheQueue=task;return task;
}
async function changeProject(action){
 if(projectChanging)return;
 projectChanging=true;$('app').inert=true;
 try{await flushCache();await action();}finally{projectChanging=false;$('app').inert=false;}
}
async function activateProject(record){
 if(busy)cancel();

 clearTimeout(cacheTimer);projectRecord=record;browserFolders=new Set(record.folders||[]);documents.clear();browserFiles={...record.files};
 for(const [name,code] of Object.entries(record.files))documents.set(name,{code,saved:code});
 filename=Object.hasOwn(record.files,record.activeFile)?record.activeFile:Object.keys(record.files)[0]||'untitled.py';
 if(!documents.has(filename))documents.set(filename,{code:'',saved:''});
 workspace={name:record.name};treeEntries=browserTree(browserFiles);expandedFolders=new Set(record.expanded||[]);runTarget=record.runTarget||null;lastScene=lastAttempt=null;
 $('empty-state').hidden=false;hasModel=false;canExport=false;builtSnapshot=null;cad.clear();$('model-state').textContent='No model yet';$('model-state').title='';$('elapsed').textContent='';$('error-banner').hidden=true;
 changing=true;editor.setFilename(filename);editor.setValue(documents.get(filename).code);changing=false;
 renderTree();buttons();lastSavedCache=JSON.stringify(cachePayload());$('cache-status').textContent='Saved to browser cache';
}
async function replaceBrowserFiles({files,modelFiles={},folders=[],activeFile,runTarget=null},replacing=false){
 const record=await projectStore.save({...projectRecord,files,modelFiles,folders,activeFile,runTarget,expanded:[]});
 if(replacing){agent.setContext(null);runtime?.cancel();}
 await activateProject(record);shell.activate('source');
}
function projectFiles(){
 const files={...browserFiles};
 for(const [path,doc] of documents)if(!window.desktop||Object.hasOwn(files,path))files[path]=doc.code;
 return files;
}
function snapshot(){return JSON.stringify([runPath(),projectRevision,window.desktop?[...documents].filter(([path,doc])=>path===runPath()||inWorkspace(path)&&doc.code!==doc.saved).map(([path,doc])=>[path,doc.code]):projectFiles()]);}
function updatePreview(){
 const stale=hasModel&&!importedModel&&(!canExport||snapshot()!==builtSnapshot);
 const origin=$('export-source');if(origin){origin.hidden=!hasModel;origin.textContent=hasModel?(importedModel?'Opened: ':'Export: ')+basename(builtFilename)+(stale?' (last successful build)':''):'';}
 feedback.update({busy,hasModel,needsSetup:buildNeedsSetup,stale:!importedModel&&(!canExport||snapshot()!==builtSnapshot),disabled:!runtime||exporting||deleting,message:progressMessage});}
function dirty(){const doc=documents.get(filename);return doc.untitled||doc.code!==doc.saved;}
function updateFileRows(){
 for(const row of explorer.querySelectorAll('.file-row')){
   const path=row.dataset.path,doc=documents.get(path);
   row.classList.toggle('selected',path===filename);
   row.setAttribute('aria-selected',String(path===filename));
   row.classList.toggle('modified',!!doc&&doc.code!==doc.saved);
   row.classList.toggle('run-target',path===runTarget);
 }
}
function sync(){
 agent.setContext(window.desktop?(workspace?.root||filename):projectRecord?.id);
 $('filename').textContent=filename.split(/[\\/]/).pop();$('dirty').hidden=!dirty();
 shell.setTitle('source',$('filename').textContent,filename);
 updateFileRows();
 const label='▶ '+runLabel();
 $('run').textContent=label;$('empty-run').textContent=label;
 if(window.desktop){try{localStorage.setItem('build1234.filename',filename);localStorage.setItem('build1234.code',editor.getValue());
   const doc=documents.get(filename);if(doc.code!==doc.saved)localStorage.setItem('duckbench.desktopDraft',JSON.stringify({filename,...doc}));else localStorage.removeItem('duckbench.desktopDraft');}catch{}}
 else scheduleCache();
 updatePreview();
}
function log(text){$('logs').textContent+=String(text)+'\n';$('logs').scrollTop=$('logs').scrollHeight;}
function status(text){$('runtime-status').textContent=text;if(busy){progressMessage=text;updatePreview();}}
function buttons(){
 $('run').disabled=!runtime||busy||exporting||deleting;$('empty-run').disabled=$('run').disabled;$('cancel').disabled=!busy;
 $('export-viewer').disabled=!lastScene||busy||exporting;
 $('step').disabled=$('stl').disabled=!canExport||busy||exporting||deleting;
 updatePreview();
}
function error(error){status('Error: '+(error.message||String(error)).split('\n').filter(Boolean).at(-1));const message=error.message||String(error);$('error-message').textContent=message.split('\n').filter(Boolean).at(-1);$('error-banner').hidden=false;log(message);}
async function run({saveHelpers=false,target}={}){
 if(typeof target!=='string')target=undefined;
 if(!runtime||busy||exporting||deleting)return;
 if(!saveHelpers&&dirtyHelpers(target||runPath()).length&&!window.confirm('Save changed project files to disk and run '+basename(target||runPath())+'?'))return;
 const token=++generation;const runningFile=target||runPath();const outputStart=$('logs').textContent.length;let runningSnapshot;const files={...projectRecord?.modelFiles,...projectFiles()};
 buildNeedsSetup=runtime.needsSetup;busy=true;status(buildNeedsSetup?'Preparing Python and CAD…':'Building model…');buttons();$('error-banner').hidden=true;log(`› ${runningFile}`);
 shell.activate('preview');
 try{
   for(const [path,doc] of dirtyHelpers(runningFile)){
     if(token!==generation)return;
     const code=doc.code;
     await window.desktop.saveProjectBuffer({filename:path,saved:doc.saved,code});
     doc.saved=code;
   }
   let code=documents.get(runningFile)?.code;
   if(window.desktop&&runningFile!==filename&&inWorkspace(runningFile)){
     let disk;
     try{disk=await window.desktop.readProjectText(runningFile);}
     catch(cause){throw new Error('Choose a new run target or restore '+basename(runningFile)+'. '+cause.message);}
     const doc=documents.get(runningFile);
     if(!doc||doc.code===doc.saved){code=disk;documents.set(runningFile,{code:disk,saved:disk});}
   }
   if(code===undefined)throw new Error('Choose a new run target. The previous target is unavailable.');
   if(token!==generation)return;
   runningSnapshot=snapshot();
   lastAttempt={id:token,target:project.relative(runningFile),status:'building',outputStart};
   const result=await runtime.run({code,filename:runningFile,files,...(!window.desktop?{folders:[...browserFolders]}:{}),build_id:token,displayed_build:lastScene?.build??null});
   if(token!==generation)return;
   status('Preparing 3D preview…');
   await new Promise(requestAnimationFrame);
   if(token!==generation)return;
   const retained=structuredClone(result.scene);
   cad.render(result.scene);importedModel=false;lastScene={version:1,build:token,name:basename(runningFile),scene:retained};
   lastAttempt={id:token,target:project.relative(runningFile),status:'success',elapsed:result.elapsed,outputStart};$('empty-state').hidden=true;hasModel=true;canExport=true;builtFilename=runningFile;
   builtSnapshot=runningSnapshot;
   $('model-state').textContent='result';$('model-state').title=runningFile;$('elapsed').textContent=result.elapsed.toFixed(2)+'s';status('Ready');log(`Built in ${result.elapsed.toFixed(2)}s`);
 }catch(e){if(token!==generation)return;error(e);
   lastAttempt={id:token,target:project.relative(runningFile),status:'failed',error:$('error-message').textContent,locations:showTraceback(e.message),outputStart};status('Build failed');$('model-state').textContent=hasModel?'Last successful model':'No model yet';}
 finally{if(token===generation){busy=false;sync();buttons();}}
}
function cancel(){lastAttempt={id:generation,target:project.relative(runPath()),status:'cancelled'};++generation;runtime?.cancel();busy=false;canExport=false;buttons();status('Cancelled');}
function load(data,{activate=true}={}){
 if(!data)return;
 if(data.error)throw new Error(data.error);
 if(data.model){
   if(data.model.version!==1||!Array.isArray(data.model.scene?.parts))throw new Error('Unsupported Duckbench scene.');
   if(busy)cancel();
   shell.activate('preview');
   const retained=structuredClone(data.model);
   cad.render(data.model.scene);importedModel=true;lastScene=retained;hasModel=true;canExport=false;builtFilename=data.filename;
   builtSnapshot=snapshot();$('empty-state').hidden=true;$('error-banner').hidden=true;$('model-state').textContent=data.model.name;
   $('elapsed').textContent='';status('Opened '+basename(data.filename));buttons();return;
 }
 filename=data.filename;
 const previous=documents.get(filename);
 if(!previous||previous.code===previous.saved)documents.set(filename,{...previous,code:data.code,saved:data.code});
 changing=true;editor.setFilename(filename);editor.setValue(documents.get(filename).code);changing=false;
 if(activate)shell.activate('source');saveFolderPrefs();sync();
 if(!workspace)renderTree();
}
function stalePreview(){return hasModel&&!importedModel&&snapshot()!==builtSnapshot;}
/** Build for the agent: wait for a build already running, then build and report, giving up waiting after 100 seconds. */
async function agentBuild(target,{save=true}={}){
 if(!runtime)throw new Error('Python is not available.');
 // MCP clients may not write the user's unsaved edits to disk; the built-in agent may, as Apply & Run does.
 const unsaved=dirtyHelpers(target||runPath());
 if(!save&&unsaved.length)throw new Error('Building would save unsaved changes to '+unsaved.map(([path])=>project.relative(path)).join(', ')+'. Ask the user to save or run it in Duckbench.');
 for(let waited=0;(busy||exporting||deleting)&&waited<30000;waited+=200)await new Promise(resolve=>setTimeout(resolve,200));
 if(busy||exporting||deleting)throw new Error('Duckbench is busy with another build. Try again shortly.');
 if(target&&window.desktop&&!inWorkspace(target)&&target!==filename)throw new Error('Build a file in the open workspace.');
 const done=run({saveHelpers:true,target});
 const slow=new Promise(resolve=>setTimeout(()=>resolve('slow'),100000));
 if(await Promise.race([done.then(()=>'done'),slow])==='slow')return {...lastAttempt,status:'building'};
 return lastAttempt;
}
/** Create or replace a project file's text for the agent, through its editor buffer. */
async function agentWrite(path,content){
 const key=project.key(path);
 let doc=documents.get(key);
 if(!doc&&window.desktop){
  const disk=await window.desktop.readProjectText(key).catch(()=>null);
  if(disk!==null)documents.set(key,doc={code:disk,saved:disk});
 }
 if(!doc&&!window.desktop&&Object.hasOwn(browserFiles,key))documents.set(key,doc={code:browserFiles[key],saved:browserFiles[key]});
 if(doc){
  if(key===filename){
   // Replace only what differs, so the cursor and undo history stay sensible.
   const old=doc.code;let start=0,end=0;
   while(start<old.length&&start<content.length&&old[start]===content[start])start++;
   while(end<old.length-start&&end<content.length-start&&old[old.length-1-end]===content[content.length-1-end])end++;
   editor.replaceRange(start,old.length-start-end,content.slice(start,content.length-end));
  }
  doc.code=content;
 }else{
  if(window.desktop){
   const folder=path.split('/').slice(0,-1).join('/');
   if(folder)await window.desktop.createFolder(folder);
   documents.set(window.desktop?await window.desktop.createProjectFile(path):key,{code:content,saved:''});
   treeEntries=await window.desktop.listFiles(workspace.root);
  }else{
   if([...documents.keys(),...Object.keys(browserFiles),...browserFolders].some(other=>other===key||other.startsWith(key+'/')||key.startsWith(other+'/')&&!browserFolders.has(other)))throw new Error('A file or folder already uses that name.');
   browserFiles[key]=content;documents.set(key,{code:content,saved:''});treeEntries=browserTree(browserFiles);
  }
  for(let parts=path.split('/'),i=1;i<parts.length;i++)expandedFolders.add(window.desktop?project.key(parts.slice(0,i).join('/')):parts.slice(0,i).join('/'));
  renderTree();
 }
 projectRevision++;sync();
 return key;
}
/** Rename or move a project file for the agent, keeping its buffer, tab and run target. */
async function agentRename(key,to){
 const target=project.key(to);
 let next=target;
 if(window.desktop){
  next=await window.desktop.renameProjectFile(key,to);
  treeEntries=await window.desktop.listFiles(workspace.root);
 }else{
  if(documents.has(target)||Object.hasOwn(browserFiles,target)||browserFolders.has(target))throw new Error(to+' already exists.');
  browserFiles[target]=documents.get(key)?.code??browserFiles[key];delete browserFiles[key];
  treeEntries=browserTree(browserFiles);
 }
 const doc=documents.get(key);
 if(doc){documents.delete(key);documents.set(next,window.desktop?doc:{...doc,saved:''});}
 if(runTarget===key)runTarget=next;
 if(filename===key){filename=next;editor.setFilename(filename);saveFolderPrefs();}
 projectRevision++;renderTree();
 return next;
}
function showTraceback(message){
 const locations=[];
 const matches=[...String(message).matchAll(/File "([^"]+)", line (\d+)/g)];
 for(const [,raw,line] of matches){
  const key=window.desktop?raw:raw.replace(/^\/project\//,'');
  if(!inWorkspace(key)&&!documents.has(key))continue;
  const relative=project.relative(key);
  if(relative)locations.push({path:relative,line:Number(line)});
  const link=document.createElement('button');link.textContent=basename(key)+':'+line;
  link.onclick=async()=>{try{const data=documents.get(key)||await window.desktop.readFile(key);load({filename:key,code:data.code});editor.goToLine(Number(line));}catch(reason){error(reason);}};
  $('error-message').append(' ',link);
 }
 return locations;
}
function inWorkspace(path){return !!workspace&&(window.desktop?path.replaceAll('\\','/').startsWith(workspace.root.replaceAll('\\','/')+'/'):Object.hasOwn(browserFiles,path));}
function fileRow(entry,depth){
 const row=document.createElement('button');row.className='file-row';row.dataset.path=entry.path;row.setAttribute('role','treeitem');row.style.paddingLeft=`${12+depth*14}px`;row.textContent=(entry.name.endsWith('.py')?'◇  ':'·  ')+entry.name;
 row.onclick=async()=>{const scope=workspace;try{
   if(window.desktop&&inWorkspace(entry.path)){const data=await window.desktop.readFile(entry.path);if(scope===workspace)load(data);}
   else if(!window.desktop&&/\.(stl|stp|step|html)$/i.test(entry.path)){
     const bytes=projectRecord?.modelFiles?.[entry.path]??new TextEncoder().encode(browserFiles[entry.path]||'');
     let model;
     if(/\.html$/i.test(entry.path)){
       const payload=new TextDecoder().decode(bytes).match(/<script type="application\/json" id="duckbench-scene">([\s\S]*?)<\/script>/);
       if(!payload){load({filename:entry.path,code:browserFiles[entry.path]});return;}
       model=JSON.parse(payload[1]);
     }else{status('Opening '+entry.name+'…');model=await runtime.importCad(entry.name,bytes);}
     if(scope===workspace)load({filename:entry.path,model});
   }else load({filename:entry.path,code:documents.get(entry.path)?.code??browserFiles[entry.path]??''});
 }catch(e){error(e);}};
 fileActions.bind(row,{...entry,readOnly:!window.desktop&&Object.hasOwn(projectRecord?.modelFiles||{},entry.path)});
 return row;
}
function appendEntries(parent,entries,depth=0){
 for(const entry of entries){
  if(entry.directory){
   const details=document.createElement('details');details.dataset.path=entry.path;const summary=document.createElement('summary');summary.className='folder-row';summary.style.paddingLeft=`${12+depth*14}px`;summary.textContent=entry.name;details.append(summary);fileActions.bind(summary,entry);
   const children=document.createElement('div');children.setAttribute('role','group');details.append(children);let loaded=false;
   details.addEventListener('toggle',async()=>{if(!details.isConnected)return;
    if(details.open)expandedFolders.add(entry.path);else expandedFolders.delete(entry.path);
    saveFolderPrefs();scheduleCache();if(!details.open||loaded)return;loaded=true;try{appendEntries(children,entry.children||await window.desktop.listFiles(entry.path),depth+1);sync();}catch(e){loaded=false;error(e);}});parent.append(details);details.open=expandedFolders.has(entry.path);
  }else parent.append(fileRow(entry,depth));
 }
}
function renderTree(){
 $('file-tree').replaceChildren();
 const loose=[...documents.keys()].filter(path=>!inWorkspace(path));
 appendEntries($('file-tree'),loose.map(path=>({name:path.split(/[\\/]/).pop(),path})));
 if(workspace)appendEntries($('file-tree'),treeEntries);
 $('workspace-name').textContent=workspace?.name||(window.desktop?'OPEN FILES':'Default Project');explorer.querySelector('.explorer-hint').hidden=!!workspace;sync();void refreshSearch();
}
async function removeFile(path){
 if(deleting)return;
 deleting=true;buttons();
 try{
  if(busy)cancel();
  if(window.desktop&&/^(\/|[A-Za-z]:[\\/])/.test(path))await window.desktop.trashFile(path);
  documents.delete(path);delete browserFiles[path];projectRevision++;
  if(workspace){
   if(window.desktop){const prune=entries=>entries.filter(entry=>entry.path!==path).map(entry=>({...entry,...(entry.children?{children:prune(entry.children)}:{})}));treeEntries=prune(treeEntries);}
   else treeEntries=browserTree(browserFiles);
  }
  if(filename===path){
   const next=[...documents.keys()].find(name=>name.endsWith('.py'))||Object.keys(browserFiles).find(name=>name.endsWith('.py'));
   load(next?{filename:next,code:documents.get(next)?.code??browserFiles[next]}:{filename:path==='untitled.py'?'new-file.py':'untitled.py',code:''});
  }
  renderTree();if(!window.desktop)await flushCache();status('File removed');
 }finally{deleting=false;buttons();}
}
function browserTree(files){
 const root=[];
 for(const path of [...new Set([...Object.keys(files),...Object.keys(projectRecord?.modelFiles||{}),...browserFolders])].sort()){
  let level=root;const parts=path.split('/');let prefix='';
  parts.forEach((name,i)=>{prefix+=(prefix?'/':'')+name;let entry=level.find(e=>e.name===name);if(!entry){entry={name,path:prefix,directory:i<parts.length-1||browserFolders.has(prefix),children:[]};level.push(entry);}level=entry.children;});
 }
 const sort=items=>{items.sort((a,b)=>Number(b.directory)-Number(a.directory)||a.name.localeCompare(b.name));items.forEach(i=>sort(i.children));};sort(root);return root;
}
async function enterFolder(folder,draft){
 if(!folder)return;
 if(workspace?.root===folder.root){treeEntries=folder.entries;renderTree();return;}
 if(busy)cancel();
 workspace=folder;treeEntries=folder.entries;documents.clear();projectRevision++;
 let prefs={};try{prefs=JSON.parse(localStorage.getItem(folderPrefs())||'{}');}catch{}
 runTarget=prefs.runTarget||null;expandedFolders=new Set(prefs.expanded||[]);
 let data;
 if(draft&&prefs.activeFile===draft.filename&&inWorkspace(draft.filename))documents.set(draft.filename,{code:draft.code,saved:draft.saved});
 if(prefs.activeFile&&inWorkspace(prefs.activeFile)&&! /\.(stp|step|stl|html)$/i.test(prefs.activeFile)){
   try{data=await window.desktop.readFile(prefs.activeFile);}catch{}
 }
 const first=treeEntries.find(item=>!item.directory&&item.name==='model.py')||treeEntries.find(item=>!item.directory&&item.name.endsWith('.py'));
 let readError;
 if(!data&&first){try{data=await window.desktop.readFile(first.path);}catch(reason){readError=reason;}}
 data??={filename:'untitled.py',code:''};
 hasModel=canExport=false;lastScene=lastAttempt=builtSnapshot=null;cad.clear();$('empty-state').hidden=false;
 $('model-state').textContent='No model yet';$('elapsed').textContent='';$('error-banner').hidden=true;
 load(data);renderTree();buttons();if(readError)error(readError);
}
async function pickWorkspace(){
 if([...documents.values()].some(doc=>doc.code!==doc.saved)&&!confirm('Discard unsaved edits if you open another workspace?'))return;
 const folder=await window.desktop.openFolder();if(folder)await enterFolder(folder);return !!folder;
}
$('open-folder').onclick=async()=>{try{if(window.desktop)await pickWorkspace();else folderInput.click();}catch(e){error(e);}};
folderInput.onchange=async()=>{try{
 const imported={},modelFiles={};
 for(const file of folderInput.files){
   const name=file.webkitRelativePath;
   if(!validPath(name)||name.split('/').some(part=>part.startsWith('.')||['node_modules','constructor','prototype','__proto__'].includes(part)))continue;
   if(/\.stl$/i.test(name))modelFiles[name]=new Uint8Array(await file.arrayBuffer());
   else if(/\.(py|json|txt|csv|svg|step|stp|html|md|toml)$/i.test(name))imported[name]=await file.text();
 }
 const names=[...Object.keys(imported),...Object.keys(modelFiles)];if(!names.length)return;
 await changeProject(async()=>{
   const current=projectFiles(),existing=new Set([...Object.keys(current),...Object.keys(projectRecord.modelFiles||{})]);
   for(const name of names){
     if([...browserFolders].some(dir=>dir===name||dir.startsWith(name+'/'))||existing.has(name)||[...existing].some(p=>p.startsWith(name+'/')||name.startsWith(p+'/')))throw new Error('A file or folder already exists at '+name);
   }
   await replaceBrowserFiles({files:{...current,...imported},folders:[...browserFolders],modelFiles:{...projectRecord.modelFiles,...modelFiles},
     activeFile:Object.keys(imported).find(p=>p.endsWith('.py'))||filename,runTarget});
 });
 }catch(reason){cacheFailure(reason);}finally{folderInput.value='';}
};
$('open').onclick=async()=>{try{if(window.desktop)load(await window.desktop.open());else fileInput.click();}catch(e){error(e);}};
fileInput.onchange=async()=>{try{const file=fileInput.files[0];if(file){let name=file.name,number=2;while(documents.has(name)||Object.hasOwn(browserFiles,name))name=file.name.replace(/(\.[^.]+)?$/,`-${number++}$1`);load({filename:name,code:await file.text()});renderTree();await flushCache();}}catch(reason){cacheFailure(reason);}finally{fileInput.value='';}};
function download(data,name,type){const url=URL.createObjectURL(new Blob([data],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function save(){try{
 const code=editor.getValue();if(window.desktop){const target=await window.desktop.save({filename,code});if(!target)return;documents.delete(filename);filename=target;documents.set(filename,{code,saved:code});editor.setFilename(filename);if(workspace)treeEntries=await window.desktop.listFiles(workspace.root);}
 else {await flushCache();}
 saveFolderPrefs();sync();renderTree();status(window.desktop?'Saved':'Saved to browser cache');
}catch(e){if(window.desktop)error(e);else cacheFailure(e);}}
if(window.desktop)$('save').onclick=save;
$('run').onclick=$('empty-run').onclick=()=>run({saveHelpers:true});$('cancel').onclick=cancel;
$('new-file').onclick=()=>{
 const names=new Set([...documents.keys(),...Object.keys(browserFiles)].map(path=>path.split(/[\\/]/).pop()));
 let name='untitled.py',number=2;
 while(names.has(name))name=`untitled-${number++}.py`;
 documents.set(name,{code:'',saved:'',untitled:true});
 load({filename:name,code:''});renderTree();editor.focus();status(window.desktop?'New file — save to choose a location':'New file — saving to browser cache');
};
$('export-viewer').onclick=async()=>{
 if(!lastScene)return;const model=lastScene;exporting=true;buttons();
 try{
  const assets=window.desktop?await window.desktop.viewerAssets():await fetch(new URL('standalone/renderer.json',document.baseURI)).then(r=>{if(!r.ok)throw new Error('Viewer assets unavailable.');return r.json();});
  download(viewerPage(assets,model),model.name.replace(/\.py$/i,'')+'.html','text/html');
 }catch(reason){error(reason);}finally{exporting=false;buttons();}
};
bindTreeKeyboard(explorer);
$('dismiss-error').onclick=()=>{$('error-banner').hidden=true;};$('clear-log').onclick=()=>{$('logs').textContent='';};
for(const format of ['step','stl'])$(format).onclick=async()=>{if(!canExport||busy||exporting)return;exporting=true;buttons();try{download(await runtime.exportModel(format,lastScene.build),builtFilename.split(/[\\/]/).pop().replace(/\.py$/i,'')+'.'+format,'application/octet-stream');}catch(e){error(e);}finally{exporting=false;buttons();}};
document.addEventListener('keydown',event=>{if(projectChanging||document.querySelector('dialog[open]'))return;if(agent.element.contains(event.target))return;if(window.desktop&&(event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='o'){event.preventDefault();$('open').click();return;}if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='p'){event.preventDefault();if($('left-slot').hidden)shell.toggle('left');$('find-file').focus();$('find-file').select();return;}if((event.ctrlKey||event.metaKey)&&event.key==='Enter'){event.preventDefault();run();}if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();save();}},true);
window.desktop?.onFileChanged(data=>{
 const doc=documents.get(data.filename);if(!doc)return;
 if(doc.saved===data.code)return;
 projectRevision++;
 if(doc.code!==doc.saved){log('File changed on disk; keeping your unsaved edits.');updatePreview();return;}
 doc.code=doc.saved=data.code;if(data.filename===filename)load(data,{activate:false});else updatePreview();
});
window.addEventListener('beforeunload',event=>{
 if(!window.desktop&&cacheReady&&JSON.stringify(cachePayload())!==lastSavedCache){void flushCache().catch(cacheFailure);event.preventDefault();event.returnValue='';}
});
window.addEventListener('pagehide',event=>{if(!event.persisted)runtime?.dispose();});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&!window.desktop)void flushCache().catch(cacheFailure);});
renderTree();
cacheReady=true;lastSavedCache=projectRecord?JSON.stringify(cachePayload()):'';
if(!window.desktop){$('cache-status').textContent=projectRecord?'Saved to browser cache':'Cache unavailable';if(startupCacheError)cacheFailure(startupCacheError);}

try{runtime=await createRuntime({onLog:log,onStatus:status});buttons();log(window.desktop?'Native Python ready to run.':'Browser Python loads on first run.');}catch(e){error(e);}

if(window.desktop){
 try{await enterFolder(await window.desktop.restoreWorkspace(),startupDraft);}catch(reason){error(reason);}
 window.desktop.onLaunch(data=>{try{load(data);}catch(reason){error(reason);}});
 window.desktop.ready();
}
