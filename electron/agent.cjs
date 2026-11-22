const http = require('node:http');
const {randomUUID, randomBytes} = require('node:crypto');
const defaults = require('../src/agent/config.json');

function installAgent({win, ipcMain, shell}) {
  const config = {
    backend: process.env.VITE_KIGUMI_BACKEND_URL || defaults.backend,
    supabase: process.env.VITE_KIGUMI_SUPABASE_URL || defaults.supabase,
    key: process.env.VITE_KIGUMI_SUPABASE_KEY || defaults.key,
  };
  let local, cancelAuth;
  const pending = new Map();
  function handle(channel, callback) {
    ipcMain.handle(channel, (event, ...args) => {
      if (event.senderFrame !== win.webContents.mainFrame) throw new Error('Invalid sender.');
      return callback(...args);
    });
  }
  handle('agent:config', () => config);
  const requests = new Map();
  handle('agent:abort', id => requests.get(id)?.abort());
  handle('agent:request', async (id, path, init) => {
    if (!(['/models','/account'].includes(path) && init.method === 'GET' || path === '/v1/chat/completions' && init.method === 'POST')) {
      throw new Error('Unknown backend request.');
    }
    const controller = new AbortController();
    requests.set(id, controller);
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(120000)]);
    try {
      const response = await fetch(new URL(path, config.backend), {...init, redirect: 'error', signal});
      return {status: response.status, data: await response.json().catch(() => null)};
    } finally { requests.delete(id); }
  });
  handle('agent:authorize', async address => {
    const url = new URL(address);
    const redirect = 'http://127.0.0.1:43781/auth/callback';
    if (url.origin !== new URL(config.supabase).origin || url.pathname !== '/auth/v1/authorize' ||
        url.searchParams.get('redirect_to') !== redirect) throw new Error('Invalid sign-in URL.');
    cancelAuth?.();
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        const callback = new URL(req.url, redirect);
        if (req.method !== 'GET' || callback.origin !== new URL(redirect).origin || callback.pathname !== '/auth/callback' ||
            !(callback.searchParams.has('code') || callback.searchParams.has('error'))) {
          res.writeHead(404).end(); return;
        }
        res.writeHead(200, {'Content-Type': 'text/plain', 'Cache-Control': 'no-store'}).end('Return to Duckbench to finish signing in.');
        finish(null, callback.href);
      });
      function finish(error, value) {
        clearTimeout(timer);
        cancelAuth = null;
        server.close();
        if (error) reject(error); else resolve(value);
      }
      cancelAuth = () => finish(new Error('Sign-in cancelled.'));
      const timer = setTimeout(() => finish(new Error('Sign-in timed out.')), 180000);
      server.once('error', error => finish(error));
      server.listen(43781, '127.0.0.1', () => shell.openExternal(url.href).catch(error => finish(error)));
    });
  });

  function stop() {
    if (!local) return;
    const {server} = local;
    local = null;
    server.close();
    server.closeAllConnections();
    for (const call of pending.values()) call.reject(new Error('MCP stopped.'));
    pending.clear();
  }
  handle('agent:stop', stop);
  handle('agent:reply', (id, result) => pending.get(id)?.resolve(result));
  async function dispatch(scope, method, params) {
    if (local?.scope !== scope || pending.size >= 16) throw new Error('MCP unavailable.');
    const id = randomUUID();
    let timer;
    try {
      return await new Promise((resolve, reject) => {
        pending.set(id, {resolve, reject});
        timer = setTimeout(() => reject(new Error('Workbench timed out.')), 15000);
        win.webContents.send('agent:call', {scope, id, method, params});
      });
    } finally { pending.delete(id); clearTimeout(timer); }
  }
  handle('agent:start', async (scope, instructions) => {
    stop();
    const {Server} = require('@modelcontextprotocol/sdk/server/index.js');
    const {StreamableHTTPServerTransport} = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
    const {ListToolsRequestSchema, CallToolRequestSchema} = require('@modelcontextprotocol/sdk/types.js');
    const token = randomBytes(32).toString('hex');
    const server = http.createServer(async (req, res) => {
      try {
        if (req.url !== '/mcp') { res.writeHead(404).end(); return; }
        if (req.headers.origin || req.headers.host !== '127.0.0.1:' + server.address()?.port) { res.writeHead(403).end(); return; }
        if (local?.scope !== scope || req.headers.authorization !== 'Bearer ' + token) { res.writeHead(401).end(); return; }
        if (req.method !== 'POST') { res.writeHead(405, {Allow: 'POST'}).end(); return; }
        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 1024 * 1024) { res.writeHead(413).end(); return; }
          chunks.push(chunk);
        }
        let body;
        try { body = JSON.parse(Buffer.concat(chunks)); } catch { res.writeHead(400).end(); return; }
        const mcp = new Server({name: 'duckbench', version: '0.1.0'}, {capabilities: {tools: {}}, instructions});
        mcp.setRequestHandler(ListToolsRequestSchema, () => dispatch(scope, 'tools/list'));
        mcp.setRequestHandler(CallToolRequestSchema, request => dispatch(scope, 'tools/call', request.params));
        const transport = new StreamableHTTPServerTransport({sessionIdGenerator: undefined, enableJsonResponse: true});
        try { await mcp.connect(transport); await transport.handleRequest(req, res, body); }
        finally { await mcp.close(); }
      } catch {
        if (!res.headersSent) res.writeHead(500);
        res.end();
      }
    });
    local = {scope, server};
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    return {url: 'http://127.0.0.1:' + server.address().port + '/mcp', token};
  });

  function close() { cancelAuth?.(); stop(); for (const controller of requests.values()) controller.abort(); }
  win.webContents.on('did-start-navigation', event => { if (event.isMainFrame && !event.isSameDocument) close(); });
  win.on('closed', close);
}
module.exports = {installAgent};
