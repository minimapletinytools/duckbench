// Exercise the UI, both real MCP transports and a model turn without cloud credentials.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdir, mkdtemp, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {chromium, _electron as electron} from 'playwright';
import {createServer} from 'vite';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const folder = await mkdtemp(path.join(tmpdir(), 'duckbench-agent-'));
const backend = path.resolve(process.env.KIGUMI_BACKEND_DIR || '../kigumi-backend');
const mode = process.argv[2] || 'both';
let browser, fixture, vite, desktop;
async function setupFromPanel(page) {
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', {configurable: true,
    value: {writeText: async text => { window.copied = text; }}}));
  await page.getByRole('button', {name: 'Copy client setup'}).click();
  return page.evaluate(() => JSON.parse(window.copied).mcpServers.duckbench);
}

async function exercise(page, isDesktop) {
  await page.locator('#toggle-agent').click();
  if (!await page.locator('.agent-settings').evaluate(node=>node.open)) await page.locator('.agent-settings > summary').click();
  await page.getByText('MCP connection', {exact: true}).click();
  await page.getByRole('button', {name: 'Connect MCP', exact: true}).click();
  const {url, headers} = await setupFromPanel(page);
  const client = new Client({name:'duckbench-test', version:'1'});
  try {
    assert.equal((await fetch(url, {method:'POST'})).status, 401);
    await client.connect(new StreamableHTTPClientTransport(new URL(url), {requestInit: {headers}}));
    assert.match(client.getInstructions(), /build123d/);
    assert.deepEqual((await client.listTools()).tools.map(t => t.name).sort(), ['build_result','list_files','propose_edit','read_file','workbench_state']);
    const call = (name,args) => client.callTool({name, arguments: args});
    const state = JSON.parse((await call('workbench_state', {})).content[0].text);
    assert.equal(state.activeFile, 'duck.py');
    assert.match((await call('list_files', {})).content[0].text, /duck.py/);
    assert.match((await call('read_file', {path:'duck.py'})).content[0].text, /Puddle the duck/);
    assert.equal((await call('read_file', {path:'../private.py'})).isError, true);
    await page.locator('#tab-source').click();
    await page.locator('#editor .view-lines').click();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
    await page.keyboard.insertText('# current editor buffer');
    assert.match((await call('read_file', {path:'duck.py'})).content[0].text, /current editor buffer/);
    const proposal = await call('propose_edit', {path:'duck.py', original:'current', replacement:'reviewed'});
    assert.match(proposal.content[0].text, /Awaiting user review/);
    assert.match((await call('read_file', {path:'duck.py'})).content[0].text, /current editor buffer/);
    await page.getByRole('button', {name:'Apply edit'}).click();
    assert.match((await call('read_file', {path:'duck.py'})).content[0].text, /reviewed editor buffer/);
    await page.getByRole('searchbox', {name:'Find a file'}).fill('duck');
    assert.equal(await page.getByRole('tree', {name:'Matching files'}).getByRole('treeitem').count(), 1);

    if (!isDesktop) {
      let requests = 0;
      await page.route('**/v1/chat/completions', route => {
        const body = route.request().postDataJSON();
        assert.ok(route.request().headers().authorization.startsWith('Bearer '));
        assert.ok(body.model && body.tools.length);
        const result = requests++ === 0
          ? {role:'assistant', content:null, tool_calls:[{id:'one', type:'function', function:{name:'read_file', arguments:'{"path":"duck.py"}'}}]}
          : {role:'assistant', content:'The file contains a comment.'};
        if (requests === 2) assert.match(body.messages.at(-1).content, /reviewed editor buffer/);
        return route.fulfill({json:{choices:[{message:result}]}});
      });
      await page.getByLabel('Message to agent').fill('What is in duck.py?');
      await page.getByRole('button', {name:'Send', exact:true}).click();
      await page.getByText('The file contains a comment.', {exact:true}).waitFor();
      assert.equal(requests, 2);
      await page.locator('#projects').click();
      await page.locator('#project-name').fill('Second project');
      await page.getByRole('button', {name:'New project', exact:true}).click();
      await page.getByText('Disconnected', {exact:true}).waitFor();
      await page.waitForFunction(() => !document.querySelector('.agent-thread article'));
      let status;
      for (let n = 0; n < 30; n++) {
        status = (await fetch(url, {headers})).status;
        if (status === 410) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert.equal(status, 410);
      await page.locator('#projects').click();
      await page.locator('.project-row').filter({hasText:'My first project'}).getByRole('button',{name:'Open',exact:true}).click();
      await page.getByText('The file contains a comment.', {exact:true}).waitFor();
      await page.getByLabel('Message to agent').fill('Continue checking the model');
      await page.getByRole('button',{name:'New chat',exact:true}).click();
      await page.getByRole('button',{name:'History',exact:true}).click();
      await page.getByRole('button',{name:'What is in duck.py?'}).click();
      assert.equal(await page.getByLabel('Message to agent').inputValue(),'Continue checking the model');
    } else {
      await page.getByRole('button', {name:'Disconnect MCP'}).click();
      await assert.rejects(fetch(url, {headers}));
    }
  } finally { await client.close(); }
}

try {
  if (mode !== 'web') {
    desktop = await electron.launch({args:['.', '--user-data-dir=' + folder], env:{...process.env, ELECTRON_RUN_AS_NODE:'', VITE_KIGUMI_SUPABASE_URL:'https://supabase.test'}});
    const page = await desktop.firstWindow();
    await exercise(page, true);
    const projectPath = path.join(folder, 'project');
    await mkdir(path.join(projectPath, 'parts'), {recursive:true});
    await writeFile(path.join(projectPath, 'parts', 'wheel.py'), 'radius = 24');
    await writeFile(path.join(projectPath,'model.py'), 'from build123d import Cylinder\nfrom parts.wheel import radius\nresult = Cylinder(radius, 5)\nresult.label = f"Wheel {radius}"');
    await writeFile(path.join(folder, 'outside.txt'), 'outside project');
    await symlink(path.join(folder, 'outside.txt'), path.join(projectPath, 'link.txt'));
    await desktop.evaluate(({dialog}, folder) => {
      dialog.showOpenDialog = async () => ({canceled:false, filePaths:[folder]});
    }, projectPath);
    await page.locator('#open-folder').click();
    await page.getByRole('button', {name:'Connect MCP', exact:true}).click();
    const setup = await setupFromPanel(page);
    const diskClient = new Client({name:'disk-test',version:'1'});
    try {
      await diskClient.connect(new StreamableHTTPClientTransport(new URL(setup.url), {requestInit:{headers:setup.headers}}));
      const tool = (name,args) => diskClient.callTool({name, arguments:args});
      assert.match((await tool('list_files',{path:'parts'})).content[0].text, /wheel.py/);
      assert.match((await tool('read_file',{path:'parts/wheel.py'})).content[0].text, /radius = 24/);
      assert.equal((await tool('read_file',{path:'link.txt'})).isError, true);
      assert.equal((await tool('read_file',{path:'duck.py'})).isError, true);
      await page.getByRole('searchbox',{name:'Find a file'}).fill('');
      const target = page.getByRole('treeitem',{name:/model.py/});
      await target.click();await target.click({button:'right'});
      await page.getByRole('menuitem',{name:'Set as run target'}).click();
      const helper = path.join(projectPath,'parts','wheel.py');
      const propose = original => tool('propose_edit',{path:'parts/wheel.py',original,replacement:'radius = 36'});
      assert.match((await propose('radius = 24')).content[0].text,/Awaiting user review/);
      await writeFile(helper,'radius = 30');
      await page.getByRole('button',{name:'Apply edit'}).click();
      await page.locator('[data-id=status]').filter({hasText:/fresh edit/i}).waitFor();
      assert.equal(await readFile(helper,'utf8'),'radius = 30');
      assert.match((await propose('radius = 30')).content[0].text,/Awaiting user review/);
      await page.locator('[data-id=applyRun]').click();
      await page.waitForFunction(()=>document.querySelector('#model-state').textContent==='result',null,{timeout:90000});
      assert.equal(await readFile(helper,'utf8'),'radius = 36');
      const wheel = page.locator('.tv-node-label').filter({hasText:'Wheel 36'});
      if (!await wheel.count()) await page.locator('.tv-nav-marker').first().click();
      await wheel.waitFor();
      const build = JSON.parse((await tool('build_result',{})).content[0].text);
      assert.equal(build.runTarget,'model.py');
      assert.equal(build.lastSuccessfulId,build.lastAttempt.id);
      assert.equal(build.lastAttempt.status,'success');
    } finally { await diskClient.close(); }
    await page.getByRole('button', {name:'Disconnect MCP'}).click();
    // Stand in for the system browser returning from Google with a PKCE code.
    await desktop.evaluate(({shell}) => {
      shell.openExternal = async address => {
        const url = new URL(address);
        if (url.origin !== 'https://supabase.test' || url.searchParams.get('provider') !== 'google' ||
            !url.searchParams.get('code_challenge')) throw new Error('Unexpected authorization URL.');
        const response = await fetch(url.searchParams.get('redirect_to') + '?code=desktop-code');
        if (!response.ok) throw new Error('Desktop callback failed.');
      };
    });
    await page.route('https://supabase.test/auth/v1/token?**', route => {
      const data = route.request().postDataJSON();
      assert.ok(data.code_verifier && data.auth_code === 'desktop-code');
      return route.fulfill({json:{access_token:'fixture',refresh_token:'fixture',expires_in:3600,token_type:'bearer',
        user:{id:'desktop',email:'desktop@example.test',aud:'authenticated'}}});
    });
    await page.getByRole('button', {name:'Sign in with Google'}).click();
    await page.getByText('desktop@example.test').waitFor();
    await desktop.close(); desktop = null;
    console.log('Desktop MCP passed.');
  }
  if (mode !== 'desktop') {
    fixture = spawn(process.execPath, ['test/mcp-runtime.mjs','--serve'], {cwd:backend, stdio:['ignore','pipe','inherit']});
    const {base, token} = await new Promise((resolve,reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error('Worker fixture timed out.')), 30000);
      fixture.stdout.on('data', chunk => {
        output += chunk;
        const match = output.match(/FIXTURE (.+)\n/);
        if (match) { clearTimeout(timer); resolve(JSON.parse(match[1])); }
      });
      fixture.once('error', error => { clearTimeout(timer); reject(error); });
      fixture.once('exit', code => { clearTimeout(timer); reject(new Error('Worker fixture exited ' + code)); });
    });
    process.env.VITE_KIGUMI_BACKEND_URL = base;
    process.env.VITE_KIGUMI_SUPABASE_URL = 'https://supabase.test';
    vite = await createServer({server:{host:'127.0.0.1', port:8127, strictPort:true}});
    await vite.listen();
    browser = await chromium.launch({channel:'chrome'});
    const page = await browser.newPage({viewport:{width:1450,height:900}});
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    let exchanged = false;
    await page.route('https://supabase.test/auth/v1/authorize?**', route => {
      const url = new URL(route.request().url());
      assert.equal(url.searchParams.get('provider'), 'github');
      assert.equal(url.searchParams.get('code_challenge_method')?.toLowerCase(), 's256');
      return route.fulfill({status:302,headers:{location:url.searchParams.get('redirect_to') + '?code=fixture-code'}});
    });
    await page.route('https://supabase.test/auth/v1/token?**', route => {
      const data = route.request().postDataJSON();
      assert.ok(data.code_verifier && data.auth_code === 'fixture-code');
      exchanged = true;
      return route.fulfill({json:{access_token:token,refresh_token:'fixture',token_type:'bearer',expires_in:3600,
        user:{id:'11111111-1111-4111-8111-111111111111',email:'fixture@example.test',aud:'authenticated'}}});
    });
    await page.goto('http://127.0.0.1:8127/');
    await page.locator('#toggle-agent').click();
    await page.locator('.agent-settings > summary').click();
    await page.getByRole('button', {name:'Sign in with GitHub'}).click();
    await page.getByText('fixture@example.test').waitFor();
    assert.ok(exchanged);
    await page.waitForURL('http://127.0.0.1:8127/');
    await page.locator('#toggle-agent').click();
    await exercise(page, false);
    assert.deepEqual(errors, []);
    console.log('Browser MCP, project switch, chat tool calls and explorer search passed.');
  }
} finally {
  await browser?.close();
  await desktop?.close();
  await vite?.close();
  if (fixture?.pid && fixture.exitCode === null) {
    const exited = once(fixture, 'exit');
    fixture.kill(); await exited;
  }
  await rm(folder, {recursive:true,force:true});
}
