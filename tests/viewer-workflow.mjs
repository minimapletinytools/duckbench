// Start the production preview before running this test. Set TEST_VIEWER to test a packaged executable.
import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile, mkdtemp, rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {chromium, _electron as electron} from 'playwright';
import {projectArchive} from '../src/project-archive.js';
import {readCache, waitForCache} from './cache-helpers.mjs';

async function checkAssembly(page) {
  const bracket = page.locator('.tv-node-label').filter({hasText:/Bracket[ _]24/});
  if (!await bracket.count()) await page.locator('.tv-nav-marker').first().click();
  await bracket.waitFor();
  const spacer = page.locator('.tv-node-label').filter({hasText:'Spacer'});
  await spacer.waitFor();
  return spacer.locator('../..');
}

const archive = projectArchive({name:'Bracket project', activeFile:'parts/dimensions.py',runTarget:'model.py',
  files:{'parts/dimensions.py':'width = 24\n','model.py':`from build123d import Box, Compound, Cylinder, Pos
from parts.dimensions import width
bracket = Box(width, 12, 6)
bracket.label = f"Bracket {width}"
spacer = Pos(18, 0, 0) * Cylinder(3, 6)
spacer.label = "Spacer"
result = Compound(children=[bracket, spacer], label="Assembly")
`}});
const outputs = path.resolve('test-artifacts/viewer');
const profile = await mkdtemp(path.join(tmpdir(),'duckbench-viewer-'));
const browser = await chromium.launch({channel:'chrome'});
let desktop;
try {
  await mkdir(outputs,{recursive:true});
  const page = await browser.newPage();
  await page.goto(process.env.TEST_URL || 'http://127.0.0.1:4173');
  await waitForCache(page);
  async function restore() {
    await page.locator('#projects').click();
    await page.locator('#import-zip:enabled').waitFor();
    await page.locator('#zip-input').setInputFiles({name:archive.filename,mimeType:'application/zip',buffer:Buffer.from(archive.bytes)});
    await page.locator('#projects-dialog').waitFor({state:'hidden'});
    await waitForCache(page);
    return (await readCache(page)).active;
  }
  assert.notEqual(await restore(),await restore());
  await page.reload();
  await waitForCache(page);
  assert.equal(await page.locator('#tab-source').textContent(),'dimensions.py');
  assert.match(await page.locator('#run').textContent(),/Run model.py/);
  await page.locator('#run').click();
  await page.waitForFunction(()=>document.querySelector('#model-state').textContent==='result',null,{timeout:240000});
  await checkAssembly(page);
  async function download(button,filename){
    const [file] = await Promise.all([page.waitForEvent('download'),page.locator(button).click()]);
    await file.saveAs(path.join(outputs,filename));
  }
  await download('#step','bracket.step');
  await download('#stl','bracket.stl');
  await page.locator('#tab-source').click();
  await page.locator('#editor .view-lines').click();
  await page.keyboard.press(process.platform==='darwin'?'Meta+a':'Control+a');
  await page.keyboard.insertText('raise ValueError("bad dimensions")');
  await page.locator('#run').click();
  await page.waitForFunction(()=>document.querySelector('#runtime-status').textContent==='Build failed');
  assert.equal(await page.locator('#model-state').textContent(),'Last successful model');
  await page.getByRole('button',{name:'dimensions.py:1',exact:true}).click();
  assert.equal(await page.locator('#tab-source').textContent(),'dimensions.py');
  await page.locator('#tab-preview').click();
  await download('#export-viewer','bracket.html');
  await page.close();
  const offline = await browser.newContext({offline:true});
  const shared = await offline.newPage();
  const requests=[];
  shared.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url());});
  await shared.goto(pathToFileURL(path.join(outputs,'bracket.html')).href);
  await shared.locator('#viewport canvas').first().waitFor();
  const spacer = await checkAssembly(shared);
  const bracket = shared.locator('.tv-node-label').filter({hasText:/Bracket[ _]24/}).locator('../..');
  const state = await spacer.getAttribute('data-state0');
  const otherState = await bracket.getAttribute('data-state0');
  await spacer.locator('.tv-icon0').click();
  assert.notEqual(await spacer.getAttribute('data-state0'),state);
  assert.equal(await bracket.getAttribute('data-state0'),otherState);
  await spacer.locator('.tv-icon0').click();
  assert.deepEqual(requests,[]);
  assert.ok(await shared.locator('#open-cad').isHidden());
  assert.ok(await shared.evaluate(()=>JSON.parse(document.querySelector('#duckbench-licenses').textContent)['node_modules/three/LICENSE']));
  const scene = await shared.locator('#duckbench-scene').textContent();
  assert.ok(!scene.includes('from build123d'));
  const canvas = shared.locator('#viewport canvas').first();
  const bounds = await canvas.boundingBox();
  const x = bounds.x+bounds.width/2, y = bounds.y+bounds.height/2;
  await shared.mouse.move(x,y);await shared.mouse.down();
  await shared.mouse.move(x+65,y+30,{steps:8});await shared.mouse.up();
  await shared.screenshot({path:path.join(outputs,'offline-viewer.png')});
  const options = process.env.TEST_VIEWER ? {executablePath:process.env.TEST_VIEWER,args:[]} : {args:['electron/viewer-main.cjs']};
  desktop = await electron.launch({...options,args:[...options.args,'--user-data-dir='+profile,path.join(outputs,'bracket.step')]});
  const screen = await desktop.firstWindow();
  async function rendered(name){
    await screen.waitForFunction(expected=>document.querySelector('#model-name')?.textContent===expected,name,{timeout:90000});
    assert.ok(await screen.locator('#viewport canvas').first().isVisible());
  }
  async function open(filename){
    await desktop.evaluate(({dialog},filename)=>{dialog.showOpenDialog=async()=>({filePaths:[filename]});},filename);
    await screen.locator('#open-cad').click();
  }
  await rendered('bracket.step');
  await checkAssembly(screen);
  await open(path.join(outputs,'bracket.stl'));await rendered('bracket.stl');
  await open(path.join(outputs,'bracket.html'));await rendered('model.py');
  await checkAssembly(screen);
  const bad = path.join(profile,'invalid.html');
  await writeFile(bad,'<script>document.title="unexpected"</script>');
  await open(bad);
  await screen.getByRole('status').filter({hasText:'Select an HTML viewer'}).waitFor();
  assert.equal(await screen.locator('#model-name').textContent(),'model.py');
  await screen.screenshot({path:path.join(outputs,'desktop-viewer.png')});
  assert.ok((await readFile(path.join(outputs,'bracket.stl'))).length>84);
  console.log('ZIP restore, pinned nested imports, failed build traceback, offline HTML, native STEP/STL and HTML reopen passed.');
} finally {
  await desktop?.close();
  await browser.close();
  await rm(profile,{force:true,recursive:true});
}
