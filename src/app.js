import './style.css';
import {installAbout} from './about.js';
import {PanelShell} from './panels.js';
import {createEditor} from './editor.js';
import {createCadPanel} from './cad-panel.js';
import {createRuntime} from './runtime.js';
import {createViewerFeedback} from './viewer-feedback.js';
import {createFileActions} from './file-actions.js';
import {openProjectStore,migrateExample} from './project-store.js';
import {createProjectDialog} from './project-dialog.js';

import EXAMPLE from '../examples/duck.py?raw';

const $=id=>document.getElementById(id);
const element=(className,html)=>{const node=document.createElement('div');node.className=className;node.innerHTML=html;return node;};
const shell=new PanelShell($('app'));
const disposeAbout=installAbout();
$('toolbar').innerHTML='<button id="open-folder">Open folder</button><button id="open">Open file</button><button id="save">Save</button><span class="toolbar-divider"></span><button id="run" class="primary" disabled>▶ Run</button><button id="cancel" disabled>■ Stop</button><button id="step" disabled>STEP ↓</button><button id="stl" disabled>STL ↓</button>';
const explorer=element('explorer-panel','<div class="panel-toolbar"><strong>EXPLORER</strong><button id="new-file" class="new-file-button" title="Create a blank Python file"><span aria-hidden="true">＋</span> New file</button></div><div id="workspace-name" class="workspace-name">OPEN FILES</div><div id="file-tree" class="explorer-tree" role="tree"></div><div class="explorer-hint">Open a folder to browse your project.</div>');
const source=element('editor-panel','<div class="panel-toolbar"><span id="filename">duck.py</span><span id="dirty" hidden>●</span><span class="panel-spacer"></span><span>Python</span></div><div id="editor" class="monaco-host"></div>');
const preview=element('viewer-panel','<div class="panel-toolbar"><span id="model-state">No model yet</span><span class="panel-spacer"></span><span id="elapsed"></span></div><div class="viewport-wrap"><div id="cad-view"></div><div id="empty-state"><strong>build123d</strong><p>Assign your model to <code>result</code>, then run.</p><button id="empty-run" class="primary">▶ Run model</button></div></div><div id="error-banner" role="alert" hidden><span id="error-message"></span><button id="dismiss-error" aria-label="Dismiss error">×</button></div>');
const consolePanel=element('console-panel','<div class="panel-toolbar"><strong>OUTPUT</strong><span class="panel-spacer"></span><button id="clear-log">Clear</button></div><pre id="logs"></pre>');
shell.register({id:'explorer',title:'Explorer',slot:'left',element:explorer});
shell.register({id:'source',title:'Code',slot:'center',element:source});
shell.register({id:'preview',title:'Preview',slot:'center',element:preview});
shell.register({id:'console',title:'Output',slot:'bottom',element:consolePanel});
shell.activate('preview');
$('statusbar').innerHTML='<span id="runtime-status" role="status">Ready to run</span><span id="cache-status" role="status"></span><span class="panel-spacer"></span><span id="position">Python</span><span class="status-text">result → model</span>';
const fileInput=document.createElement('input');fileInput.type='file';fileInput.accept='.py';fileInput.hidden=true;document.body.append(fileInput);
const folderInput=document.createElement('input');folderInput.type='file';folderInput.webkitdirectory=true;folderInput.multiple=true;folderInput.hidden=true;document.body.append(folderInput);
let filename='duck.py',initial=EXAMPLE;
try{filename=localStorage.getItem('build1234.filename')||filename;initial=localStorage.getItem('build1234.code')??initial;}catch{}
initial=migrateExample(filename,initial,EXAMPLE);
let projectStore=null,projectRecord=null,startupCacheError=null;
if(!window.desktop){
 try{
  projectStore=await openProjectStore();
  const projects=await projectStore.list();
  const active=await projectStore.active();
  projectRecord=projects.find(project=>project.id===active)||projects[0];
  if(!projectRecord){
   filename=filename.replaceAll('\\','/');if(filename.startsWith('/')||filename.includes('..')||/^[A-Za-z]:/.test(filename))filename=filename.split('/').pop()||'duck.py';
   const files={[filename]:initial};if(initial!==EXAMPLE&&!Object.hasOwn(files,'duck.py'))files['duck.py']=EXAMPLE;
   projectRecord=await projectStore.create('My first project',files,filename);
  }
  filename=Object.hasOwn(projectRecord.files,projectRecord.activeFile)?projectRecord.activeFile:Object.keys(projectRecord.files)[0]||'untitled.py';
  initial=projectRecord.files[filename]??'';
  try{localStorage.removeItem('build1234.code');localStorage.removeItem('build1234.filename');}catch{}
  navigator.storage?.persist?.().catch(()=>{});
 }catch(reason){startupCacheError=reason;}
}
let cacheTimer,cacheQueue=Promise.resolve(),lastSavedCache='',cacheReady=false,projectChanging=false;
let changing=false,runtime,busy=false,exporting=false,canExport=false,hasModel=false,generation=0,builtFilename=filename;
let builtSnapshot=null,projectRevision=0,buildNeedsSetup=false,progressMessage='Building model…',deleting=false;
let workspace=projectRecord?{name:projectRecord.name}:null,browserFiles={...projectRecord?.files},treeEntries=projectRecord?browserTree(projectRecord.files):[];
let expandedFolders=new Set();
const documents=new Map(projectRecord?Object.entries(projectRecord.files).map(([name,code])=>[name,{code,saved:code}]):[[filename,{code:initial,saved:initial}]]);
if(!documents.has(filename))documents.set(filename,{code:initial,saved:initial});
const editor=createEditor($('editor'),{value:initial,onChange:()=>{if(changing)return;const doc=documents.get(filename);doc.code=editor.getValue();sync();},onCursor:position=>{$('position').textContent=`Ln ${position.lineNumber}, Col ${position.column}`;}});
editor.setFilename(filename);
const cad=createCadPanel($('cad-view'));
const feedback=createViewerFeedback(preview,run);
const fileActions=createFileActions({isDiskFile:path=>!!window.desktop&&/^(\/|[A-Za-z]:[\\/])/.test(path),removeFile,onError:error});
const projectDialog=window.desktop?null:createProjectDialog({list:()=>projectStore.list(),current:()=>projectRecord?.id,create:newProject,open:openProject,remove:deleteProject,snapshot:()=>({...projectRecord,...cachePayload()})});
if(!window.desktop){
 const projects=document.createElement('button');projects.id='projects';projects.textContent='Projects';projects.onclick=()=>projectDialog.show();$('toolbar').prepend(projects);
 $('open-folder').textContent='Import folder';$('open').textContent='Import file';$('save').textContent='Save to cache';
 const downloadButton=document.createElement('button');downloadButton.id='download-file';downloadButton.textContent='Download file';downloadButton.onclick=()=>download(editor.getValue(),filename.split('/').pop(),'text/x-python');$('save').after(downloadButton);
 const note=document.createElement('p');note.className='cache-notice';note.textContent='Saved in this browser, not to disk or the cloud. Use Projects → Export ZIP for a backup.';explorer.append(note);
}
shell.onLayout(()=>{editor.layout();cad.layout();});
function cachePayload(){return {files:projectFiles(),activeFile:filename};}
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
 await projectStore.select(record.id);
 clearTimeout(cacheTimer);projectRecord=record;documents.clear();browserFiles={...record.files};
 for(const [name,code] of Object.entries(record.files))documents.set(name,{code,saved:code});
 filename=Object.hasOwn(record.files,record.activeFile)?record.activeFile:Object.keys(record.files)[0]||'untitled.py';
 if(!documents.has(filename))documents.set(filename,{code:'',saved:''});
 workspace={name:record.name};treeEntries=browserTree(browserFiles);expandedFolders.clear();
 hasModel=false;canExport=false;builtSnapshot=null;cad.clear();$('model-state').textContent='No model yet';$('model-state').title='';$('elapsed').textContent='';$('error-banner').hidden=true;
 changing=true;editor.setFilename(filename);editor.setValue(documents.get(filename).code);changing=false;
 renderTree();buttons();lastSavedCache=JSON.stringify(cachePayload());$('cache-status').textContent='Saved to browser cache';
}
async function newProject(name,files={'duck.py':EXAMPLE}){
 await changeProject(async()=>{const record=await projectStore.create(name,files,Object.keys(files).find(name=>name.endsWith('.py'))||Object.keys(files)[0]);await activateProject(record);});
}
async function openProject(id){
 if(id===projectRecord?.id)return;
 await changeProject(async()=>{const record=await projectStore.get(id);if(!record)throw new Error('This project no longer exists.');await activateProject(record);});
}
async function deleteProject(record){
 await changeProject(async()=>{
  const current=record.id===projectRecord?.id;
  await projectStore.remove(record.id,current?projectRecord.revision:record.revision);
  if(current){const next=(await projectStore.list())[0]||await projectStore.create('My first project',{'duck.py':EXAMPLE},'duck.py');await activateProject(next);}
 });
}
function projectFiles(){
 const files={...browserFiles};
 for(const [path,doc] of documents)if(!window.desktop||Object.hasOwn(files,path))files[path]=doc.code;
 return files;
}
function snapshot(){return JSON.stringify([filename,editor.getValue(),projectRevision,window.desktop?null:projectFiles()]);}
function updatePreview(){feedback.update({busy,hasModel,needsSetup:buildNeedsSetup,stale:!canExport||snapshot()!==builtSnapshot,disabled:!runtime||exporting||deleting,message:progressMessage});}
function dirty(){const doc=documents.get(filename);return doc.untitled||doc.code!==doc.saved;}
function sync(){
 $('filename').textContent=filename.split(/[\\/]/).pop();$('dirty').hidden=!dirty();
 shell.setTitle('source',$('filename').textContent,filename);
 for(const row of explorer.querySelectorAll('.file-row')){row.classList.toggle('selected',row.dataset.path===filename);row.setAttribute('aria-selected',String(row.dataset.path===filename));}
 if(window.desktop){try{localStorage.setItem('build1234.filename',filename);localStorage.setItem('build1234.code',editor.getValue());}catch{}}
 else scheduleCache();
 updatePreview();
}
function log(text){$('logs').textContent+=String(text)+'\n';$('logs').scrollTop=$('logs').scrollHeight;}
function status(text){$('runtime-status').textContent=text;if(busy){progressMessage=text;updatePreview();}}
function buttons(){
 $('run').disabled=!runtime||busy||exporting||deleting;$('empty-run').disabled=$('run').disabled;$('cancel').disabled=!busy;
 $('step').disabled=$('stl').disabled=!canExport||busy||exporting||deleting;
 updatePreview();
}
function error(error){const message=error.message||String(error);$('error-message').textContent=message.split('\n').filter(Boolean).at(-1);$('error-banner').hidden=false;log(message);}
async function run(){
 if(!runtime||busy||exporting||deleting)return;
 const token=++generation;const runningFile=filename;const code=editor.getValue();const runningSnapshot=snapshot();const files=projectFiles();
 buildNeedsSetup=runtime.needsSetup;busy=true;status(buildNeedsSetup?'Preparing Python and CAD…':'Building model…');buttons();$('error-banner').hidden=true;log(`› ${runningFile}`);
 shell.activate('preview');
 try{
   const result=await runtime.run({code,filename:runningFile,files});
   if(token!==generation)return;
   status('Preparing 3D preview…');
   await new Promise(requestAnimationFrame);
   if(token!==generation)return;
   cad.render(result.scene);$('empty-state').hidden=true;hasModel=true;canExport=true;builtFilename=runningFile;
   builtSnapshot=runningSnapshot;
   $('model-state').textContent='result';$('model-state').title=runningFile;$('elapsed').textContent=result.elapsed.toFixed(2)+'s';status('Ready');log(`Built in ${result.elapsed.toFixed(2)}s`);
 }catch(e){if(token!==generation)return;error(e);status('Build failed');$('model-state').textContent=hasModel?'Last successful model':'No model yet';}
 finally{if(token===generation){busy=false;buttons();}}
}
function cancel(){++generation;runtime?.cancel();busy=false;canExport=false;buttons();status('Cancelled');}
function load(data,{activate=true}={}){
 if(!data)return;
 filename=data.filename;
 if(!documents.has(filename))documents.set(filename,{code:data.code,saved:data.code});
 changing=true;editor.setFilename(filename);editor.setValue(documents.get(filename).code);changing=false;
 if(activate)shell.activate('source');sync();
 if(!workspace)renderTree();
}
function inWorkspace(path){return !!workspace&&(window.desktop?path.replaceAll('\\','/').startsWith(workspace.root.replaceAll('\\','/')+'/'):Object.hasOwn(browserFiles,path));}
function fileRow(entry,depth){
 const row=document.createElement('button');row.className='file-row';row.dataset.path=entry.path;row.setAttribute('role','treeitem');row.style.paddingLeft=`${12+depth*14}px`;row.textContent=(entry.name.endsWith('.py')?'◇  ':'·  ')+entry.name;
 row.onclick=async()=>{try{const existing=documents.get(entry.path);if(window.desktop&&inWorkspace(entry.path))load(await window.desktop.readFile(entry.path));else if(existing)load({filename:entry.path,code:existing.code});else load({filename:entry.path,code:browserFiles[entry.path]??''});}catch(e){error(e);}};
 fileActions.bind(row,entry);
 return row;
}
function appendEntries(parent,entries,depth=0){
 for(const entry of entries){
  if(entry.directory){
   const details=document.createElement('details');details.dataset.path=entry.path;const summary=document.createElement('summary');summary.className='folder-row';summary.style.paddingLeft=`${12+depth*14}px`;summary.textContent=entry.name;details.append(summary);
   const children=document.createElement('div');children.setAttribute('role','group');details.append(children);let loaded=false;
   details.addEventListener('toggle',async()=>{if(!details.open||loaded)return;loaded=true;try{appendEntries(children,entry.children||await window.desktop.listFiles(entry.path),depth+1);sync();}catch(e){loaded=false;error(e);}});parent.append(details);details.open=expandedFolders.has(entry.path);
  }else parent.append(fileRow(entry,depth));
 }
}
function renderTree(){
 expandedFolders=new Set([...$('file-tree').querySelectorAll('details[open]')].map(node=>node.dataset.path));
 $('file-tree').replaceChildren();
 const loose=[...documents.keys()].filter(path=>!inWorkspace(path));
 appendEntries($('file-tree'),loose.map(path=>({name:path.split(/[\\/]/).pop(),path})));
 if(workspace)appendEntries($('file-tree'),treeEntries);
 $('workspace-name').textContent=workspace?.name||'OPEN FILES';explorer.querySelector('.explorer-hint').hidden=!!workspace;sync();
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
 for(const path of Object.keys(files).sort()){
  let level=root;const parts=path.split('/');let prefix='';
  parts.forEach((name,i)=>{prefix+=(prefix?'/':'')+name;let entry=level.find(e=>e.name===name);if(!entry){entry={name,path:prefix,directory:i<parts.length-1,children:[]};level.push(entry);}level=entry.children;});
 }
 const sort=items=>{items.sort((a,b)=>Number(b.directory)-Number(a.directory)||a.name.localeCompare(b.name));items.forEach(i=>sort(i.children));};sort(root);return root;
}
$('open-folder').onclick=async()=>{try{if(window.desktop){const folder=await window.desktop.openFolder();if(folder){workspace=folder;treeEntries=folder.entries;renderTree();}}else folderInput.click();}catch(e){error(e);}};
folderInput.onchange=async()=>{try{
 const imported={};for(const file of folderInput.files){if(file.webkitRelativePath.split('/').some(part=>part.startsWith('.')||part==='node_modules'))continue;if(/\.(py|json|txt|csv|svg|step|stp)$/i.test(file.name))imported[file.webkitRelativePath]=await file.text();}
 const name=folderInput.files[0]?.webkitRelativePath.split('/')[0]||'Imported project';
 if(Object.keys(imported).length)await newProject(name,imported);
 }catch(reason){cacheFailure(reason);}finally{folderInput.value='';}
};
$('open').onclick=async()=>{try{if(window.desktop)load(await window.desktop.open());else fileInput.click();}catch(e){error(e);}};
fileInput.onchange=async()=>{try{const file=fileInput.files[0];if(file){let name=file.name,number=2;while(documents.has(name)||Object.hasOwn(browserFiles,name))name=file.name.replace(/(\.[^.]+)?$/,`-${number++}$1`);load({filename:name,code:await file.text()});renderTree();await flushCache();}}catch(reason){cacheFailure(reason);}finally{fileInput.value='';}};
function download(data,name,type){const url=URL.createObjectURL(new Blob([data],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function save(){try{
 const code=editor.getValue();if(window.desktop){const target=await window.desktop.save({filename,code});if(!target)return;documents.delete(filename);filename=target;documents.set(filename,{code,saved:code});editor.setFilename(filename);if(workspace)treeEntries=await window.desktop.listFiles(workspace.root);}
 else {await flushCache();}
 sync();renderTree();status(window.desktop?'Saved':'Saved to browser cache');
}catch(e){if(window.desktop)error(e);else cacheFailure(e);}}
$('save').onclick=save;$('run').onclick=run;$('empty-run').onclick=run;$('cancel').onclick=cancel;
$('new-file').onclick=()=>{
 const names=new Set([...documents.keys(),...Object.keys(browserFiles)].map(path=>path.split(/[\\/]/).pop()));
 let name='untitled.py',number=2;
 while(names.has(name))name=`untitled-${number++}.py`;
 documents.set(name,{code:'',saved:'',untitled:true});
 load({filename:name,code:''});renderTree();editor.focus();status(window.desktop?'New file — save to choose a location':'New file — saving to browser cache');
};
$('dismiss-error').onclick=()=>{$('error-banner').hidden=true;};$('clear-log').onclick=()=>{$('logs').textContent='';};
for(const format of ['step','stl'])$(format).onclick=async()=>{if(!canExport||busy||exporting)return;exporting=true;buttons();try{download(await runtime.exportModel(format),builtFilename.split(/[\\/]/).pop().replace(/\.py$/i,'')+'.'+format,'application/octet-stream');}catch(e){error(e);}finally{exporting=false;buttons();}};
document.addEventListener('keydown',event=>{if(projectChanging||document.querySelector('dialog[open]'))return;if((event.ctrlKey||event.metaKey)&&event.key==='Enter'){event.preventDefault();run();}if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();save();}},true);
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
