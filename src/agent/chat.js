// The built-in agent's loop: one user turn, as many model steps and tool calls as it takes.
// The conversation (`history`, OpenAI chat messages) is extended in place as the turn goes.
import {callTool, chatTools, chatInstructions, PLAN_MODE_NOTE} from './tools.js';

/** Steps in one turn, each a model call and the tools it asks for. */
export const MAX_STEPS = 40;
/** Per step; the backend caps it per model. Reasoning counts toward it. */
const MAX_TOKENS = 32000;
const MAX_CONTINUATIONS = 2;
const MAX_NUDGES = 2;
/** Tool results older than this many user turns are cut short. */
const KEEP_TOOL_RESULTS = 2;
const SUMMARY_REQUEST = 'Summarise our conversation so far for carrying on the work: what the user wants, what has been done ' +
  '(files changed and how), what was found, and what is left. Keep file paths, names and numbers exact. Say only what the ' +
  'conversation shows; mark anything you did not confirm as a guess. Plain text, as short as it can be while keeping all of that.';
const NOTES = {
  cut: 'Your last reply was cut off at the output limit. Continue from exactly where it stopped, without repeating it.',
  cutTool: 'Your last tool call was cut off at the output limit, so it did not run. Make smaller changes: edit_file with a ' +
    'short old_string, or write the file in parts.',
  empty: 'Your last step produced nothing: no reply and no tool call. Act now with what you have, e.g. edit and build, ' +
    'and let the result tell you what to fix.',
  repeat: name => `This ${name} call gave the same result as the same call earlier this turn. To see something else, change the arguments.`,
};

const functions = chatTools.map(({name, description, inputSchema}) => ({type: 'function', function: {name, description, parameters: inputSchema}}));
const note = text => '[Duckbench note: ' + text + ']';
export const estimateTokens = messages => Math.ceil(JSON.stringify(messages).length / 3.5);

/** Cut old tool results and drop old pictures, keeping recent turns whole. */
export function trimHistory(history, {images = true} = {}) {
  // A user turn starts with the user's own message; Duckbench's own notes stand alone.
  const users = history.map((message, i) => message.role === 'user' && typeof message.content === 'string' &&
    !/^\[Duckbench note: [^\n]*\]$/.test(message.content) ? i : -1).filter(i => i >= 0);
  const keepFrom = users.length > KEEP_TOOL_RESULTS ? users.at(-KEEP_TOOL_RESULTS) : 0;
  history.forEach((message, i) => {
    if (i < keepFrom && message.role === 'tool' && message.content.length > 1500) {
      message.content = message.content.slice(0, 1200) + '\n[…older result cut short; call the tool again if you need it]';
    }
    if (Array.isArray(message.content) && (i < keepFrom || !images)) {
      message.content = message.content.filter(part => part.type !== 'image_url').map(part => part.text).join('\n') + ' [picture no longer kept]';
    }
  });
  return history;
}

/** Make every assistant tool call answered, as the API requires, after a turn stopped part way. */
function closeCalls(history) {
  for (let i = 0; i < history.length; i++) {
    const calls = history[i].role === 'assistant' ? history[i].tool_calls || [] : [];
    for (const call of calls) {
      if (history.some(message => message.role === 'tool' && message.tool_call_id === call.id)) continue;
      let at = i + 1;
      while (at < history.length && history[at].role === 'tool') at++;
      history.splice(at, 0, {role: 'tool', tool_call_id: call.id, content: 'Stopped by the user before it ran.'});
    }
  }
}

/** Merge a streamed delta's reasoning details into the ones so far, by index. */
function mergeDetails(details, parts) {
  for (const part of parts || []) {
    const at = details.find(item => part.index !== undefined && item.index === part.index);
    if (!at) { details.push({...part}); continue; }
    for (const key of ['text', 'summary', 'data']) if (typeof part[key] === 'string') at[key] = (at[key] || '') + part[key];
    if (part.signature) at.signature = part.signature;
  }
}

/** One model call, streamed when the backend streams. Returns {message, finish}. */
async function complete({request, body, signal, onText}) {
  const message = {role: 'assistant', content: ''};
  const calls = [], details = [];
  let finish = null, buffer = '';
  function event(data) {
    if (data.error) throw new Error(data.error.message || 'The model failed.');
    const choice = data.choices?.[0];
    if (!choice) return;
    const delta = choice.delta || {};
    if (delta.content) { message.content += delta.content; onText(delta.content); }
    mergeDetails(details, delta.reasoning_details);
    for (const part of delta.tool_calls || []) {
      const call = calls[part.index ?? calls.length] ??= {id: '', type: 'function', function: {name: '', arguments: ''}};
      if (part.id) call.id = part.id;
      if (part.function?.name) call.function.name += part.function.name;
      if (part.function?.arguments) call.function.arguments += part.function.arguments;
    }
    if (choice.finish_reason) finish = choice.finish_reason;
  }
  const data = await request('/v1/chat/completions', {method: 'POST', signal, body: {...body, stream: true}, onChunk: text => {
    buffer += text;
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end).trim();
      buffer = buffer.slice(end + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') continue;
      let parsed;
      try { parsed = JSON.parse(payload); } catch { continue; }
      event(parsed);
    }
  }});
  if (data) {
    // The backend answered without streaming.
    const reply = data.choices?.[0];
    if (!reply?.message) throw new Error('The model returned an empty response.');
    if (reply.message.content) onText(reply.message.content);
    return {message: {role: 'assistant', content: reply.message.content || null, ...(reply.message.tool_calls?.length ? {tool_calls: reply.message.tool_calls} : {})},
      finish: reply.finish_reason || null};
  }
  if (calls.length) message.tool_calls = calls.filter(Boolean).map((call, i) => ({...call, id: call.id || 'call_' + i + '_' + Date.now()}));
  if (details.length) message.reasoning_details = details;
  if (!message.content) message.content = null;
  return {message, finish};
}

/** Summarise the conversation when it grows past half the model's window, keeping changed files as they are now. */
async function compact({request, history, model, signal, changed, onNote}) {
  const budget = Math.min(model?.contextWindow || 128000, 400000) * 0.5;
  if (estimateTokens(history) < budget) return;
  onNote('Summarising the earlier conversation to keep it within the model\'s limit…');
  const {message} = await complete({request, signal, onText: () => {},
    body: {model: model.openrouter, max_tokens: 4000, messages: [{role: 'system', content: chatInstructions}, ...history, {role: 'user', content: SUMMARY_REQUEST}]}});
  if (!message.content) throw new Error('Could not summarise the conversation. Start a new chat.');
  const files = await changed();
  history.splice(0, history.length,
    {role: 'user', content: note('a summary of the conversation so far') + '\n' + message.content + (files ? '\n\n' + files : '')},
    {role: 'assistant', content: 'Understood. I will carry on from there.'});
  onNote('Summarised the earlier conversation.');
}

/**
 * Run one turn. `onText(delta, step)` streams the reply; `onTool(id, name, args)` and `onToolDone(id, result)` show tool
 * calls; `onNote(text)` reports what Duckbench did. Returns the reply's text.
 */
export async function chat({request, project, history, prompt, context = '', signal, model, plan = false,
  onText = () => {}, onTool = () => {}, onToolDone = () => {}, onNote = () => {}, changed = async () => ''}) {
  if (!model) {
    const {models} = await request('/models', {signal});
    model = models?.[0];
  }
  if (!model?.openrouter) throw new Error('The backend has no models available.');
  closeCalls(history);
  await compact({request, history, model, signal, changed, onNote});
  let content = (context ? note(context) + '\n\n' : '') + prompt;
  const attached = [];
  for (const match of prompt.matchAll(/(?:^|\s)@(?:"((?:\\.|[^"\\])*)"|([^\s"]+))/g)) {
    const path = match[1] !== undefined ? JSON.parse('"' + match[1] + '"') : match[2];
    if (attached.includes(path) || attached.length >= 8) continue;
    attached.push(path);
    signal.throwIfAborted();
    const file = await callTool(project, 'read_file', {path}, {chat: true});
    content += '\n\nAttached file ' + path + '\n' + file.content[0].text;
    onNote('Attached ' + path);
  }
  history.push({role: 'user', content});
  const system = chatInstructions + (plan ? '\n\n' + PLAN_MODE_NOTE : '');
  const seen = new Map();
  let reply = '', continuations = 0, nudges = 0;
  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      trimHistory(history, {images: !!model.images});
      const {message, finish} = await complete({request, signal, onText: delta => onText(delta, step),
        body: {model: model.openrouter, messages: [{role: 'system', content: system}, ...history], tools: functions, max_tokens: MAX_TOKENS}});
      signal.throwIfAborted();
      if (message.content) reply += (reply && !continuations ? '\n\n' : '') + message.content;
      if (!message.tool_calls?.length) {
        if (finish === 'length' && continuations < MAX_CONTINUATIONS) {
          history.push(message, {role: 'user', content: note(NOTES.cut)});
          continuations++;
          continue;
        }
        if (!message.content?.trim()) {
          if (nudges++ < MAX_NUDGES) { history.push({role: 'user', content: note(NOTES.empty)}); continue; }
          throw new Error('The model returned no reply.');
        }
        history.push(message);
        return reply;
      }
      continuations = 0;
      history.push(message);
      const pictures = [];
      for (const call of message.tool_calls) {
        signal.throwIfAborted();
        const name = call.function.name;
        let args, result;
        try { args = JSON.parse(call.function.arguments || '{}'); }
        catch { args = null; }
        onTool(call.id, name, args);
        if (!args || typeof args !== 'object') {
          result = {isError: true, content: [{type: 'text', text: finish === 'length' ? NOTES.cutTool : 'The arguments were not valid JSON.'}]};
        } else if (name === 'screenshot' && !model.images) {
          result = {isError: true, content: [{type: 'text', text: 'This model cannot see pictures. Use describe_model to measure the model instead.'}]};
        } else {
          result = await callTool(project, name, args, {chat: true});
        }
        signal.throwIfAborted();
        let text = result.content.filter(part => part.type === 'text').map(part => part.text).join('\n');
        for (const part of result.content) if (part.type === 'image') pictures.push({name, part});
        const key = name + JSON.stringify(args);
        if (seen.get(key) === text && !result.isError && !['run_build', 'screenshot', 'update_todos'].includes(name)) text += '\n\n' + note(NOTES.repeat(name));
        seen.set(key, text);
        history.push({role: 'tool', tool_call_id: call.id, content: (result.isError ? 'Error: ' : '') + text});
        onToolDone(call.id, result);
      }
      if (pictures.length) {
        history.push({role: 'user', content: [{type: 'text', text: note('the screenshot' + (pictures.length > 1 ? 's' : '') + ' you asked for')},
          ...pictures.map(({part}) => ({type: 'image_url', image_url: {url: `data:${part.mimeType};base64,${part.data}`}}))]});
      }
    }
    throw new Error(`Stopped after ${MAX_STEPS} steps. Ask the agent to continue, or narrow the task.`);
  } finally {
    closeCalls(history);
  }
}
