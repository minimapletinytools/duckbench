import {_electron as electron} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const app=await electron.launch({...(process.env.TEST_APP ? {executablePath:process.env.TEST_APP,args:[]} : {args:['.']}),env:{...process.env,ELECTRON_RUN_AS_NODE:''}});
try {
 const page=await app.firstWindow();const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.locator('#run').click();
 await page.waitForFunction(()=>document.querySelector('#model-state').textContent==='result',null,{timeout:90000});
 async function checkCanvas(){
  await page.waitForTimeout(250);
  const bounds=await page.evaluate(()=>{
   const host=document.querySelector('#cad-view').getBoundingClientRect();
   const canvas=document.querySelector('#cad-view canvas').getBoundingClientRect();
   return {host:{x:host.x,y:host.y,width:host.width,height:host.height},canvas:{x:canvas.x,y:canvas.y,width:canvas.width,height:canvas.height}};
  });
  const {host,canvas}=bounds;
  assert.ok(Math.abs(host.x+host.width-canvas.x-canvas.width)<8,JSON.stringify(bounds));
  assert.ok(Math.abs(host.y+host.height-canvas.y-canvas.height)<8,JSON.stringify(bounds));
  assert.ok(canvas.height>host.height-70,JSON.stringify(bounds));
 }
 await checkCanvas();
 await page.locator('#toggle-explorer').click();await checkCanvas();
 await page.locator('#toggle-explorer').click();
 await page.locator('#toggle-split').click();await checkCanvas();
 assert.ok(await page.locator('.monaco-editor').isVisible());
 await page.locator('#toggle-split').click();
 await page.locator('#toggle-console').click();await checkCanvas();
 await page.locator('#toggle-console').click();
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1100,720));await checkCanvas();
 const folder=path.resolve('examples');
 await app.evaluate(({dialog},folder)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[folder]});},folder);
 await page.locator('#open-folder').click();
 await page.getByRole('treeitem',{name:/bracket.py/}).click();
 assert.ok(await page.locator('.monaco-editor').isVisible());
 await page.locator('#editor .view-lines').click();
 await page.keyboard.press('Meta+End');await page.keyboard.insertText('\n# edited in Monaco');
 await page.waitForFunction(()=>!document.querySelector('#dirty').hidden);
 await page.locator('#run').click();await page.waitForFunction(()=>!document.querySelector('#run').disabled);
 await checkCanvas();
 const length=await page.evaluate(async()=>(await window.desktop.request({method:'export',params:{format:'step'}})).length);
 assert.ok(length>100);assert.deepEqual(errors,[]);
 await fs.mkdir('test-artifacts',{recursive:true});
 await page.screenshot({path:'test-artifacts/desktop.png'});
 console.log('Desktop: Monaco, folder explorer, full canvas bounds, panel toggles, window resize, model and STEP passed.');
} finally {await app.close();}
