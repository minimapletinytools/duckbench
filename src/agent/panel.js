import {createAccount} from './account.js';
import {createRelay} from './relay.js';
import {clients, setupText} from './mcp-setup.js';
import {callTool, describeBuild, describeChange, instructions, mcpToolList} from './tools.js';
import {chat} from './chat.js';
import {renderMarkdown} from './markdown.js';
import './panel.css';
import {conversations} from './conversations.js';

const MODES = [['ask', 'Ask before edits'], ['auto', 'Edit automatically'], ['plan', 'Plan only (no edits)']];
const EDIT_TOOLS = new Set(['edit_file', 'write_file', 'rename_file']);

export function createAgentPanel(project, {run, runLabel, show, close}) {
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
        <button type="button" class="primary" data-id="copyAll">Copy prompt for any agent</button>
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
    <section class="agent-proposal" aria-label="Proposed edit" hidden><strong data-id="target"></strong><details open><summary data-id="kind">Review edit</summary><pre class="removed" data-id="original"></pre><pre class="added" data-id="replacement"></pre></details><div><button data-id="apply">Apply edit</button> <button data-id="applyRun">Apply &amp; Run</button> <button data-id="discard">Discard</button></div></section>
    <ol data-id="todos" class="agent-todos" aria-label="Agent to-do list" hidden></ol>
    <div class="agent-footer"><form class="agent-compose"><div data-id="mentions" class="agent-mentions" hidden></div>
    <div class="input-box"><textarea aria-label="Message to agent" rows="2" placeholder="Ask about this project, or @ to reference a file"></textarea>
    <button data-id="send" class="send-btn" aria-label="Send" title="Send (Enter)" disabled>${icon('<path d="M2.5 13.5l11-5.5-11-5.5 1.8 5.5zM4.3 8h5"/>')}</button><button type="button" data-id="cancel" class="send-btn stop-btn" aria-label="Stop" title="Stop" hidden>${icon('<rect x="4.5" y="4.5" width="7" height="7" rx="1" fill="currentColor" stroke="none"/>')}</button></div>
    <output data-id="status" role="status"></output></form>
    <div class="agent-options"><select data-id="mode" aria-label="Edit permissions" title="Whether the agent asks before changing files">${MODES.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select></div>
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
  let storage=null,record=null,mentionId=0,models=[],turnChanges=null;
  const history=[];
  let usageRequest=0;
  const money=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:4});
  try { ui.mode.value = localStorage.getItem('duckbench.agent.mode') || 'ask'; } catch {}
  if (!ui.mode.value) ui.mode.value = 'ask';
  ui.mode.onchange = () => { try { localStorage.setItem('duckbench.agent.mode', ui.mode.value); } catch {} };
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
    try{storage.save(record);}catch{
      // Keep the visible transcript; drop the oldest model context first.
      try{record.history=history.slice(-20);storage.save(record);}catch{ui.status.textContent='Conversation storage is full or unavailable.';}
    }
  }
  function restore(next) {
    clearChat();record=next;if(!next)return;
    history.push(...next.history);input.value=next.draft;
    for(const item of next.transcript)message(item.label,item.text,false,item);
    showTodos(next.todos||[]);
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
      ({models}=await account.request('/models'));
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
      const button=document.createElement('button');
      button.textContent=entry.transcript.find(item=>item.label==='You')?.text?.slice(0,70)||entry.draft.slice(0,70)||'New conversation';
      button.onclick=()=>{restore(entry);persist();ui.threads.hidden=true;};ui.threads.append(button);
    }
    if(!ui.threads.childElementCount)ui.threads.textContent='No saved conversations.';
  };

  // Review: the built-in agent's changes in ask mode, one at a time. MCP clients' changes don't come here.
  const review = element.querySelector('.agent-proposal');
  let pending = null;
  function hideReview() {
    pending = null;
    review.hidden = true;
    ui.original.textContent = ui.replacement.textContent = ui.target.textContent = '';
  }
  const lines = (text, mark) => {
    const shown = text.length > 6000 ? text.slice(0, 6000) + '\n…' : text;
    return shown.split('\n').map(line => mark + ' ' + line).join('\n');
  };
  function ask(change) {
    if (pending) throw new Error('An edit is already awaiting review.');
    const {kind, path} = change;
    ui.target.textContent = kind === 'rename' ? path + ' → ' + change.to : path;
    ui.kind.textContent = {edit: 'Review edit', write: change.source === null ? 'Review new file' : 'Review rewrite',
      delete: 'Review deletion', rename: 'Review rename'}[kind];
    ui.original.hidden = !(kind === 'edit' || kind === 'delete' || kind === 'write' && change.source);
    ui.replacement.hidden = !(kind === 'edit' || kind === 'write');
    let removed = change.original, added = change.replacement;
    if (kind === 'edit' && change.count === 1 && change.original) {
      // Whole lines around a single replacement, so it reads in context.
      const start = change.source.indexOf(change.original);
      const from = change.source.lastIndexOf('\n', start - 1) + 1;
      let to = change.source.indexOf('\n', start + change.original.length);
      if (to < 0) to = change.source.length;
      removed = change.source.slice(from, to);
      added = change.source.slice(from, start) + change.replacement + change.source.slice(start + change.original.length, to);
    }
    ui.original.textContent = kind === 'edit' ? lines(removed, '−') : change.source ? lines(change.source, '−') : '';
    ui.replacement.textContent = kind === 'edit' ? lines(added, '+') : kind === 'write' ? lines(change.next, '+') : '';
    ui.apply.textContent = kind === 'delete' ? 'Delete file' : kind === 'rename' ? 'Rename file' : 'Apply edit';
    const target = project.state().preview.runTarget;
    ui.applyRun.hidden = kind === 'delete' || kind === 'rename';
    ui.applyRun.textContent = 'Apply & ' + (desktop && path !== target ? 'Save changed files & Run ' + (target || 'model') : runLabel());
    review.hidden = false;
    show();
    return new Promise(resolve => { pending = {change, resolve}; });
  }
  function decide(decision) {
    const current = pending;
    if (!current) return;
    hideReview();
    current.resolve(decision);
  }
  ui.apply.onclick = () => decide('apply');
  ui.applyRun.onclick = () => decide('applyRun');
  ui.discard.onclick = () => decide('discard');

  /** Keep each file as it was before this turn first changed it, for Undo. */
  function checkpoint(change) {
    if (!turnChanges) return;
    if (!turnChanges.has(change.path)) turnChanges.set(change.path, change.source);
    if (change.kind === 'rename' && !turnChanges.has(change.to)) turnChanges.set(change.to, null);
  }
  const done = describeChange;

  // The built-in agent's edits: refused in plan mode, reviewed in ask mode, then applied and built.
  project.change = async change => {
    if (ui.mode.value === 'plan') throw new Error('Plan mode is on, so files are not changed. Propose the change; the user will switch plan mode off and ask you to go ahead.');
    const decision = ui.mode.value === 'auto' ? 'apply' : await ask(change);
    if (decision === 'discard') {
      message('Review', 'Declined change to ' + change.path);
      throw new Error('The user declined this change. Ask what they would like instead.');
    }
    checkpoint(change);
    await project.apply(change);
    message('Review', done(change));
    let text = done(change);
    const python = [change.path, change.to].some(path => path?.endsWith('.py'));
    if (python && (decision === 'applyRun' || project.state().preview.lastAttempt)) {
      ui.status.textContent = 'Building…';
      const attempt = await project.build();
      text += '\n' + describeBuild(attempt, attempt?.status === 'failed' ? project.output(attempt.outputStart) : '');
    } else if (python) text += ' The model has not been built yet: run_build builds it.';
    return text;
  };
  project.todos = items => { showTodos(items); if (record) { record.todos = items; persist(); } };
  function showTodos(items) {
    ui.todos.replaceChildren(...items.map(item => {
      const li = document.createElement('li');
      li.textContent = item.text;
      li.classList.toggle('is-done', item.done);
      return li;
    }));
    ui.todos.hidden = !items.length;
  }

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
    pending?.resolve('discard');
    hideReview();
    showTodos([]);
    thread.replaceChildren();ui.threads.hidden=ui.mentions.hidden=true;
    input.value = '';
    ui.status.textContent = '';
    controls();
  }
  function reset() { stop(); clearChat(); }

  /** Add one entry to the conversation: the user's bubble, a reply, a tool chip or a note. */
  function message(label, text, save=true, extra={}) {
    if(save&&record){record.transcript.push({label,text,...extra});persist();}
    const item = document.createElement('article');
    item.className = {You:'message-bubble user',Duckbench:'message-bubble assistant',Tool:'tool-chip'}[label] || 'agent-note';
    if (label === 'Tool') item.classList.add(extra.error ? 'is-error' : 'is-done');
    const from = document.createElement('strong');
    from.className = 'visually-hidden';
    from.textContent = label;
    item.append(from);
    if (label === 'Duckbench') item.append(renderMarkdown(text));
    else { const body = document.createElement('p'); body.textContent = text; item.append(body); }
    ui.welcome.hidden=true;
    thread.append(item);
    item.scrollIntoView({block: 'nearest'});
    return item;
  }

  desktop?.onMcpCall(async ({scope, id, method, params}) => {
    if (scope !== connection) return;
    const result = method === 'tools/list' ? {tools: mcpToolList} : await callTool(project, params.name, params.arguments);
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
      hint = 'Copied. ' + (client?.next || 'Paste the prompt into your own agent as your own message. It will add Duckbench and check which project is open.');
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
  ui.cancel.onclick = () => { turn?.abort(); pending?.resolve('discard'); hideReview(); };
  input.oninput = () => {controls();persist();void suggest().catch(()=>{});};

  /** What the user is looking at, sent with each message. */
  function contextNote() {
    const {activeFile, editor, unsaved, preview} = project.state();
    const parts = [];
    if (activeFile) parts.push(`The active file is ${activeFile}` + (editor?.line ? `, cursor at line ${editor.line}` : '') + '.');
    if (editor?.selectedText) parts.push(`Selected in the editor (lines ${editor.selectedLines.join('–')}):\n${editor.selectedText}`);
    if (unsaved?.length) parts.push('Unsaved changes in: ' + unsaved.slice(0, 10).join(', ') + '.');
    if (preview?.runTarget) parts.push(`The run target is ${preview.runTarget}.`);
    const attempt = preview?.lastAttempt;
    if (attempt) parts.push(attempt.status === 'failed' ? `The last build of ${attempt.target} failed: ${attempt.error}` : `The last build of ${attempt.target}: ${attempt.status}.`);
    else parts.push('Nothing has been built yet.');
    if (preview?.stale) parts.push('The code has changed since the model on screen was built.');
    const pick = project.picks(1).picks?.[0];
    if (pick) parts.push(`Last picked in the 3D preview: ${pick.kind === 'part' ? 'the part' : 'the ' + pick.label + ' of'} ${pick.name}` +
      (pick.info?.selector ? `, selected by ${pick.info.selector}` : '') + '.');
    return parts.join(' ').slice(0, 2400);
  }
  /** Files changed in this conversation, as they are now, for a summary. */
  async function changedFiles() {
    const paths = new Set();
    for (const entry of history) for (const call of entry.tool_calls || []) {
      if (!EDIT_TOOLS.has(call.function.name)) continue;
      try { const args = JSON.parse(call.function.arguments); paths.add(args.new_path || args.path); } catch {}
    }
    const shown = [];
    let total = 0;
    for (const path of paths) {
      const text = await project.read(path).catch(() => null);
      if (text === null || total > 60000) continue;
      const cut = text.length > 20000 ? text.slice(0, 20000) + '\n[…cut off]' : text;
      total += cut.length;
      shown.push(`[The file ${path} as it is now]\n\`\`\`\n${cut}\n\`\`\``);
    }
    return shown.length ? '[Files changed so far, as they are now. Where the summary disagrees, these are right.]\n\n' + shown.join('\n\n') : '';
  }
  function offerUndo(changes) {
    const note = message('Note', `Changed ${changes.size} file${changes.size > 1 ? 's' : ''} this turn.`, false);
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Undo these changes';
    button.onclick = async () => {
      button.disabled = true;
      try {
        for (const [path, before] of [...changes].reverse()) await project.restore(path, before);
        note.querySelector('p').textContent = 'Undid the changes to ' + [...changes.keys()].join(', ') + '.';
        message('Review', 'Undid the agent\'s last changes.');
        history.push({role: 'user', content: '[Duckbench note: the user undid your last changes to ' + [...changes.keys()].join(', ') + '.]'},
          {role: 'assistant', content: 'Noted: those changes were undone.'});
        persist();
        button.remove();
      } catch (error) { ui.status.textContent = error.message; button.disabled = false; }
    };
    note.append(button);
  }

  // What a prompt from the 3D view brings along: a note about the spot, and a picture of it.
  let attachedToNext = null;
  element.querySelector('form').onsubmit = async event => {
    event.preventDefault();
    const prompt = input.value.trim();
    const extra = attachedToNext;
    attachedToNext = null;
    if (!prompt || turn) return;
    if (!user) {
      ui.status.textContent='Sign in below to use the built-in agent.';
      return;
    }
    const active = turn = new AbortController();
    const changes = turnChanges = new Map();
    input.value = '';ui.mentions.hidden=true;
    controls();
    message('You', prompt);
    ui.status.textContent = 'Thinking…';
    const chips = new Map();
    let bubble = null, step = -1, text = '', frame = 0;
    const draw = () => { frame = 0; if (bubble) bubble.querySelector('.reply').replaceChildren(renderMarkdown(text)); };
    function settle() {
      if (!bubble) return;
      cancelAnimationFrame(frame); draw();
      if (record && text.trim()) { record.transcript.push({label: 'Duckbench', text}); persist(); }
      bubble = null;
    }
    try {
      await chat({request: account.request, project, history, prompt, signal: active.signal,
        context: contextNote() + (extra?.note ? ' ' + extra.note : ''), images: extra?.images || [],
        model: models.find(model => model.openrouter === ui.model.value), plan: ui.mode.value === 'plan', changed: changedFiles,
        onText: (delta, at) => {
          if (at !== step) { settle(); step = at; text = ''; }
          if (!bubble) {
            bubble = document.createElement('article');
            bubble.className = 'message-bubble assistant is-streaming';
            bubble.innerHTML = '<strong class="visually-hidden">Duckbench</strong><div class="reply"></div>';
            thread.append(bubble); ui.welcome.hidden = true;
          }
          text += delta;
          frame ||= requestAnimationFrame(draw);
          ui.status.textContent = 'Writing…';
          bubble.scrollIntoView({block: 'nearest'});
        },
        onTool: (id, name, args) => {
          settle();
          const detail = args?.path || args?.pattern || args?.name || args?.search || args?.view || '';
          const chip = message('Tool', name + (detail ? ' · ' + detail : ''), false);
          chip.classList.replace('is-done', 'is-running');
          chips.set(id, chip);
          ui.status.textContent = 'Using ' + name + '…';
        },
        onToolDone: (id, result) => {
          const chip = chips.get(id);
          if (!chip) return;
          const summary = result.content.filter(part => part.type === 'text').map(part => part.text).join('\n');
          chip.classList.replace('is-running', result.isError ? 'is-error' : 'is-done');
          chip.title = summary.slice(0, 600);
          if (record) { record.transcript.push({label: 'Tool', text: chip.querySelector('p').textContent, ...(result.isError ? {error: true} : {})}); persist(); }
          ui.status.textContent = 'Thinking…';
        },
        onNote: text => message('Note', text),
      });
      active.signal.throwIfAborted();
      settle();
      ui.status.textContent = '';
    } catch (error) {
      settle();
      for (const chip of chips.values()) chip.classList.replace('is-running', 'is-error');
      if (turn === active) ui.status.textContent = active.signal.aborted ? 'Stopped' : error.message;
    } finally {
      if (turnChanges === changes) turnChanges = null;
      if (changes.size) offerUndo(changes);
      if (turn === active) { turn = null; controls(); persist(); void refreshUsage(); }
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
  /** Send `text` as the user's message, with a note about what it refers to and pictures. */
  function askAbout(text, {note = '', images = []} = {}) {
    show();
    if (turn) { ui.status.textContent = 'Wait for the agent to finish, or stop it, then ask again.'; input.value = text; return false; }
    input.value = text;
    attachedToNext = {note, images};
    element.querySelector('form').requestSubmit();
    return true;
  }
  return {element,attach,ask:askAbout,contextKey:()=>context,setContext(key) {
    if (context === key) return;
    persist();reset(); context = key;loadContext();
    ui.scope.textContent = 'Share files, preview status and edit proposals for ' + project.state().project +
      (desktop ? ' with a local MCP client.' : ' with an MCP client while this tab is open.');
  }};
}
