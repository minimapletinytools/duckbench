import {chromium, _electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
let app, browser, page;
if(process.env.TEST_DESKTOP){
  app=await electron.launch({...(process.env.TEST_APP?{executablePath:process.env.TEST_APP,args:[]}:{args:['.']}),env:{...process.env,ELECTRON_RUN_AS_NODE:''}});
  page=await app.firstWindow();
}else{
  browser=await chromium.launch({channel:'chrome',headless:true});
  page=await browser.newPage();
  await page.goto(process.env.TEST_URL||'http://127.0.0.1:4174');
}
try{
  if(app)await page.context().setOffline(true);
  await page.locator('#about').click();
  const frame=page.frameLocator('#about-dialog iframe');
  await frame.getByRole('heading',{name:'Application license'}).waitFor();
  assert.ok(await page.locator('#about-dialog').isVisible());
  assert.ok(await frame.getByText('three-cad-viewer by Bernhard Walter',{exact:true}).isVisible());
  const viewer=frame.locator('[data-component="three-cad-viewer"]');
  await viewer.locator(':scope > summary').click();
  await viewer.locator('details > summary').first().click();
  assert.match(await viewer.locator('pre').first().textContent(),/Copyright 2021 Benrhard Walter/);
  const build123d=frame.locator('[data-component="build123d"]');
  await build123d.locator(':scope > summary').click();
  assert.match(await build123d.textContent(),/originally derived from portions of the CadQuery/);
  const own=frame.locator('[data-component="Duckbench"]');
  assert.match(await own.textContent(),/Apache License/);
  assert.ok(await frame.locator('[data-component="monaco-editor"]').count());
  await fs.mkdir('test-artifacts',{recursive:true});
  await frame.getByRole('heading',{name:/Duckbench 0/}).scrollIntoViewIfNeeded();
  await page.screenshot({path:`test-artifacts/about-${app?'desktop':'web'}.png`});
  await page.locator('#close-about').click();
  assert.equal(await page.locator('#about-dialog').isVisible(),false);
  assert.equal(await page.locator('#about').evaluate(el=>el===document.activeElement),true);
  await page.locator('#about').click();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#about-dialog').isVisible(),false);
  console.log('About: credits, complete notices, Apache license, close and keyboard focus passed.');
}finally{await app?.close();await browser?.close();}
