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
  const settings=page.locator('.agent-mcp');
  async function copy(label) {
    await settings.getByRole('button',{name:label,exact:true}).click();
    await settings.locator('[data-id="copyHint"]').getByText(/^Copied[.]/).waitFor();
    return page.evaluate(()=>window.copied);
  }
  const server=JSON.parse(await copy('Cursor')).mcpServers.duckbench;
  const expected=server.headers.Authorization;
  assert.ok(expected.startsWith('Bearer ') && expected.length>25);
  for(const label of ['Claude Code','Codex','Antigravity (agy)','Claude Desktop','VS Code','URL and token']){
    const text=await copy(label);
    assert.ok(text.includes(server.url) && text.includes(expected),label);
    if(label==='VS Code')assert.equal(JSON.parse(text).servers.duckbench.type,'http');
    if(label==='Claude Desktop')assert.equal(JSON.parse(text).mcpServers.duckbench.command,'npx');
  }
  const prompt=await copy('Copy prompt for any agent');
  assert.ok(prompt.includes(server.url) && prompt.includes(expected) && prompt.includes('workbench_state'));
  assert.ok(!/claude mcp add|--scope user|mcpServers|config\.toml/.test(prompt),'the prompt is a request, not an installer');
  assert.match(await settings.locator('[data-id="copyHint"]').textContent(),/Paste the prompt/);
  return server;
}

async function signedOutPrompt(page) {
  const input=page.getByLabel('Message to agent');
  await input.waitFor();
  assert.ok(await page.getByText('Enable MCP above', {exact:false}).isVisible());
  await page.getByRole('button',{name:'Close agent panel'}).click();
  assert.equal(await page.locator('#toggle-agent').getAttribute('aria-pressed'),'false');
  await page.locator('#toggle-agent').click();
  const signIn=page.getByRole('button',{name:'Sign in',exact:true});
  assert.ok((await signIn.boundingBox()).y > (await input.boundingBox()).y);
  const chooser=page.getByRole('dialog',{name:'Sign in to Duckbench'});
  assert.ok(await chooser.isHidden());
  await signIn.click();
  assert.ok(await chooser.getByRole('button',{name:'Continue with GitHub'}).isVisible());
  assert.ok(await chooser.getByRole('button',{name:'Continue with Google'}).isVisible());
  await page.keyboard.press('Escape');
  assert.ok(await chooser.isHidden());
  assert.ok(await signIn.evaluate(button=>button===document.activeElement));
  await input.fill('Help me change the bill');
  await input.press('Enter');
  await page.locator('[data-id="status"]').getByText('Sign in below to use the built-in agent.').waitFor();
  assert.equal(await input.inputValue(),'Help me change the bill');
  assert.equal(await page.getByRole('log',{name:'Conversation'}).locator('article').count(),0);
}

async function exercise(page, isDesktop) {
  assert.equal(await page.locator('#toggle-agent').getAttribute('aria-pressed'),'true');
  await page.getByText('MCP connection', {exact: true}).click();
  await page.getByRole('checkbox',{name:'Enable MCP server'}).check();
  const {url, headers} = await setupFromPanel(page);
  const client = new Client({name:'duckbench-test', version:'1'});
  try {
    assert.equal((await fetch(url, {method:'POST'})).status, 401);
    await client.connect(new StreamableHTTPClientTransport(new URL(url), {requestInit: {headers}}));
    assert.match(client.getInstructions(), /build123d/);
    assert.deepEqual((await client.listTools()).tools.map(t => t.name).sort(), ['build123d_api','build_result','delete_file','describe_model','edit_file','get_selection',
      'list_files','read_file','read_output','rename_file','run_build','screenshot','search_files','workbench_state','write_file']);
    const call = (name,args) => client.callTool({name, arguments: args});
    const call2 = call;
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
    const edited = await call('edit_file', {path:'duck.py', old_string:'current', new_string:'edited'});
    if (isDesktop) {
      // On desktop an MCP change is saved to disk, so it may not touch the user's unsaved edits.
      assert.match(edited.content[0].text, /unsaved changes/);
      assert.match((await call('read_file', {path:'duck.py'})).content[0].text, /current editor buffer/);
    } else {
      // Applied at once, with no review in the Agent panel.
      assert.match(edited.content[0].text, /^Edited duck\.py \(1 replacement\)\. Call run_build/);
      assert.ok(await page.locator('.agent-proposal').isHidden());
      assert.match((await call('read_file', {path:'duck.py'})).content[0].text, /edited editor buffer/);
      assert.match((await call('write_file', {path:'notes/plan.txt', content:'wheels'})).content[0].text, /Created notes\/plan\.txt/);
      assert.match((await call('rename_file', {path:'notes/plan.txt', new_path:'notes/todo.txt'})).content[0].text, /Renamed/);
      assert.match((await call('read_file', {path:'notes/todo.txt'})).content[0].text, /wheels/);
      assert.match((await call('delete_file', {path:'notes/todo.txt'})).content[0].text, /Deleted/);
      assert.equal((await call('read_file', {path:'notes/todo.txt'})).isError, true);
    }
    await page.getByRole('searchbox', {name:'Find a file'}).fill('duck');
    assert.equal(await page.getByRole('tree', {name:'Matching files'}).getByRole('treeitem').count(), 1);

    if (!isDesktop) {
      // A streamed turn: read, a reviewed edit, a to-do list, then a reply in Markdown.
      let requests = 0;
      const sse = events => events.map(event => 'data: ' + JSON.stringify(event) + '\n\n').join('') + 'data: [DONE]\n\n';
      const call = (id, name, args) => ({choices:[{delta:{tool_calls:[{index:0, id, type:'function', function:{name, arguments:JSON.stringify(args)}}]}, finish_reason:'tool_calls'}]});
      const seen = [];
      await page.route('**/v1/chat/completions', route => {
        const body = route.request().postDataJSON();
        assert.ok(route.request().headers().authorization.startsWith('Bearer '));
        assert.ok(body.model && body.tools.some(t => t.function.name === 'edit_file') && body.stream);
        seen.push(body.messages);
        const step = requests++;
        if (step === 0) assert.match(body.messages.at(-1).content, /^\[Duckbench note: The active file is duck\.py[^]*What is in duck\.py\?$/);
        if (step === 1) assert.match(body.messages.at(-1).content, /^duck\.py\n1\t# edited editor buffer/);
        if (step === 2) assert.match(body.messages.at(-1).content, /^Edited duck\.py \(1 replacement\)\./);
        const events = [
          [call('one', 'read_file', {path:'duck.py'})],
          [call('two', 'edit_file', {path:'duck.py', old_string:'edited', new_string:'agent-edited'})],
          [call('three', 'update_todos', {items:[{text:'Read the file', done:true}, {text:'Explain it'}]})],
          [{choices:[{delta:{content:'The file contains '}}]}, {choices:[{delta:{content:'a **comment**.'}, finish_reason:'stop'}]}],
        ][step];
        return route.fulfill({status:200, headers:{'content-type':'text/event-stream'}, body:sse(events)});
      });
      await page.getByLabel('Message to agent').fill('What is in duck.py?');
      await page.getByRole('button', {name:'Send', exact:true}).click();
      const review = page.getByRole('region', {name:'Proposed edit'});
      await review.getByRole('button', {name:'Apply edit'}).waitFor();
      assert.match(await review.textContent(), /− # edited editor buffer[^]*\+ # agent-edited editor buffer/);
      await review.getByRole('button', {name:'Apply edit'}).click();
      await page.getByText('The file contains a comment.', {exact:true}).waitFor();
      assert.equal(await page.locator('.message-bubble.assistant strong:not(.visually-hidden)').textContent(), 'comment');
      assert.equal(requests, 4);
      assert.match((await call2('read_file', {path:'duck.py'})).content[0].text, /# agent-edited editor buffer/);
      assert.deepEqual(await page.getByRole('list', {name:'Agent to-do list'}).getByRole('listitem').allTextContents(), ['Read the file', 'Explain it']);
      assert.equal(await page.locator('.tool-chip.is-done').count(), 3);
      // The turn's tool calls stay in the conversation for the next one.
      assert.ok(seen[3].some(message => message.role === 'tool' && message.tool_call_id === 'one'));
      await page.getByRole('button', {name:'Undo these changes'}).click();
      await page.getByText('Undid the agent\'s last changes.').waitFor();
      assert.match((await call2('read_file', {path:'duck.py'})).content[0].text, /# edited editor buffer/);

      // Automatic edits make new files without asking; plan mode refuses them.
      await page.unroute('**/v1/chat/completions');
      let second = 0;
      await page.route('**/v1/chat/completions', route => {
        const body = route.request().postDataJSON();
        const step = second++;
        if (step === 1) assert.match(body.messages.at(-1).content, planned ? /^Error: Plan mode is on/ : /^Created parts\/notes\.txt\./);
        const events = step === 0 ? [call('w', 'write_file', {path:'parts/notes.txt', content:planned ? 'changed' : 'hello'})]
          : [{choices:[{delta:{content:'Done.'}, finish_reason:'stop'}]}];
        return route.fulfill({status:200, headers:{'content-type':'text/event-stream'}, body:sse(events)});
      });
      let planned = false;
      await page.getByLabel('Edit permissions').selectOption('auto');
      await page.getByLabel('Message to agent').fill('Make a notes file');
      await page.getByRole('button', {name:'Send', exact:true}).click();
      await page.getByText('Done.', {exact:true}).waitFor();
      assert.match((await call2('read_file', {path:'parts/notes.txt'})).content[0].text, /1\thello/);
      planned = true; second = 0;
      await page.getByLabel('Edit permissions').selectOption('plan');
      await page.getByLabel('Message to agent').fill('Make it again');
      await page.getByRole('button', {name:'Send', exact:true}).click();
      await page.getByText('Done.', {exact:true}).nth(1).waitFor();
      await page.getByLabel('Edit permissions').selectOption('ask');
      assert.match((await call2('read_file', {path:'parts/notes.txt'})).content[0].text, /1\thello/);
      assert.ok(await page.locator('[data-id=welcome]').isHidden());
      await page.getByRole('checkbox',{name:'Enable MCP server'}).uncheck();
      await page.getByText('Disconnected',{exact:true}).waitFor();
      assert.ok(await page.getByRole('button',{name:'Copy for all agents'}).isHidden());
      let status;
      for (let n = 0; n < 30; n++) {
        status = (await fetch(url, {headers})).status;
        if (status === 410) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert.equal(status, 410);
      await page.getByText('The file contains a comment.', {exact:true}).waitFor();
      await page.getByLabel('Message to agent').fill('Continue checking the model');
      await page.getByRole('button',{name:'New chat',exact:true}).click();
      assert.ok(await page.locator('[data-id=welcome]').isVisible());
      assert.ok(await page.locator('[data-id=loginHint]').isHidden());
      await page.getByRole('button',{name:'History',exact:true}).click();
      await page.getByRole('button',{name:'What is in duck.py?'}).click();
      assert.equal(await page.getByLabel('Message to agent').inputValue(),'Continue checking the model');
    } else {
      await page.getByRole('checkbox',{name:'Enable MCP server'}).uncheck();
      await assert.rejects(fetch(url, {headers}));
    }
  } finally { await client.close(); }
}

try {
  if (mode !== 'web') {
    desktop = await electron.launch({args:['.', '--user-data-dir=' + folder], env:{...process.env, ELECTRON_RUN_AS_NODE:'', VITE_KIGUMI_SUPABASE_URL:'https://supabase.test'}});
    const page = await desktop.firstWindow();
    await signedOutPrompt(page);
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
    page.once('dialog',d=>d.accept());
    await page.locator('#open-folder').click();
    await page.getByRole('checkbox',{name:'Enable MCP server'}).check();
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
      // Edits read the file afresh, apply at once and are saved to disk.
      await writeFile(helper,'radius = 30');
      const edit = original => tool('edit_file',{path:'parts/wheel.py',old_string:original,new_string:'radius = 36'});
      assert.equal((await edit('radius = 24')).isError,true);
      assert.match((await edit('radius = 30')).content[0].text,/Edited parts\/wheel\.py/);
      assert.equal(await readFile(helper,'utf8'),'radius = 36');
      assert.match((await tool('write_file',{path:'parts/axle.txt',content:'axle'})).content[0].text,/Created/);
      assert.equal(await readFile(path.join(projectPath,'parts','axle.txt'),'utf8'),'axle');
      assert.match((await tool('rename_file',{path:'parts/axle.txt',new_path:'notes/axle.txt'})).content[0].text,/Renamed/);
      assert.equal(await readFile(path.join(projectPath,'notes','axle.txt'),'utf8'),'axle');
      assert.match((await tool('delete_file',{path:'notes/axle.txt'})).content[0].text,/Deleted/);
      await assert.rejects(readFile(path.join(projectPath,'notes','axle.txt'),'utf8'));
      assert.match((await tool('run_build',{})).content[0].text,/Built .*model\.py without errors/);
      await page.waitForFunction(()=>document.querySelector('#model-state').textContent==='result',null,{timeout:90000});
      const wheel = page.locator('.tv-node-label').filter({hasText:'Wheel 36'});
      if (!await wheel.count()) await page.locator('.tv-nav-marker').first().click();
      await wheel.waitFor();
      const build = JSON.parse((await tool('build_result',{})).content[0].text);
      assert.equal(build.runTarget,'model.py');
      assert.equal(build.lastSuccessfulId,build.lastAttempt.id);
      assert.equal(build.lastAttempt.status,'success');
      // The tools that let an agent check its work, against the real runtime.
      const text = async (name,args={}) => { const result = await tool(name,args); assert.ok(!result.isError, name+': '+result.content[0].text); return result.content.at(-1).text; };
      const model = JSON.parse(await text('describe_model'));
      assert.deepEqual(model.overall.size.map(Math.round), [72,72,5]);
      assert.equal(model.parts[0].path, 'Wheel 36');
      assert.match(await text('search_files',{pattern:'radius',glob:'*.py'}), /model\.py:2: from parts\.wheel import radius[^]*parts\/wheel\.py:1: radius = 36/);
      assert.match(await text('build123d_api',{name:'Cylinder'}), /"signature":"\(radius: /);
      assert.match(await text('build123d_api',{search:'^fillet$'}), /fillet/);
      const shot = await tool('screenshot',{view:'iso'});
      assert.equal(shot.content[0].type, 'image');
      assert.ok(shot.content[0].data.length > 2000);
      assert.match(await text('run_build',{}), /^Built model\.py without errors/);
      assert.match(await text('read_output',{contains:'Built in'}), /Built in/);
      await writeFile(helper,'radius = (');
      const failed = await text('run_build',{});
      assert.match(failed, /^The build of model\.py failed: [^]*SyntaxError[^]*parts\/wheel\.py/);
      await writeFile(helper,'radius = 36');
    } finally { await diskClient.close(); }
    await page.getByRole('checkbox',{name:'Enable MCP server'}).uncheck();
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
    await page.getByLabel('Message to agent').fill('Which workspace is open?');
    await page.getByRole('button', {name:'Sign in',exact:true}).click();
    await page.getByRole('button', {name:'Continue with Google'}).click();
    await page.getByText('desktop@example.test').waitFor();
    assert.equal(await page.getByLabel('Message to agent').inputValue(),'Which workspace is open?');
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
    page.setDefaultTimeout(30000);
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
    await signedOutPrompt(page);
    let balanceChecks=0;
    await page.route(base+'/account',route=>{balanceChecks++;return route.fulfill({json:{balanceUsd:1.25,usage:[{charged_micro_usd:2500}]}});});
    await page.getByRole('button', {name:'Sign in',exact:true}).click();
    await page.getByRole('button', {name:'Continue with GitHub'}).click();
    await page.getByText('fixture@example.test').waitFor();
    assert.ok(exchanged);
    await page.waitForURL('http://127.0.0.1:8127/');
    assert.equal(await page.getByLabel('Message to agent').inputValue(),'Help me change the bill');
    await page.getByText('Kigumi credit $1.25 · Last request $0.0025').waitFor();
    const initialChecks=balanceChecks;
    await exercise(page, false);
    assert.ok(balanceChecks>initialChecks);
    assert.deepEqual(errors, []);
    console.log('Browser MCP disconnect, chat history, tool calls and explorer search passed.');
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
