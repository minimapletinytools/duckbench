import {createCadPanel} from '../src/cad-panel.js';
import {projectArchive,restoreArchive} from '../src/project-archive.js';
import {exportProject} from '../src/project-dialog.js';
import {validPath} from '../src/agent/tools.js';
import {browserProjects} from './browser-projects.js';
import './style.css';

const $=id=>document.getElementById(id);
const desktop=window.cadViewer;
const disk=desktop?.projects;
const report=text=>{$('notice').textContent=text;};
const browser=disk?null:browserProjects(report);
const cad=createCadPanel($('viewport'));
const lastKey='duckbench.viewer.project';
const supported=/\.(step|stp|stl|html|py|md|txt|json|toml|csv|svg|ya?ml)$/i;
let project=null, epoch=0, preview=0, selected=null, working=false;
function paths(record){return record.paths??[...Object.keys(record.files),...Object.keys(record.modelFiles||{})].sort();}
function remember(id){try{if(id)localStorage.setItem(lastKey,id);else localStorage.removeItem(lastKey);}catch{}}
function runnable(task){
  return async event=>{
    event?.preventDefault();
    if(working)return;
    working=true;
    try{await task();}catch(error){report(error.message);}
    finally{working=false;}
  };
}
function reset(){
  preview++;selected=null;$('build-preview').hidden=true;browser?.cancel();cad.clear();
  $('source').textContent='';$('source').hidden=true;$('viewport').hidden=false;$('model-name').textContent='';report('');
}
function display({model,source},name){
  if(model){
    if(model.version!==1||!Array.isArray(model.scene?.parts)||typeof model.name!=='string')throw new Error('Unsupported Duckbench scene.');
    const previous=$('viewport').hidden;
    $('viewport').hidden=false;
    try{cad.render(model.scene);}catch(error){$('viewport').hidden=previous;throw error;}
    $('source').hidden=true;
  }else{
    cad.clear();$('viewport').hidden=true;$('source').textContent=source;$('source').hidden=false;
  }
  $('model-name').textContent=model?.name||name;report('');
}
function displayLoose(result,name){
  showWorkspace();display(result,name);
  project=null;selected=null;remember(null);
  $('explorer').hidden=true;$('project-name').textContent='';$('build-preview').hidden=true;
}
function showWorkspace(){
  $('library').hidden=true;$('workspace').hidden=false;$('explorer').hidden=!project;cad.layout();
}
async function selectFile(name,button) {
  const token=++preview, record=project;
  $('build-preview').disabled=true;
  report('Opening '+name+'…');
  try{
    const result=disk?await disk.read(record.id,name):await browser.read(record,name);
    if(token!==preview||record!==project)return;
    display(result,name);selected=name;$('build-preview').hidden=!/\.py$/i.test(name);
    for(const row of $('files').querySelectorAll('button'))row.setAttribute('aria-current',String(row===button));
  }catch(error){if(token===preview)report(error.message);}
  finally{if(token===preview)$('build-preview').disabled=false;}
}
function showFiles(){
  $('files').replaceChildren();
  const groups=new Map([['',$('files')]]);
  for(const name of paths(project)){
    const parts=name.split('/');let key='',parent=$('files');
    for(const segment of parts.slice(0,-1)){
      key+=segment+'/';
      if(!groups.has(key)){
        const group=document.createElement('details'),summary=document.createElement('summary'),contents=document.createElement('div');
        summary.textContent=segment;group.open=true;group.append(summary,contents);parent.append(group);groups.set(key,contents);
      }
      parent=groups.get(key);
    }
    const button=document.createElement('button');button.textContent=parts.at(-1);button.title=name;
    button.onclick=()=>selectFile(name,button);parent.append(button);
  }
}
function activate(record){
  if(!record)return;
  epoch++;reset();project=record;remember(record.id);$('project-name').textContent=record.name;
  showWorkspace();showFiles();
  report(paths(record).length?'Select a project file.':'Add files to this project.');
}
async function listProjects(){
  const token=++epoch;
  $('library').hidden=false;$('workspace').hidden=true;$('back').hidden=!project&&!$('model-name').textContent;report('');
  const records=await (disk||browser).list();if(token!==epoch)return;
  const list=$('recent');list.replaceChildren();
  for(const record of records){
    const row=document.createElement('li'),pick=document.createElement('button'),title=document.createElement('strong'),detail=document.createElement('small');
    row.className='row';pick.className='pick';title.textContent=record.name;
    if(disk)detail.textContent=record.id;
    else{const count=paths(record).length;detail.textContent=count+(count===1?' file':' files');}
    pick.append(title,detail);pick.onclick=runnable(async()=>activate(await (disk||browser).open(record.id)));row.append(pick);
    const remove=document.createElement('button');remove.textContent=disk?'Forget':'Delete…';
    remove.onclick=runnable(async()=>{
      if(!disk&&!confirm('Delete '+record.name+' from this browser?'))return;
      if(disk)await disk.forget(record.id);else await browser.remove(record);
      if(project?.id===record.id){reset();project=null;remember(null);$('project-name').textContent='';}
      await listProjects();
    });
    row.append(remove);list.append(row);
  }
  if(!records.length)list.textContent='No projects yet.';
}
async function create(name,files={},modelFiles={},meta={}){
  const record=await (disk||browser).create(name,files,modelFiles,meta);if(record)activate(record);
}
async function collect(input,folder) {
  let size=0;
  const files=Object.create(null),modelFiles=Object.create(null);
  for(const file of input.files){
    const name=folder?file.webkitRelativePath.split('/').slice(1).join('/'):file.name;
    if(!supported.test(name)||name.split('/').some(s=>s.startsWith('.')||s==='node_modules'))continue;
    if(!validPath(name)||name.split('/').some(s=>['constructor','__proto__','prototype'].includes(s)))throw new Error('Unsupported file name.');
    if((size+=file.size)>128*1024*1024)throw new Error('Project import exceeds 128 MiB.');
    if(/\.stl$/i.test(name))modelFiles[name]=new Uint8Array(await file.arrayBuffer());
    else files[name]=await file.text();
  }
  return {files,modelFiles};
}
$('build-preview').onclick=async()=>{
  const name=selected,record=project,token=++preview;
  if(!record||!name)return;
  $('build-preview').disabled=true;report('Building '+name+'…');
  try {
    const model=disk?await disk.build(record.id,name):await browser.build(record,name);
    if(token===preview){if(model)display({model},name);else report('');}
  } catch(error){if(token===preview)report(error.message);}
  finally{if(token===preview)$('build-preview').disabled=false;}
};
$('projects').onclick=runnable(listProjects);
$('back').onclick=showWorkspace;
$('create').onsubmit=runnable(async()=>{const name=$('name').value.trim();if(name){await create(name);$('name').value='';}});
$('folder').onclick=runnable(async()=>disk?activate(await disk.folder()):$('folder-input').click());
$('folder-input').onchange=runnable(async()=>{
  const input=$('folder-input');
  try{if(input.files.length){const name=input.files[0].webkitRelativePath.split('/')[0];const {files,modelFiles}=await collect(input,true);await create(name,files,modelFiles);}}
  finally{input.value='';}
});
$('import').onclick=()=>$('zip-input').click();
$('zip-input').onchange=runnable(async()=>{
  const input=$('zip-input'),file=input.files[0];input.value='';if(!file)return;
  if(file.size>128*1024*1024)throw new Error('Project ZIP exceeds 128 MiB.');
  const record=restoreArchive(new Uint8Array(await file.arrayBuffer()),file.name);
  await create(record.name,record.files,record.modelFiles,record);
});
$('add').onclick=()=>$('files-input').click();
$('files-input').onchange=runnable(async()=>{
  const input=$('files-input');
  try{
    const {files,modelFiles}=await collect(input,false);
    const incoming=[...Object.keys(files),...Object.keys(modelFiles)];
    if(!incoming.length)throw new Error('Select a supported CAD or text file.');
    const existing=paths(project);
    if(incoming.some(name=>existing.some(p=>p===name||p.startsWith(name+'/')||name.startsWith(p+'/'))))throw new Error('A file or folder already uses that name.');
    activate(disk?await disk.add(project.id,files,modelFiles):await browser.add(project,files,modelFiles));
  }finally{input.value='';}
});
$('refresh').onclick=runnable(async()=>activate(await (disk||browser).open(project.id)));
$('export').onclick=runnable(async()=>{
  if(!disk){exportProject(project);return;}
  const {filename,bytes}=projectArchive(await disk.export(project.id));
  if(await disk.saveZip(filename,bytes))report('Exported '+filename);
});
$('close').onclick=runnable(async()=>{
  if(disk)await disk.close();reset();project=null;remember(null);$('project-name').textContent='';await listProjects();
});
$('open-cad').onclick=()=>disk?desktop.open():$('model-input').click();
$('model-input').onchange=async()=>{
  const file=$('model-input').files[0];$('model-input').value='';if(!file)return;
  const token=++preview;report('Opening '+file.name+'…');
  try{
    const data=/\.stl$/i.test(file.name)?new Uint8Array(await file.arrayBuffer()):await file.text();
    const result=await browser.loose(file.name,data);
    if(token===preview)displayLoose(result,file.name);
  }catch(error){if(token===preview)report(error.message);}
};
$('edit').hidden=$('workbench-home').hidden=!!disk;
$('edit').onclick=runnable(async()=>{await browser.select(project.id);location.href=$('edit').href;});
$('storage').textContent=disk?'Projects are folders on this computer.':'Projects are saved in this browser. Export a ZIP to keep a backup.';
$('folder').textContent=disk?'Open folder…':'Import folder…';
async function start(){
  const last=localStorage.getItem(lastKey);
  const params=new URLSearchParams(location.search);
  const requested=!disk&&params.get('project');
  const id=requested||last;
  if(requested)history.replaceState(null,'',location.pathname);
  if(id){try{
    activate(await (disk||browser).open(id));
    const requestedFile=requested&&params.get('file');
    if(requestedFile){const row=[...$('files').querySelectorAll('button')].find(item=>item.title===requestedFile);row?.click();}
  }catch(error){await listProjects();report(error.message);}}
  else await listProjects();
}
start().catch(error=>report(error.message)).finally(()=>{
  if(!desktop)return;
  desktop.onModel(({model,message})=>{
    preview++;
    if(model){try{displayLoose({model},model.name);}catch(error){report(error.message);}}
    else report(message);
  });
  desktop.ready();
});
