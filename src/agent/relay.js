import {callTool, instructions, tools} from './tools.js';

// Each connection belongs to one account and one project. Switching either stops it.
export function createRelay(account, project, report) {
  let current;
  const post = (path, options) => account.request(path, {method: 'POST', ...options});
  // Persist only the deletion credential after a disconnect so an offline stop can finish later.
  const prefix = 'duckbench.revoke.' + new URL(account.backend).origin + '/';
  const revoking = new Set();
  async function revoke({id, revokeToken}) {
    if (revoking.has(id)) return;
    revoking.add(id);
    const key = prefix + id;
    try { localStorage.setItem(key, revokeToken); } catch {}
    try {
      await post('/mcp/' + id + '/revoke', {token: revokeToken, keepalive: true, signal: AbortSignal.timeout(10000)});
    } catch (error) {
      if (error.status !== 410) {
        if (!current) report('Disconnected locally. Server revocation will retry when online or reopened.');
        return;
      }
    } finally { revoking.delete(id); }
    try { localStorage.removeItem(key); } catch {}
  }
  function retryRevocations() {
    try {
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith(prefix)) void revoke({id: key.slice(prefix.length), revokeToken: localStorage.getItem(key)});
      }
    } catch {}
  }
  window.addEventListener('online', retryRevocations);
  retryRevocations();

  function stop() {
    const old = current;
    current = null;
    if (!old) return;
    clearTimeout(old.retry);
    old.socket?.close();
    report('Disconnected');
    if (old.session) void revoke(old.session);
  }

  async function connect(link) {
    try {
      if (!link.session) {
        const session = await post('/mcp-sessions', {signal: AbortSignal.timeout(10000)});
        if (current !== link) { void revoke(session); return; }
        link.session = session;
      }
      const {ticket} = await post('/mcp-sessions/' + link.session.id + '/ticket', {body: {instructions}, signal: AbortSignal.timeout(10000)});
      if (current !== link) return;
      const url = new URL(link.session.url + '/connect');
      if (url.origin !== new URL(account.backend).origin) throw new Error('Unexpected relay origin.');
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      url.searchParams.set('ticket', ticket);
      const ws = link.socket = new WebSocket(url);
      ws.onopen = () => {
        if (current !== link) return;
        link.attempt = 0;
        report('Connected', link.session);
      };
      ws.onmessage = async event => {
        let msg;
        try { msg = JSON.parse(event.data); } catch { ws.close(1003); return; }
        if (current !== link || ws !== link.socket || msg?.v !== 1 || typeof msg.id !== 'string') return;
        const reply = {v: 1, id: msg.id};
        try {
          if (!Number.isFinite(msg.deadline) || Date.now() > msg.deadline) throw new Error('Call expired.');
          if (msg.method === 'tools/list') reply.result = {tools};
          else if (msg.method === 'tools/call') reply.result = await callTool(project, msg.params?.name, msg.params?.arguments);
          else throw new Error('Unknown relay method.');
        } catch (error) { reply.error = error.message; }
        if (current === link && ws === link.socket && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(reply));
      };
      ws.onclose = () => retry(link);
    } catch (error) {
      if (current !== link) return;
      if (link.session && (!error.status || error.status >= 500 || error.status === 429)) retry(link);
      else { stop(); report(error.message); }
    }
  }
  function retry(link) {
    if (current !== link) return;
    report('Reconnecting…');
    link.retry = setTimeout(() => void connect(link), Math.min(30000, 1000 * 2 ** Math.min(link.attempt++, 5)));
  }
  return {
    start() {
      if (current) return;
      retryRevocations();
      current = {attempt: 0};
      report('Connecting…');
      void connect(current);
    },
    stop,
  };
}
