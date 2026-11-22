// Exercise the same source-and-CAD workspace on the public web app and the independent desktop viewer.
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, mkdir, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {chromium,_electron as electron} from 'playwright';
import {restoreArchive} from '../src/project-archive.js';

const root=await mkdtemp(path.join(os.tmpdir(),'duckbench-workspaces-'));
const web=await chromium.launch({channel:'chrome'});
const url=process.env.TEST_URL||'http://127.0.0.1:4198/';
let app;
const bytes=Buffer.alloc(134);bytes.writeUInt32LE(1,80);
[0,0,1,0,0,0,12,0,0,0,12,0].forEach((v,i)=>bytes.writeFloatLE(v,84+i*4));
const parts=[
  {name:'model.py',mimeType:'text/plain',buffer:Buffer.from('from build123d import Box\nfrom dimensions import width\nresult = Box(width,8,4)\n')},
  {name:'dimensions.py',mimeType:'text/plain',buffer:Buffer.from('width = 16\n')},
  {name:'mesh.stl',mimeType:'application/octet-stream',buffer:bytes}
];
async function project(page,name){
  await page.waitForFunction(expected=>document.querySelector('#project-name')?.textContent===expected,name);
}
async function viewFile(page,name){
  await page.getByRole('navigation',{name:'Project files'}).getByRole('button',{name,exact:true}).click();
  await page.waitForFunction(expected=>document.querySelector('#model-name').textContent===expected,name,{timeout:240000});
}
async function build(page){
  await viewFile(page,'model.py');
  assert.match(await page.locator('#source').textContent(),/from dimensions import width/);
  await page.locator('#build-preview').click();
  await page.locator('#viewport canvas').first().waitFor({timeout:240000});
}
async function launch(){
  const options=process.env.TEST_VIEWER?{args:[],executablePath:process.env.TEST_VIEWER}:{args:['electron/viewer-main.cjs']};
  app=await electron.launch({...options,args:[...options.args,'--user-data-dir='+path.join(root,'profile')]});
  const page=await app.firstWindow();
  await page.locator('#projects').waitFor();
  return page;
}
try{
  const page=await web.newPage();
  await page.goto(url);
  await page.locator('#toggle-explorer').click();
  await page.locator('#projects').click();await page.locator('#project-name').fill('Engine');
  await page.getByRole('button',{name:'New project',exact:true}).click();
  await page.locator('#projects').click();
  await page.getByRole('link',{name:'Open project viewer'}).click();
  await project(page,'Engine');
  await page.locator('#files-input').setInputFiles(parts);
  await viewFile(page,'mesh.stl');
  assert.ok(await page.locator('#viewport canvas').first().isVisible());
  await build(page);
  const downloaded=page.waitForEvent('download');await page.locator('#export').click();
  const zip=await readFile(await (await downloaded).path());
  assert.deepEqual(Buffer.from(restoreArchive(zip,'Engine.zip').modelFiles['mesh.stl']),bytes);
  await page.locator('#projects').click();await page.locator('#name').fill('Other');await page.getByRole('button',{name:'Create project'}).click();
  await project(page,'Other');assert.equal(await page.locator('#files button').count(),0);
  await page.reload();await project(page,'Other');
  await page.locator('#projects').click();await page.locator('.pick').filter({hasText:'Engine'}).click();
  await viewFile(page,'dimensions.py');
  await page.locator('#edit').click();await page.locator('#projects').click();
  const exportAgain=page.waitForEvent('download');
  await page.locator('.project-row').filter({hasText:'Engine'}).getByRole('button',{name:'Export ZIP'}).click();
  assert.deepEqual(Buffer.from(restoreArchive(await readFile(await (await exportAgain).path()),'backup.zip').modelFiles['mesh.stl']),bytes);
  let desktop=await launch();
  await app.evaluate(({dialog},parent)=>{dialog.showOpenDialog=async()=>({filePaths:[parent]});dialog.showMessageBox=async()=>({response:1});},root);
  await desktop.locator('#zip-input').setInputFiles({name:'Engine.zip',mimeType:'application/zip',buffer:zip});
  await project(desktop,'Engine');
  assert.deepEqual(await readFile(path.join(root,'Engine','mesh.stl')),bytes);
  await viewFile(desktop,'mesh.stl');await build(desktop);
  await mkdir(path.join(root,'Another'));await writeFile(path.join(root,'Another','model.py'),'# different model');
  await app.evaluate(({dialog},dir)=>{dialog.showOpenDialog=async()=>({filePaths:[dir]});},path.join(root,'Another'));
  await desktop.locator('#projects').click();await desktop.locator('#folder').click();
  await project(desktop,'Another');await viewFile(desktop,'model.py');assert.equal(await desktop.locator('#source').textContent(),'# different model');
  await app.close();app=null;desktop=await launch();await project(desktop,'Another');
  await desktop.locator('#close').click();
  await desktop.locator('.pick').filter({hasText:'Engine'}).click();await project(desktop,'Engine');
  const backup=path.join(root,'transfer.zip');
  await app.evaluate(({dialog},filePath)=>{dialog.showSaveDialog=async()=>({filePath});},backup);
  await desktop.locator('#export').click();
  await desktop.getByRole('status').filter({hasText:'Exported Engine.zip'}).waitFor();
  const restored=restoreArchive(await readFile(backup),'Engine.zip');
  assert.equal(restored.files['model.py'],parts[0].buffer.toString());assert.deepEqual(Buffer.from(restored.modelFiles['mesh.stl']),bytes);
  await page.locator('#import-zip:enabled').waitFor();
  await page.locator('#zip-input').setInputFiles({name:'transfer.zip',mimeType:'application/zip',buffer:await readFile(backup)});
  await page.locator('#projects-dialog').waitFor({state:'hidden'});
  await page.locator('#projects').click();
  await page.waitForFunction(()=>[...document.querySelectorAll('.project-row strong')].filter(node=>node.textContent==='Engine').length===2);
  console.log('Browser and desktop projects, Python and STL previews, switching, restart, and bidirectional ZIP transfer passed.');
}finally{await app?.close();await web.close();await rm(root,{recursive:true,force:true});}
