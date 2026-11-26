// The 3D view: hover and pick a face, its measurements and selector, inserting the selector,
// dimensions, the parts list, the orientation cube and the prompt at a spot.
// Start the production preview first (npm run preview), or set TEST_URL.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const url = process.env.TEST_URL || 'http://127.0.0.1:4173';
const browser = await chromium.launch({channel: 'chrome', headless: true});
const page = await browser.newPage({viewport: {width: 1280, height: 850}});
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const selectAll = process.platform === 'darwin' ? 'Meta+a' : 'Control+a';
try {
  await page.goto(url);
  await page.locator('#new-file').waitFor();
  // A flat plate: from the default view, the middle of the preview is on its top face.
  await page.locator('#tab-source').click();
  await page.locator('#editor .view-lines').click();
  await page.keyboard.press(selectAll);
  await page.keyboard.insertText('from build123d import *\n# --- Plate\nWIDTH = 80  # plate width, mm\nTHICKNESS = 4\nplate = Box(WIDTH, WIDTH, THICKNESS) - Pos(30, 30, 0) * Cylinder(3, THICKNESS)\nplate.label = "Plate"\nresult = plate\n');
  await page.locator('#run').click();
  await page.waitForFunction(() => document.querySelector('#model-state').textContent === 'result', null, {timeout: 240000});
  const view = page.locator('#cad-view');
  const canvas = view.locator('canvas.dbv-canvas');
  await page.waitForTimeout(400);
  const box = await canvas.boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;

  // Dimensions: the overall size and the hole.
  await view.locator('.dim-label').filter({hasText: /^80 mm$/}).first().waitFor();
  await view.locator('.dim-label').filter({hasText: '⌀6 mm'}).waitFor();

  // Hover names what a click would pick.
  await page.mouse.move(x, y);
  await view.locator('.dbv-hint.is-visible').filter({hasText: 'plane face'}).waitFor();
  await page.mouse.click(x, y);
  const card = view.getByRole('region', {name: 'Selection'});
  await card.getByText('plane face', {exact: true}).waitFor();
  await card.getByText('6371.73 mm²').waitFor();
  assert.equal(await card.locator('code').textContent(), 'result.faces().sort_by(Axis.Z)[-1]');
  assert.match(await card.textContent(), /Normal\s*0, 0, 1/);
  await fs.mkdir('test-artifacts', {recursive: true});
  await page.screenshot({path: 'test-artifacts/viewer-pick.png'});

  // Insert types the selector at the editor's cursor.
  await card.getByRole('button', {name: 'Insert selector at the cursor'}).click();
  await page.waitForFunction(() => /sort_by\(Axis\.Z\)\[-1\]/.test(document.querySelector('#editor .view-lines').textContent));
  await page.locator('#tab-preview').click();
  await page.waitForTimeout(300);

  // Shift-click the same face takes it out of the selection; Escape clears it.
  await page.mouse.click(x, y);
  await card.waitFor();
  await page.keyboard.down('Shift');
  await page.mouse.click(x, y);
  await page.keyboard.up('Shift');
  await card.waitFor({state: 'hidden'});
  await page.mouse.click(x, y);
  await card.waitFor();
  await page.keyboard.press('Escape');
  await card.waitFor({state: 'hidden'});

  // A drag orbits rather than picking.
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 80, y + 20, {steps: 6});
  await page.mouse.up();
  assert.ok(await card.isHidden());

  // The parts list shows, hides and selects parts.
  await view.getByRole('button', {name: 'Parts', exact: true}).click();
  const parts = view.getByRole('navigation', {name: 'Parts'});
  await parts.getByRole('button', {name: 'Plate', exact: true}).click();
  await card.getByText('Part', {exact: true}).waitFor();
  assert.match(await card.textContent(), /Size\s*80 × 80 × 4 mm/);
  await parts.getByRole('button', {name: 'Hide Plate'}).click();
  await view.locator('.dim-label').filter({hasText: /^80 mm$/}).first().waitFor({state: 'hidden'});
  await parts.getByRole('button', {name: 'Show Plate'}).click();

  // The cube's top face looks straight down; the frame button fits the model again.
  const cube = await view.getByLabel(/Orientation cube/).boundingBox();
  await page.mouse.click(cube.x + cube.width / 2, cube.y + cube.height / 2);
  await view.getByRole('button', {name: 'Frame the model'}).click();
  await page.waitForTimeout(500);

  // A right click opens a prompt about the spot; sending it goes to the Agent panel.
  await page.mouse.click(x, y, {button: 'right'});
  const spot = view.getByRole('form', {name: 'Ask the agent about this spot'});
  await spot.waitFor();
  await spot.getByRole('textbox').fill('Make this plate thicker');
  await spot.getByRole('textbox').press('Enter');
  await spot.waitFor({state: 'hidden'});
  // Signed out, the request stays in the message box with a prompt to sign in.
  assert.equal(await page.getByLabel('Message to agent').inputValue(), 'Make this plate thicker');
  // The parameters panel edits WIDTH in the file and rebuilds.
  await page.locator('#tab-preview').click();
  const toggle = page.getByRole('button', {name: 'Parameters (2)'});
  await toggle.click();
  const panel = page.getByRole('region', {name: 'Parameters'});
  assert.match(await panel.textContent(), /Plate[^]*WIDTH[^]*plate width, mm[^]*THICKNESS/);
  const width = panel.getByLabel('WIDTH: plate width, mm');
  await width.fill('90');
  await width.press('Enter');
  await view.locator('.dim-label').filter({hasText: /^90 mm$/}).first().waitFor({timeout: 120000});
  await page.locator('#tab-source').click();
  await page.waitForFunction(() => /WIDTH\s*=\s*90\s+# plate width, mm/.test(document.querySelector('#editor .view-lines').textContent.replace(/\u00a0/g, ' ')));
  // Arrow keys step by the last digit written.
  await page.locator('#tab-preview').click();
  await panel.getByLabel('THICKNESS').press('ArrowUp');
  await view.locator('.dim-label').filter({hasText: /^5 mm$/}).first().waitFor({timeout: 120000});
  assert.deepEqual(errors, []);
  console.log('Viewer: dimensions, hover, face pick, measurements, selector insert, shift and Escape, orbit, parts, cube, spot prompt and parameters passed.');
} finally {
  await browser.close();
}
