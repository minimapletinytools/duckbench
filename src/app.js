import './style.css';
import {installAbout} from './about.js';
import {PanelShell} from './panels.js';
import {createEditor} from './editor.js';
import {createCadPanel} from './cad-panel.js';
import {createRuntime} from './runtime.js';

const EXAMPLE=`from build123d import *

# Dimensions in millimeters.
plate = Box(60, 40, 12)
hole = Cylinder(9, 14)

result = plate - hole
result.label = "Mounting plate"
`;
const $=id=>document.getElementById(id);
const element=(className,html)=>{const node=document.createElement('div');node.className=className;node.innerHTML=html;return node;};
const shell=new PanelShell($('app'));
const disposeAbout=installAbout();
$('toolbar').innerHTML='<button id="open-folder">Open folder</button><button id="open">Open file</button><button id="save">Save</button><span class="toolbar-divider"></span><button id="run" class="primary" disabled>▶ Run</button><button id="cancel" disabled>■ Stop</button><button id="step" disabled>STEP ↓</button><button id="stl" disabled>STL ↓</button>';
const explorer=element('explorer-panel','<div class="panel-toolbar"><strong>EXPLORER</strong><button id="example" title="Open example">＋ Example</button></div><div id="workspace-name" class="workspace-name">OPEN FILES</div><div id="file-tree" class="explorer-tree" role="tree"></div><div class="explorer-hint">Open a folder to browse your project.</div>');
const source=element('editor-panel','<div class="panel-toolbar"><span id="filename">plate.py</span><span id="dirty" hidden>●</span><span class="panel-spacer"></span><span>Python</span></div><div id="editor" class="monaco-host"></div>');
const preview=element('viewer-panel','<div class="panel-toolbar"><span id="model-state">No model yet</span><span class="panel-spacer"></span><span id="elapsed"></span></div><div class="viewport-wrap"><div id="cad-view"></div><div id="empty-state"><strong>build123d</strong><p>Assign your model to <code>result</code>, then run.</p><button id="empty-run" class="primary">▶ Run model</button></div></div><div id="error-banner" role="alert" hidden><span id="error-message"></span><button id="dismiss-error" aria-label="Dismiss error">×</button></div>');
const consolePanel=element('console-panel','<div class="panel-toolbar"><strong>OUTPUT</strong><span class="panel-spacer"></span><button id="clear-log">Clear</button></div><pre id="logs"></pre>');
shell.register({id:'explorer',title:'Explorer',slot:'left',element:explorer});
shell.register({id:'source',title:'Code',slot:'center',element:source});
shell.register({id:'preview',title:'3D Preview',slot:'center',element:preview});
shell.register({id:'console',title:'Output',slot:'bottom',element:consolePanel});
shell.activate('preview');
$('statusbar').innerHTML='<span id="runtime-status" role="status">Ready to run</span><span class="panel-spacer"></span><span id="position">Python</span><span class="status-text">result → model</span>';
const fileInput=document.createElement('input');fileInput.type='file';fileInput.accept='.py';fileInput.hidden=true;document.body.append(fileInput);
const folderInput=document.createElement('input');folderInput.type='file';folderInput.webkitdirectory=true;folderInput.multiple=true;folderInput.hidden=true;document.body.append(folderInput);
let filename='plate.py',initial=EXAMPLE;
try{filename=localStorage.getItem('build1234.filename')||filename;initial=localStorage.getItem('build1234.code')??initial;}catch{}
let changing=false,runtime,busy=false,exporting=false,canExport=false,hasModel=false,generation=0,builtFilename=filename;
let workspace=null,browserFiles={},treeEntries=[];
const documents=new Map([[filename,{code:initial,saved:initial}]]);
const editor=createEditor($('editor'),{value:initial,onChange:()=>{if(changing)return;const doc=documents.get(filename);doc.code=editor.getValue();sync();},onCursor:position=>{$('position').textContent=`Ln ${position.lineNumber}, Col ${position.column}`;}});
editor.setFilename(filename);
const cad=createCadPanel($('cad-view'));
shell.onLayout(()=>{editor.layout();cad.layout();});
function dirty(){const doc=documents.get(filename);return doc.code!==doc.saved;}
function sync(){
 $('filename').textContent=filename.split(/[\\/]/).pop();$('dirty').hidden=!dirty();
 for(const row of explorer.querySelectorAll('.file-row')){row.classList.toggle('selected',row.dataset.path===filename);row.setAttribute('aria-selected',String(row.dataset.path===filename));}
 try{localStorage.setItem('build1234.filename',filename);localStorage.setItem('build1234.code',editor.getValue());}catch{}
}
function log(text){$('logs').textContent+=String(text)+'\n';$('logs').scrollTop=$('logs').scrollHeight;}
function status(text){$('runtime-status').textContent=text;}
function buttons(){
 $('run').disabled=!runtime||busy||exporting;$('empty-run').disabled=$('run').disabled;$('cancel').disabled=!busy;
 $('step').disabled=$('stl').disabled=!canExport||busy||exporting;
}
function error(error){const message=error.message||String(error);$('error-message').textContent=message.split('\n').filter(Boolean).at(-1);$('error-banner').hidden=false;log(message);}
async function run(){
 if(!runtime||busy||exporting)return;
 const token=++generation;const runningFile=filename;const code=editor.getValue();busy=true;buttons();$('error-banner').hidden=true;status('Building…');log(`› ${runningFile}`);
 shell.activate('preview');
 try{
   const result=await runtime.run({code,filename:runningFile,files:browserFiles});
   if(token!==generation)return;
   cad.render(result.scene);$('empty-state').hidden=true;hasModel=true;canExport=true;builtFilename=runningFile;
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
function fileRow(entry,depth){
 const row=document.createElement('button');row.className='file-row';row.dataset.path=entry.path;row.setAttribute('role','treeitem');row.style.paddingLeft=`${12+depth*14}px`;row.textContent=(entry.name.endsWith('.py')?'◇  ':'·  ')+entry.name;
 row.onclick=async()=>{try{const existing=documents.get(entry.path);if(window.desktop&&workspace)load(await window.desktop.readFile(entry.path));else if(existing)load({filename:entry.path,code:existing.code});else load({filename:entry.path,code:browserFiles[entry.path]??''});}catch(e){error(e);}};
 return row;
}
function appendEntries(parent,entries,depth=0){
 for(const entry of entries){
  if(entry.directory){
   const details=document.createElement('details');const summary=document.createElement('summary');summary.className='folder-row';summary.style.paddingLeft=`${12+depth*14}px`;summary.textContent=entry.name;details.append(summary);
   const children=document.createElement('div');children.setAttribute('role','group');details.append(children);let loaded=false;
   details.addEventListener('toggle',async()=>{if(!details.open||loaded)return;loaded=true;try{appendEntries(children,entry.children||await window.desktop.listFiles(entry.path),depth+1);sync();}catch(e){loaded=false;error(e);}});parent.append(details);
  }else parent.append(fileRow(entry,depth));
 }
}
function renderTree(){
 $('file-tree').replaceChildren();
 appendEntries($('file-tree'),workspace?treeEntries:[...documents.keys()].map(path=>({name:path.split(/[\\/]/).pop(),path})));
 $('workspace-name').textContent=workspace?.name||'OPEN FILES';explorer.querySelector('.explorer-hint').hidden=!!workspace;sync();
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
folderInput.onchange=async()=>{
 browserFiles={};for(const file of folderInput.files){if(file.webkitRelativePath.split('/').some(part=>part.startsWith('.')||part==='node_modules'))continue;if(/\.(py|json|txt|csv|svg|step|stp)$/i.test(file.name))browserFiles[file.webkitRelativePath]=await file.text();}
 workspace={name:folderInput.files[0]?.webkitRelativePath.split('/')[0]||'Project'};treeEntries=browserTree(browserFiles);renderTree();folderInput.value='';
};
$('open').onclick=async()=>{try{if(window.desktop)load(await window.desktop.open());else fileInput.click();}catch(e){error(e);}};
fileInput.onchange=async()=>{const file=fileInput.files[0];if(file)load({filename:file.name,code:await file.text()});fileInput.value='';};
function download(data,name,type){const url=URL.createObjectURL(new Blob([data],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function save(){try{
 const code=editor.getValue();if(window.desktop){const target=await window.desktop.save({filename,code});if(!target)return;documents.delete(filename);filename=target;documents.set(filename,{code,saved:code});editor.setFilename(filename);}
 else {download(code,filename.split('/').pop(),'text/x-python');documents.get(filename).saved=code;if(workspace)browserFiles[filename]=code;}
 sync();renderTree();status('Saved');
}catch(e){error(e);}}
$('save').onclick=save;$('run').onclick=run;$('empty-run').onclick=run;$('cancel').onclick=cancel;
$('example').onclick=()=>load({filename:'example.py',code:EXAMPLE});
$('dismiss-error').onclick=()=>{$('error-banner').hidden=true;};$('clear-log').onclick=()=>{$('logs').textContent='';};
for(const format of ['step','stl'])$(format).onclick=async()=>{if(!canExport||busy||exporting)return;exporting=true;buttons();try{download(await runtime.exportModel(format),builtFilename.split(/[\\/]/).pop().replace(/\.py$/i,'')+'.'+format,'application/octet-stream');}catch(e){error(e);}finally{exporting=false;buttons();}};
document.addEventListener('keydown',event=>{if($('about-dialog').open)return;if((event.ctrlKey||event.metaKey)&&event.key==='Enter'){event.preventDefault();run();}if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();save();}},true);
window.desktop?.onFileChanged(data=>{
 const doc=documents.get(data.filename);if(!doc)return;
 if(doc.code!==doc.saved){log('File changed on disk; keeping your unsaved edits.');return;}
 doc.code=doc.saved=data.code;if(data.filename===filename){load(data,{activate:false});if(!busy&&!exporting)run();}
});
window.addEventListener('beforeunload',()=>{disposeAbout();shell.dispose();editor.dispose();cad.dispose();runtime?.dispose();});
renderTree();
try{runtime=await createRuntime({onLog:log,onStatus:status});buttons();log(window.desktop?'Native Python ready to run.':'Browser Python loads on first run.');}catch(e){error(e);}
