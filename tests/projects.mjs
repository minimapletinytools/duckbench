import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {unzipSync,strFromU8} from 'fflate';
import {waitForCache,readCache,cachedCode} from './cache-helpers.mjs';

const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:1280,height:850}});
const page=await context.newPage();
const url=process.env.TEST_URL||'http://127.0.0.1:4176';
const original=`from build123d import *

# Dimensions in millimeters.
plate = Box(60, 40, 12)
hole = Cylinder(9, 14)

result = plate - hole
result.label = "Mounting plate"
`;
const selectAll=process.platform==='darwin'?'Meta+a':'Control+a';
async function edit(target,text){await target.locator('#tab-source').click();await target.locator('#editor .view-lines').click();await target.keyboard.press(selectAll);await target.keyboard.insertText(text);}
async function switchTo(name){await page.locator('#projects').click();await page.locator('.project-row').filter({has:page.locator('strong',{hasText:name})}).getByRole('button',{name:'Open',exact:true}).click();await page.waitForFunction(name=>document.querySelector('#workspace-name').textContent===name,name);}
try{
 await page.addInitScript(code=>{if(!localStorage.getItem('test-migrated')){localStorage.setItem('build1234.filename','example.py');localStorage.setItem('build1234.code',code);localStorage.setItem('test-migrated','yes');}},original);
 await page.goto(url);await waitForCache(page);
 assert.equal(await page.locator('#filename').textContent(),'example.py');
 assert.match(await cachedCode(page),/Puddle the duck/);
 assert.equal(await page.evaluate(()=>localStorage.getItem('build1234.code')),null);
 let downloads=0;page.on('download',()=>downloads++);
 await page.locator('#new-file').click();await page.keyboard.insertText('# Project A helper\nanswer = 42');
 await page.locator('#save').click();await waitForCache(page);
 assert.equal(downloads,0,'Save to cache must not download');
 await page.reload();await waitForCache(page);
 assert.equal(await page.getByRole('treeitem').count(),2);
 assert.match(await cachedCode(page),/Project A helper/);
 await page.locator('#projects').click();await page.locator('#project-name').fill('Second pond');await page.getByRole('button',{name:'New project',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('#workspace-name').textContent==='Second pond');
 assert.equal(await page.locator('#filename').textContent(),'duck.py');assert.equal(await page.getByRole('treeitem').count(),1);
 await edit(page,'# Project B\nfrom build123d import *\nresult = Sphere(5)');await waitForCache(page);
 await page.reload();await waitForCache(page);assert.match(await cachedCode(page),/Project B/);
 await switchTo('My first project');assert.match(await cachedCode(page),/Project A helper/);
 const before=await readCache(page);assert.equal(before.projects.length,2);
 await page.locator('#projects').click();
 const row=page.locator('.project-row').filter({has:page.locator('strong',{hasText:'My first project'})});
 const zipPromise=page.waitForEvent('download');await row.getByRole('button',{name:'Export ZIP'}).click();const zip=await zipPromise;
 const files=unzipSync(await fs.readFile(await zip.path()));
 assert.match(strFromU8(files['My_first_project/example.py']),/Puddle the duck/);
 assert.match(strFromU8(files['My_first_project/untitled.py']),/answer = 42/);
 await fs.mkdir('test-artifacts',{recursive:true});await page.screenshot({path:'test-artifacts/projects.png'});
 await page.locator('#close-projects').click();
 await page.getByRole('treeitem',{name:/untitled.py/}).click({button:'right'});await page.getByRole('menuitem',{name:'Delete file…'}).click();await page.locator('#confirm-delete').click();await page.getByRole('treeitem',{name:/untitled.py/}).waitFor({state:'detached'});await waitForCache(page);
 await page.reload();await waitForCache(page);assert.equal(await page.getByRole('treeitem',{name:/untitled.py/}).count(),0);
 await page.locator('#projects').click();const second=page.locator('.project-row').filter({has:page.locator('strong',{hasText:'Second pond'})});
 await second.getByRole('button',{name:'Delete…'}).click();await second.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal((await readCache(page)).projects.length,2);
 await second.getByRole('button',{name:'Delete…'}).click();await second.getByRole('button',{name:'Delete project',exact:true}).click();await second.waitFor({state:'detached'});await page.locator('#close-projects').click();
 await page.reload();await waitForCache(page);assert.equal((await readCache(page)).projects.length,1);
 const deletedId=(await readCache(page)).active;await page.locator('#projects').click();const activeRow=page.locator('.project-row');await activeRow.getByRole('button',{name:'Delete…'}).click();await activeRow.getByRole('button',{name:'Delete project',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#filename').textContent==='duck.py');await page.locator('#close-projects').click();await page.reload();await waitForCache(page);assert.ok(!(await readCache(page)).projects.some(project=>project.id===deletedId));
 // The separator changes actual pane widths, supports keys, and restores the ratio.
 await page.locator('#toggle-split').click();const divider=page.locator('#splitter-center');const bounds=await divider.boundingBox();const editorBefore=await page.locator('#panel-source').boundingBox();
 await page.mouse.move(bounds.x+2,bounds.y+100);await page.mouse.down();await page.mouse.move(bounds.x+160,bounds.y+100,{steps:8});await page.mouse.up();
 assert.ok((await page.locator('#panel-source').boundingBox()).width>editorBefore.width+120);
 await divider.focus();const beforeKey=Number(await divider.getAttribute('aria-valuenow'));await page.keyboard.press('ArrowLeft');assert.ok(Number(await divider.getAttribute('aria-valuenow'))<beforeKey);
 const ratio=await divider.getAttribute('aria-valuenow');await page.reload();await waitForCache(page);await page.locator('#toggle-split').click();assert.equal(await page.locator('#splitter-center').getAttribute('aria-valuenow'),ratio);
 await page.setViewportSize({width:500,height:800});await page.waitForFunction(()=>document.querySelector('#splitter-center').getAttribute('aria-orientation')==='horizontal');
 const mobile=await divider.boundingBox();const height=(await page.locator('#panel-source').boundingBox()).height;await page.mouse.move(mobile.x+50,mobile.y+2);await page.mouse.down();await page.mouse.move(mobile.x+50,mobile.y-70,{steps:6});await page.mouse.up();assert.ok((await page.locator('#panel-source').boundingBox()).height<height-40);
 // A stale tab cannot silently overwrite a more recent project's files.
 const stale=await context.newPage();await stale.goto(url);await waitForCache(stale);
 await page.setViewportSize({width:1280,height:850});await edit(page,'# Newer edits in first tab');await waitForCache(page);
 await edit(stale,'# Older tab edits');await stale.waitForFunction(()=>document.querySelector('#cache-status').textContent.includes('Not saved'));
 assert.match(await cachedCode(page),/Newer edits/);await stale.close();
 // A real failed write must retain edits and show a failure, not a Saved state.
 await page.evaluate(()=>{const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(this.name==='projects')throw new DOMException('Test quota exceeded','QuotaExceededError');return put.apply(this,args);};});
 await edit(page,'# Keep me despite storage failure');await page.waitForFunction(()=>document.querySelector('#cache-status').textContent.includes('Not saved'));
 const filePromise=page.waitForEvent('download');await page.locator('#download-file').click();const file=await filePromise;assert.match(await fs.readFile(await file.path(),'utf8'),/Keep me despite storage failure/);
 // Modified legacy examples stay intact and get a separate duck starter.
 const preserved=await browser.newPage();await preserved.addInitScript(code=>{localStorage.setItem('build1234.filename','example.py');localStorage.setItem('build1234.code',code);},original+'# User edits\n');await preserved.goto(url);await waitForCache(preserved);assert.match(await cachedCode(preserved),/User edits/);assert.ok(await preserved.getByRole('treeitem',{name:/duck.py/}).isVisible());await preserved.close();
 console.log('Projects: legacy migration, autosave/reload, multiple projects, ZIP export, deletion, cache failures, stale-tab protection, and draggable split passed.');
}finally{await context.close();await browser.close();}
