// Check both the upgrade from multi-project browser caches and the installed desktop entry point.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {chromium,_electron as electron} from 'playwright';
import {waitForCache,readCache} from './cache-helpers.mjs';
import {unzipSync,strFromU8} from 'fflate';
import {restoreArchive} from '../src/project-archive.js';

const base=new URL(process.env.TEST_URL||'http://localhost:4197/');
const folder=await mkdtemp(path.join(os.tmpdir(),'duckbench-shell-'));
const browser=await chromium.launch({channel:'chrome'});
let app;
async function launch(){
  const options=process.env.TEST_VIEWER?{args:[],executablePath:process.env.TEST_VIEWER}:{args:['electron/viewer-main.cjs']};
  app=await electron.launch({...options,args:[...options.args,'--user-data-dir='+path.join(folder,'profile')]});
  const p=await app.firstWindow();await p.locator('.monaco-editor').waitFor();return p;
}
try{
  const context=await browser.newContext(),page=await context.newPage();
  await page.goto(new URL('icons/duck-64.png',base).href);
  await page.evaluate(async()=>{
    const db=await new Promise(resolve=>{const r=indexedDB.open('duckbench-projects',1);r.onupgradeneeded=()=>{r.result.createObjectStore('projects',{keyPath:'id'});r.result.createObjectStore('meta');};r.onsuccess=()=>resolve(r.result);});
    const tx=db.transaction(['projects','meta'],'readwrite'),p=tx.objectStore('projects');
    for(const [id,name] of [['one','Earlier'],['two','Active bracket']]){
      p.put({id,name,files:{'parts/main.py':'# '+name},modelFiles:{'mesh.stl':new Uint8Array([1,2,3])},activeFile:'parts/main.py',runTarget:'parts/main.py',expanded:['parts'],revision:7,created:1,updated:2});
    }
    tx.objectStore('meta').put('two','active');await new Promise(resolve=>tx.oncomplete=resolve);db.close();
  });
  const second=await context.newPage();
  await Promise.all([page.goto(new URL('viewer/',base).href),second.goto(base.href)]);
  for(const p of [page,second]){
    await waitForCache(p);await p.locator('.monaco-editor').waitFor();
    assert.equal(await p.locator('#workspace-name').textContent(),'Default Project');
    assert.equal(await p.locator('#tab-source').textContent(),'main.py');
  }
  const cache=await readCache(page);assert.equal(cache.active,'two');assert.equal(cache.projects.length,2);
  assert.equal(cache.projects.find(p=>p.id==='two').revision,8);
  const zip=page.waitForEvent('download');await page.getByRole('button',{name:'Export Earlier ZIP'}).click();
  const legacy=restoreArchive(await readFile(await(await zip).path()),'earlier.zip');
  assert.equal(legacy.files['parts/main.py'],'# Earlier');assert.deepEqual([...legacy.modelFiles['mesh.stl']],[1,2,3]);
  const workspace=path.join(folder,'Gearbox');await mkdir(workspace);
  await writeFile(path.join(workspace,'model.py'),'# main');await writeFile(path.join(workspace,'helper.py'),'# helper');
  let screen=await launch();
  await app.evaluate(({dialog},dir)=>{dialog.showOpenDialog=async()=>({filePaths:[dir]});},workspace);
  await screen.getByRole('button',{name:'Open workspace…'}).click();await screen.getByRole('treeitem',{name:/helper.py/}).click();
  await screen.locator('#workspace-name').click({button:'right'});await screen.getByRole('menuitem',{name:'New folder…'}).click();await screen.getByLabel('New folder name').fill('parts');
  await screen.getByRole('button',{name:'Create',exact:true}).click();
  await screen.locator('#file-tree summary').filter({hasText:'parts'}).waitFor();
  const parts=screen.locator('#file-tree summary').filter({hasText:'parts'});
  await parts.click({button:'right'});await screen.getByRole('menuitem',{name:'New file…'}).click();
  await screen.getByLabel('New file name').fill('axle.py');await screen.getByRole('button',{name:'Create',exact:true}).click();
  await screen.waitForFunction(()=>document.querySelector('#filename').textContent==='axle.py');
  await screen.keyboard.insertText('# unsaved axle');
  const archive=path.join(folder,'parts.zip');
  await app.evaluate(({dialog},filePath)=>{dialog.showSaveDialog=async()=>({filePath});},archive);
  await parts.click({button:'right'});await screen.getByRole('menuitem',{name:'Download folder (ZIP)'}).click();
  await screen.waitForFunction(()=>!document.querySelector('#file-context-menu')||document.querySelector('#file-context-menu').hidden);
  let bytes;
  for(let i=0;i<60&&!bytes?.length;i++){try{bytes=await readFile(archive);}catch{}if(!bytes?.length)await new Promise(r=>setTimeout(r,50));}
  assert.equal(strFromU8(unzipSync(bytes)['parts/axle.py']),'# unsaved axle');
  assert.equal(await readFile(path.join(workspace,'parts','axle.py'),'utf8'),'');
  await screen.getByRole('treeitem',{name:/helper.py/}).click();
  await app.close();app=null;screen=await launch();
  await screen.waitForFunction(()=>document.querySelector('#tab-source')?.textContent==='helper.py');
  assert.equal(await screen.locator('#workspace-name').textContent(),'Gearbox');
  assert.ok(await screen.locator('.monaco-editor').isVisible());
  await screen.locator('#toggle-agent').click();assert.ok(await screen.getByLabel('Message to agent').isVisible());
  console.log('Former viewer URL, concurrent cache migration, legacy ZIP recovery, Monaco and workspace restart passed.');
}finally{await app?.close();await browser.close();await rm(folder,{recursive:true,force:true});}
