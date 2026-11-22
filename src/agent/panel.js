import {createAccount} from './account.js';
import {createRelay} from './relay.js';
import {callTool, instructions, tools} from './tools.js';
import {chat} from './chat.js';
import './panel.css';
import {conversations} from './conversations.js';

export function createAgentPanel(project, {apply, run, runLabel, show}) {
  const element = document.createElement('section');
  element.className = 'agent-panel';
  element.innerHTML = `<div class="panel-toolbar"><strong>AGENT</strong><span class="panel-spacer"></span><select data-id="model" aria-label="Agent model" hidden></select><button data-id="past">History</button><button data-id="clear">New chat</button></div>
    <div data-id="threads" class="agent-history" hidden></div>
    <details class="agent-settings"><summary>Account &amp; MCP <span data-id="indicator"></span></summary><div class="agent-account"><span data-id="identity">Signed out</span><div data-id="providers"><button data-provider="github">Sign in with GitHub</button><button data-provider="google" aria-label="Sign in with Google">Google</button></div><button data-id="logout" hidden>Sign out</button></div>
    <details class="agent-mcp"><summary>MCP connection</summary><p data-id="scope"></p>
    <div><button data-id="connect">Connect MCP</button><button data-id="copy" hidden>Copy client setup</button></div><output data-id="connection">Disconnected</output></details></details>
    <div class="agent-thread" role="log" aria-label="Conversation"></div>
    <section class="agent-proposal" aria-label="Proposed edit" hidden><strong data-id="target"></strong><details open><summary>Review edit</summary><pre class="removed" data-id="original"></pre><pre class="added" data-id="replacement"></pre></details><div><button data-id="apply">Apply edit</button> <button data-id="applyRun">Apply &amp; Run</button> <button data-id="discard">Discard</button></div></section>
    <form class="agent-compose"><textarea aria-label="Message to agent" rows="3" placeholder="Ask about this project…"></textarea>
    <div data-id="mentions" class="agent-mentions" hidden></div><small data-id="billing" hidden>Chat uses your Kigumi credits.</small><div><output data-id="status" role="status"></output><button data-id="send" class="primary" disabled>Send</button><button type="button" data-id="cancel" hidden>Stop</button></div></form>`;
  const ui = Object.fromEntries([...element.querySelectorAll('[data-id]')].map(node => [node.dataset.id, node]));
  const thread = element.querySelector('.agent-thread');
  const input = element.querySelector('textarea');
  const desktop = window.desktop;
  let account, relay, user, turn, session, connection, context, signingIn = false;
  let storage=null,record=null,mentionId=0;
  const history=[];
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
    ui.identity.textContent = user ? user.email || 'Signed in' : 'Signed out';
    ui.providers.hidden = !!user;
    for (const button of ui.providers.children) button.disabled = !account || signingIn;
    ui.logout.hidden = ui.billing.hidden = !user;
    ui.connect.disabled = !desktop && (!user || !relay);
    ui.connect.textContent = connection ? 'Disconnect MCP' : 'Connect MCP';
    ui.indicator.textContent=session?' · Connected':'';
    ui.copy.hidden = !session;
    ui.send.disabled = !user || !input.value.trim() || !!turn;
    ui.send.hidden = !!turn;
    ui.cancel.hidden = !turn;
  }
  function report(message, setup) {
    session = setup;
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
    const from = document.createElement('strong');
    from.textContent = label;
    const body = document.createElement('p');
    body.textContent = text;
    item.append(from, body);
    thread.append(item);
    item.scrollIntoView({block: 'nearest'});
  }
  desktop?.onMcpCall(async ({scope, id, method, params}) => {
    if (scope !== connection) return;
    const result = method === 'tools/list' ? {tools} : await callTool(project, params.name, params.arguments);
    if (scope === connection) await desktop.replyMcp(id, result);
  });
  ui.connect.onclick = async () => {
    if (connection) { stop(); return; }
    const scope = connection = crypto.randomUUID();
    report('Connecting…');
    if (desktop) {
      try {
        const setup = await desktop.startMcp(scope, instructions);
        if (connection === scope) report('Connected', setup);
      } catch (error) { if (connection === scope) report(error.message); }
    } else relay.start();
  };
  ui.copy.onclick = async () => {
    if (!session) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify({mcpServers: {duckbench: {
        url: session.url, headers: {Authorization: 'Bearer ' + session.token},
      }}}, null, 2));
      ui.connection.textContent = 'Client setup copied';
    } catch (error) { ui.connection.textContent = 'Could not copy setup. ' + error.message; }
  };
  ui.providers.onclick = async event => {
    const provider = event.target.dataset.provider;
    if (!provider || !account || signingIn) return;
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
    if (!prompt || !user || turn) return;
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
      if (turn === active) { turn = null; controls(); }
    }
  };
  input.onkeydown = event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      element.querySelector('form').requestSubmit();
    }
  };
  if(/[?&](code|error)=/.test(location.search))element.querySelector('.agent-settings').open=true;
  controls();
  void (async () => {
    account = await createAccount(next => {
      if (user?.id !== next?.id){persist();reset();user=next;loadContext();void loadModels();}else user=next;
      controls();
    });
    if (!desktop) relay = createRelay(account, project, report);
    controls();
    await account.finishRedirect();void loadModels();
  })().catch(error => { ui.status.textContent = error.message; });
  window.addEventListener('pagehide', () => { turn?.abort(); stop(); });
  return {element,attach,contextKey:()=>context,setContext(key) {
    if (context === key) return;
    persist();reset(); context = key;loadContext();
    ui.scope.textContent = 'Share files, preview status and edit proposals for ' + project.state().project +
      (desktop ? ' with a local MCP client.' : ' with an MCP client while this tab is open.');
  }};
}
