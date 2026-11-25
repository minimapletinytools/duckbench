import {createAccount} from './account.js';
import {createRelay} from './relay.js';
import {clients, setupText} from './mcp-setup.js';
import {callTool, instructions, tools} from './tools.js';
import {chat} from './chat.js';
import './panel.css';
import {conversations} from './conversations.js';

export function createAgentPanel(project, {apply, run, runLabel, show, close}) {
  const element = document.createElement('section');
  element.className = 'agent-panel';
  const icon = path => `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
  element.innerHTML = `<header class="agent-header"><span class="agent-title">${icon('<path d="M6 2.5l1.2 3.3 3.3 1.2-3.3 1.2L6 11.5 4.8 8.2 1.5 7l3.3-1.2zM12 9.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z"/>')}Agent</span>
      <span class="agent-actions"><select data-id="model" class="model-select" aria-label="Agent model" hidden></select>
      <button data-id="past" type="button" class="icon-btn" aria-label="History" title="History">${icon('<path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9M2.5 2.5v2.2h2.2M8 5v3.2l2 1.3"/>')}</button>
      <button data-id="clear" type="button" class="icon-btn" aria-label="New chat" title="New chat">${icon('<path d="M8 3v10M3 8h10"/>')}</button>
      <button data-id="close" type="button" class="icon-btn agent-close" aria-label="Close agent panel" title="Close agent panel">${icon('<path d="M4 4l8 8M12 4l-8 8"/>')}</button></span></header>
    <div data-id="threads" class="agent-history" hidden></div>
    <details class="agent-mcp"><summary>MCP connection<span data-id="indicator"></span></summary>
      <p data-id="scope"></p><label class="mcp-toggle"><input type="checkbox" data-id="connect"> Enable MCP server</label>
      <p data-id="mcpLogin" hidden>Sign in below to connect MCP in the browser.</p>
      <output data-id="connection">Disconnected</output>
      <div data-id="setups" hidden>
        <button type="button" class="primary" data-id="copyAll">Copy for all agents</button>
        <p>Or copy setup for one client</p><div class="mcp-clients" data-id="clients"></div>
        <output data-id="copyHint" class="mcp-copy-hint" aria-live="polite"></output>
      </div></details>
    <div class="agent-thread">
      <div data-id="welcome" class="agent-welcome">
        <p class="welcome-pointer"><span aria-hidden="true">↑</span> Enable MCP above to connect your own agent.</p>
        <p class="welcome-note">For the best experience, use your own agent. Duckbench also includes a built-in agent with limited tokens.</p>
        <p data-id="loginHint" class="welcome-pointer">Sign in below to use the built-in agent. <span aria-hidden="true">↓</span></p>
      </div>
      <div role="log" aria-label="Conversation"></div>
    </div>
    <section class="agent-proposal" aria-label="Proposed edit" hidden><strong data-id="target"></strong><details open><summary>Review edit</summary><pre class="removed" data-id="original"></pre><pre class="added" data-id="replacement"></pre></details><div><button data-id="apply">Apply edit</button> <button data-id="applyRun">Apply &amp; Run</button> <button data-id="discard">Discard</button></div></section>
    <div class="agent-footer"><form class="agent-compose"><div data-id="mentions" class="agent-mentions" hidden></div>
    <div class="input-box"><textarea aria-label="Message to agent" rows="2" placeholder="Ask about this project, or @ to reference a file"></textarea>
    <button data-id="send" class="send-btn" aria-label="Send" title="Send (Enter)" disabled>${icon('<path d="M2.5 13.5l11-5.5-11-5.5 1.8 5.5zM4.3 8h5"/>')}</button><button type="button" data-id="cancel" class="send-btn stop-btn" aria-label="Stop" title="Stop" hidden>${icon('<rect x="4.5" y="4.5" width="7" height="7" rx="1" fill="currentColor" stroke="none"/>')}</button></div>
    <output data-id="status" role="status"></output></form>
    <footer class="agent-account">
      <button data-id="signIn" class="link-btn" aria-haspopup="dialog" aria-controls="agent-sign-in" disabled>Sign in</button>
      <span data-id="identity" hidden></span><button data-id="logout" class="link-btn" hidden>Sign out</button>
      <div data-id="billing" class="agent-billing" hidden><span data-id="usage"></span></div>
    </footer></div>
    <dialog id="agent-sign-in" data-id="chooser" class="file-dialog agent-sign-in" aria-labelledby="agent-sign-in-title">
      <h2 id="agent-sign-in-title">Sign in to Duckbench</h2>
      <div data-id="providers">
        <button data-provider="github" autofocus>Continue with GitHub</button>
        <button data-provider="google">Continue with Google</button>
      </div>
      <form method="dialog"><button>Cancel</button></form>
    </dialog>`;
  const ui = Object.fromEntries([...element.querySelectorAll('[data-id]')].map(node => [node.dataset.id, node]));
  ui.close.onclick = close;
  const thread = element.querySelector('[role="log"]');
  const input = element.querySelector('textarea');
  const desktop = window.desktop;
  let account, relay, user, turn, session, connection, context, signingIn = false;
  let storage=null,record=null,mentionId=0;
  const history=[];
  let usageRequest=0;
  const money=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:4});
  async function refreshUsage(){
    const id=++usageRequest;
    if(!user || !account)return;
    try{
      const {balanceUsd,usage}=await account.request('/account');
      if(id!==usageRequest || !user)return;
      const lastCharge=usage?.[0]?.charged_micro_usd;
      ui.usage.textContent='Kigumi credit '+money.format(balanceUsd)
        +(Number.isFinite(lastCharge)?' · Last request '+money.format(lastCharge/1_000_000):'');
    }catch{if(id===usageRequest)ui.usage.textContent='Credit balance unavailable';}
  }
  function persist(){
    if(!storage||!record)return;
    record.history=history.slice();record.draft=input.value;
    try{storage.save(record);}catch{ui.status.textContent='Conversation storage is full or unavailable.';}
  }
  function restore(next) {
    clearChat();record=next;if(!next)return;
    history.push(...next.history);input.value=next.draft;
    for(const item of next.transcript)message(item.label,item.text,false);
    if([...ui.model.options].some(option=>option.value===next.model))ui.model.value=next.model;
    controls();
  }
  function loadContext(){
    storage=user&&context?conversations(user.id,context):null;
    restore(storage?.load());
    if(!storage)return;
    // Carry a signed-out prompt through the provider redirect in this tab only.
    const key='duckbench.signInDraft.'+context;
    let draft;
    try{draft=sessionStorage.getItem(key);sessionStorage.removeItem(key);}catch{}
    if(draft){
      if(record.draft || record.transcript.length)restore(storage.fresh());
      input.value=draft;controls();persist();
    }
  }
  async function loadModels(){
    const owner=user?.id;
    if(!owner||!account){ui.model.hidden=true;return;}
    try{
      const {models}=await account.request('/models');
      if(user?.id!==owner)return;
      ui.model.replaceChildren(...models.map(model=>new Option(model.label,model.openrouter)));
      if(models.some(model=>model.openrouter===record?.model))ui.model.value=record.model;
      ui.model.hidden=!models.length;
    }catch{ui.model.hidden=true;}
  }
  ui.model.onchange=()=>{if(record)record.model=ui.model.value;persist();};
  ui.past.onclick=()=>{
    ui.threads.hidden=!ui.threads.hidden;
    if(ui.threads.hidden)return;
    persist();ui.threads.replaceChildren();
    for(const entry of storage?.list()||[]){
      const button=document.createElement('button');button.textContent=entry.history[0]?.content?.slice(0,70)||entry.draft.slice(0,70)||'New conversation';
      button.onclick=()=>{restore(entry);persist();ui.threads.hidden=true;};ui.threads.append(button);
    }
    if(!ui.threads.childElementCount)ui.threads.textContent='No saved conversations.';
  };
  const review = element.querySelector('.agent-proposal');
  let proposal;
  function discard() {
    proposal = null;
    review.hidden = true;
    ui.original.textContent = ui.replacement.textContent = ui.target.textContent = '';
  }
  project.propose = async ({path, original, replacement}) => {
    if (proposal) throw new Error('An edit is already awaiting review.');
    const owner=user?.id,scope=context;
    const source=await project.read(path);
    if(context!==scope||owner!==user?.id||proposal)throw new Error('Project or review changed.');
    const start = source.indexOf(original);
    const unique = original ? start >= 0 && source.lastIndexOf(original) === start : source.length === 0;
    if (!unique || original === replacement) {
      throw new Error('Original text must match exactly once and the replacement must change it.');
    }
    proposal = {source, path, start, original, replacement, context};
    ui.target.textContent = path;
    ui.original.textContent = original.split('\n').map(line=>'− '+line).join('\n');
    ui.replacement.textContent = replacement.split('\n').map(line=>'+ '+line).join('\n');
    ui.applyRun.textContent='Apply & '+(desktop && path!==project.state().preview.runTarget?'Save changed files & Run '+(project.state().preview.runTarget||'model'):runLabel());
    review.hidden = false;
    show();
    return {status: 'Awaiting user review', path};
  };
  ui.discard.onclick = () => {message('Review','Discarded edit to '+proposal.path);discard();};
  async function accept(build){
    const edit=proposal;if(!edit)return;
    ui.apply.disabled=ui.applyRun.disabled=ui.discard.disabled=true;
    try{
      await apply(edit, () => proposal === edit);
      if(proposal!==edit)return;
      discard();message('Review','Applied edit to '+edit.path);
      ui.status.textContent='Applied to '+edit.path;
      if(build)await run({saveHelpers:true});
    }catch(error){if(proposal===edit){ui.status.textContent=error.message;discard();}}
    finally{ui.apply.disabled=ui.applyRun.disabled=ui.discard.disabled=false;}
  }
  ui.apply.onclick=()=>accept(false);ui.applyRun.onclick=()=>accept(true);

  function controls() {
    ui.identity.textContent = user?.email || 'Signed in';
    ui.identity.hidden = !user;
    ui.signIn.hidden = !!user;
    ui.signIn.disabled = !account || signingIn;
    if (user && ui.chooser.open) ui.chooser.close();
    ui.loginHint.hidden = !!user;
    ui.past.disabled = !user;
    ui.welcome.hidden = thread.childElementCount > 0;
    ui.logout.hidden = ui.billing.hidden = !user;
    ui.connect.disabled = !desktop && (!user || !relay);
    ui.mcpLogin.hidden = !!desktop || !!user;
    ui.connect.checked = !!connection;
    ui.indicator.textContent=session?' · Connected':'';
    ui.setups.hidden = !session;
    ui.send.disabled = !input.value.trim() || !!turn;
    ui.send.hidden = !!turn;
    ui.cancel.hidden = !turn;
  }
  function report(message, setup) {
    session = setup;
    ui.copyHint.textContent = '';
    ui.connection.textContent = message;
    if (!setup && !['Connecting…','Reconnecting…'].includes(message)) connection = null;
    controls();
  }
  function stop() {
    const wasConnected = !!connection;
    connection = null;
    if (desktop && wasConnected) void desktop.stopMcp().catch(error => report(error.message));
    relay?.stop();
    report('Disconnected');
  }
  function clearChat() {
    turn?.abort();
    turn = null;
    history.length = 0;
    mentionId++;
    discard();
    thread.replaceChildren();ui.threads.hidden=ui.mentions.hidden=true;
    input.value = '';
    ui.status.textContent = '';
    controls();
  }
  function reset() { stop(); clearChat(); }
  function message(label, text, save=true) {
    if(save&&record){record.transcript.push({label,text});persist();}
    const item = document.createElement('article');
    item.className = {You:'message-bubble user',Duckbench:'message-bubble assistant',Tool:'tool-chip'}[label] || 'agent-note';
    const from = document.createElement('strong');
    from.className = 'visually-hidden';
    from.textContent = label;
    const body = document.createElement('p');
    body.textContent = text;
    item.append(from, body);
    ui.welcome.hidden=true;
    thread.append(item);
    item.scrollIntoView({block: 'nearest'});
  }
  desktop?.onMcpCall(async ({scope, id, method, params}) => {
    if (scope !== connection) return;
    const result = method === 'tools/list' ? {tools} : await callTool(project, params.name, params.arguments);
    if (scope === connection) await desktop.replyMcp(id, result);
  });
  ui.connect.onchange = async () => {
    if (!ui.connect.checked) { stop(); return; }
    const scope = connection = crypto.randomUUID();
    report('Connecting…');
    if (desktop) {
      try {
        const setup = await desktop.startMcp(scope, instructions);
        if (connection === scope) report('Connected', setup);
      } catch (error) { if (connection === scope) report(error.message); }
    } else relay.start();
  };
  let copyAttempt = 0;
  const mcpSettings = element.querySelector('.agent-mcp');
  mcpSettings.ontoggle = () => {
    if (!mcpSettings.open) { copyAttempt++; ui.copyHint.textContent = ''; }
  };
  async function copySetup(client) {
    const active = session;
    if (!active) return;
    const attempt = ++copyAttempt;
    let hint;
    try {
      await navigator.clipboard.writeText(setupText(active, client));
      hint = 'Copied. ' + (client?.next || 'Paste the prompt into your own agent. It will set up Duckbench and check which project is open.');
    } catch {
      hint = 'Clipboard access failed. Allow clipboard access and try again.';
    }
    if (session === active && attempt === copyAttempt) {
      ui.copyHint.textContent = hint;
      ui.copyHint.scrollIntoView({block: 'nearest'});
    }
  }
  ui.copyAll.onclick = () => copySetup();
  for (const client of clients) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = client.label;
    button.onclick = () => copySetup(client);
    ui.clients.append(button);
  }
  ui.signIn.onclick = () => ui.chooser.showModal();
  ui.providers.onclick = async event => {
    const provider = event.target.dataset.provider;
    if (!provider || !account || user || signingIn) return;
    ui.chooser.close();
    if(context){
      try{
        const key='duckbench.signInDraft.'+context;
        if(input.value.trim())sessionStorage.setItem(key,input.value);
        else sessionStorage.removeItem(key);
      }catch{}
    }
    signingIn = true; controls();
    ui.status.textContent = 'Opening sign-in…';
    try { await account.signIn(provider); }
    catch (error) { ui.status.textContent = error.message; }
    finally { signingIn = false; controls(); }
  };
  ui.logout.onclick = async () => {
    persist();turn?.abort();stop();
    try { await account.signOut(); } catch (error) { ui.status.textContent = error.message; }
  };
  ui.clear.onclick = () => {persist();restore(storage?.fresh());};
  function attach(path){
    show();input.value+=(input.value.trim()?' ':'')+'@'+JSON.stringify(path)+' ';input.focus();controls();persist();
  }
  async function suggest(){
    const id=++mentionId;
    const match=input.value.slice(0,input.selectionStart).match(/(?:^|\s)@([^"\s]*)$/);
    ui.mentions.hidden=true;
    if(!match)return;
    const slash=match[1].lastIndexOf('/'),folder=match[1].slice(0,slash+1),prefix=match[1].slice(slash+1);
    const entries=await project.list(folder.replace(/\/$/,''));
    if(id!==mentionId)return;
    const choices=entries.filter(e=>e.name.toLowerCase().startsWith(prefix.toLowerCase())).slice(0,8);
    ui.mentions.replaceChildren(...choices.map(e=>{
      const path=folder+e.name,button=document.createElement('button');button.type='button';button.textContent=path+(e.directory?'/':'');
      button.onclick=()=>{const pos=input.selectionStart;input.setRangeText(e.directory?'@'+path+'/':'@'+JSON.stringify(path)+' ',pos-match[1].length-1,pos,'end');input.focus();input.oninput();};return button;
    }));ui.mentions.hidden=!choices.length;
  }
  ui.cancel.onclick = () => { turn?.abort(); };
  input.oninput = () => {controls();persist();void suggest().catch(()=>{});};
  element.querySelector('form').onsubmit = async event => {
    event.preventDefault();
    const prompt = input.value.trim();
    if (!prompt || turn) return;
    if (!user) {
      ui.status.textContent='Sign in below to use the built-in agent.';
      return;
    }
    const active = turn = new AbortController();
    input.value = '';ui.mentions.hidden=true;
    controls();
    message('You', prompt);
    ui.status.textContent = 'Thinking…';
    try {
      const reply = await chat({request: account.request, project, history, prompt, signal: active.signal,
        model:ui.model.value,onTool: (name,path) => { ui.status.textContent = 'Using ' + name + '…';message('Tool',name+(path?' · '+path:'')); }});
      active.signal.throwIfAborted();
      history.push({role: 'user', content: prompt}, {role: 'assistant', content: reply});
      message('Duckbench', reply);
      ui.status.textContent = '';
    } catch (error) {
      if (turn === active) ui.status.textContent = active.signal.aborted ? 'Stopped' : error.message;
    } finally {
      if (turn === active) { turn = null; controls(); void refreshUsage(); }
    }
  };
  input.onkeydown = event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      element.querySelector('form').requestSubmit();
    }
  };
  controls();
  void (async () => {
    account = await createAccount(next => {
      if (user?.id !== next?.id){
        persist();reset();user=next;loadContext();void loadModels();
        ui.usage.textContent=user?'Loading credit balance…':'';
        void refreshUsage();
      }else user=next;
      controls();
    });
    if (!desktop) relay = createRelay(account, project, report);
    controls();
    await account.finishRedirect();void loadModels();void refreshUsage();
  })().catch(error => { ui.status.textContent = error.message; });
  window.addEventListener('pagehide', () => { turn?.abort(); stop(); });
  return {element,attach,contextKey:()=>context,setContext(key) {
    if (context === key) return;
    persist();reset(); context = key;loadContext();
    ui.scope.textContent = 'Share files, preview status and edit proposals for ' + project.state().project +
      (desktop ? ' with a local MCP client.' : ' with an MCP client while this tab is open.');
  }};
}
