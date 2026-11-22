import {callTool, instructions, tools} from './tools.js';

const functions = tools.map(({name, description, inputSchema}) => ({type: 'function', function: {name, description, parameters: inputSchema}}));

export async function chat({request, project, history, prompt, signal, onTool, model}) {
  if(!model){const {models}=await request('/models',{signal});model=models?.[0]?.openrouter;}
  if (!model) throw new Error('The backend has no models available.');
  const messages = [{role: 'system', content: instructions}, ...history, {role: 'user', content: prompt}];
  const attachments=[];
  for(const match of prompt.matchAll(/(?:^|\s)@(?:"((?:\\.|[^"\\])*)"|([^\s"]+))/g)){
    const path=match[1]!==undefined?JSON.parse('"'+match[1]+'"'):match[2];
    if(attachments.includes(path)||attachments.length>=8)continue;
    attachments.push(path);signal.throwIfAborted();
    const file=await callTool(project,'read_file',{path});
    signal.throwIfAborted();
    messages.at(-1).content+='\n\nAttached file '+path+'\n'+file.content[0].text;
    onTool('read_file',path);
  }
  for (let step = 0; step < 8; step++) {
    const response = await request('/v1/chat/completions', {method: 'POST', signal,
      body: {model, messages, tools: functions, max_tokens: 4096}});
    signal.throwIfAborted();
    const message = response?.choices?.[0]?.message;
    if (!message || message.role !== 'assistant') throw new Error('The model returned an empty response.');
    if (!message.tool_calls?.length) {
      if (typeof message.content !== 'string' || !message.content.trim()) throw new Error('The model returned no reply.');
      return message.content;
    }
    messages.push(message);
    for (const call of message.tool_calls) {
      signal.throwIfAborted();

      let content;
      try {
        const args=JSON.parse(call.function.arguments||'{}');onTool(call.function.name,args.path);
        const result = await callTool(project, call.function.name, args);
        content = result.content[0].text;
      } catch { content = 'Invalid tool arguments.'; }
      messages.push({role: 'tool', tool_call_id: call.id, content});
    }
  }
  throw new Error('Reached the tool-call limit for this turn. Try a narrower question.');
}
