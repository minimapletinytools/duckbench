import {_electron as electron} from 'playwright';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'duckbench-files-'));
const workspace=path.join(temporary,'project');
await fs.mkdir(workspace);
const model=path.join(workspace,'model.py');
const outside=path.join(temporary,'outside.py');
const code='from build123d import *\nresult = Box(10, 10, 10)\n';
await fs.writeFile(model,code);
await fs.writeFile(outside,code);
await fs.symlink(outside,path.join(workspace,'linked.py'));
const app=await electron.launch({args:['.',`--user-data-dir=${path.join(temporary,'profile')}`],env:{...process.env,ELECTRON_RUN_AS_NODE:''}});
try{
 const page=await app.firstWindow();
 await app.evaluate(({dialog,shell},{workspace,temporary})=>{
  dialog.showOpenDialog=async()=>({canceled:false,filePaths:[workspace]});
  // Verify the Trash operation without leaving test files in the user's Trash.
  shell.trashItem=async filename=>process.getBuiltinModule('fs').renameSync(filename,process.getBuiltinModule('path').join(temporary,'trashed.py'));
 },{workspace,temporary});
 await page.locator('#open-folder').click();
 await page.getByRole('treeitem',{name:/model.py/}).click();
 await page.locator('#run').click();
 await page.waitForFunction(()=>document.querySelector('#model-state').textContent==='result',null,{timeout:90000});
 const firstScene=await page.locator('.cad-instance').getAttribute('id');
 await fs.writeFile(model,code+'# Changed on disk\n');
 await page.locator('#refresh-preview').waitFor({state:'visible'});
 assert.equal(await page.locator('.cad-instance').getAttribute('id'),firstScene);
 assert.equal(await page.locator('#run').isEnabled(),true);
 await page.locator('#refresh-preview').click();
 await page.waitForFunction(()=>!document.querySelector('#run').disabled);
 assert.equal(await page.locator('#refresh-preview').isVisible(),false);
 for(const target of [outside,workspace,path.join(workspace,'linked.py')]){
  assert.equal(await page.evaluate(async filename=>{
   try{await window.desktop.trashFile(filename);return 'unexpected success';}catch{return 'rejected';}
  },target),'rejected');
 }
 await page.getByRole('treeitem',{name:/model.py/}).focus();
 await page.keyboard.press('Shift+F10');
 await page.getByRole('menuitem',{name:'Delete file…'}).click();
 assert.match(await page.locator('#delete-file-description').textContent(),/moved to Trash/);
 await page.keyboard.press('Escape');
 assert.equal(await fs.readFile(model,'utf8'),code+'# Changed on disk\n');
 await page.getByRole('treeitem',{name:/model.py/}).click({button:'right'});
 await page.getByRole('menuitem',{name:'Delete file…'}).click();
 await page.locator('#confirm-delete').click();
 await page.getByRole('treeitem',{name:/model.py/}).waitFor({state:'detached'});
 assert.equal(await fs.readFile(path.join(temporary,'trashed.py'),'utf8'),code+'# Changed on disk\n');
 assert.equal(await fs.readFile(outside,'utf8'),code);
 assert.equal(await page.locator('#filename').textContent(),'plate.py');
 await page.getByRole('tab',{name:'3D Preview',exact:true}).click();
 assert.ok(await page.locator('#refresh-preview').isVisible());
 console.log('Desktop: disk-change refresh, keyboard menu, cancellation, Trash, and deletion boundaries passed.');
 }catch(error){console.error(await (await app.firstWindow()).locator('#logs').textContent());throw error;}
 finally{await app.close();await fs.rm(temporary,{recursive:true,force:true});}
