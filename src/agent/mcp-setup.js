// Build clipboard text on demand from the current session's client credentials.
const json = value => JSON.stringify(value, null, 2);
const quote = text => "'" + text.replaceAll("'", "'\\''") + "'";

export const clients = [
  {
    label: 'Claude Code',
    next: 'Run the copied command in a terminal, then open /mcp in Claude Code.',
    format: ({url, headers}) => `claude mcp add --transport http duckbench ${quote(url)} --header ${quote('Authorization: ' + headers.Authorization)}`,
  },
  {
    label: 'Codex',
    next: 'Merge the copied table into ~/.codex/config.toml, then start a new Codex session.',
    format: ({url, headers}) => `[mcp_servers.duckbench]\nurl = ${json(url)}\nhttp_headers = { Authorization = ${json(headers.Authorization)} }`,
  },
  {
    label: 'Antigravity (agy)',
    next: 'Run the copied command in a terminal, then reopen Antigravity.',
    format: ({url, headers}) => `agy mcp add --type http --header ${quote('Authorization: ' + headers.Authorization)} duckbench ${quote(url)}`,
  },
  {
    label: 'Claude Desktop',
    next: 'Open Settings → Developer → Edit Config. Merge the copied entry into claude_desktop_config.json and restart Claude Desktop. This setup uses Node.js and npx.',
    format: ({url, headers}) => json({mcpServers: {duckbench: {
      command: 'npx', args: ['-y', 'mcp-remote', url, '--header', 'Authorization:${DUCKBENCH_AUTH}'],
      env: {DUCKBENCH_AUTH: headers.Authorization},
    }}}),
  },
  {
    label: 'Cursor',
    next: 'Merge the copied entry into ~/.cursor/mcp.json, then open Cursor’s MCP settings.',
    format: server => json({mcpServers: {duckbench: server}}),
  },
  {
    label: 'VS Code',
    next: 'Run “MCP: Open User Configuration” in the Command Palette. Merge the copied entry into mcp.json and start duckbench.',
    format: server => json({servers: {duckbench: {type: 'http', ...server}}}),
  },
  {
    label: 'URL and token',
    next: 'Choose Streamable HTTP in your client and enter the copied URL and Authorization header.',
    format: ({url, headers}) => `URL: ${url}\nAuthorization: ${headers.Authorization}`,
  },
];

const isLocal = url => ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname);

/** The prompt for any agent: a plain request from the user, with the facts it needs to check it, and no installer. */
export function setupPrompt({url, token}) {
  const local = isLocal(url);
  return [
    'I\'d like you to connect to Duckbench, my build123d CAD workbench, as an MCP server. This is my own request: I copied this text from the MCP connection section of Duckbench\'s Agent panel.',
    'Name: duckbench\nTransport: Streamable HTTP\nURL: ' + url + '\nHeader: Authorization: Bearer ' + token,
    local
      ? 'The URL is the Duckbench desktop app on this computer. If you run somewhere else, such as a cloud session, you can\'t reach it; just tell me.'
      : 'The URL is Duckbench\'s relay, a Cloudflare Worker that forwards calls to the Duckbench tab I have open.',
    'The token is a temporary credential I generated for this connection. It only reaches the project I have open, ' + (local ? 'and stops working when I turn off the MCP server or quit Duckbench.' : 'expires within 24 hours, and stops working when I turn off the MCP server.') + ' Please don\'t commit it, write it into project files or repeat it in replies.',
    'Add the server the way your client normally adds an HTTP MCP server. Scope it to this session or this project\'s private settings where you can; a user-wide install isn\'t needed, since the token doesn\'t outlast the connection. If you\'d rather not add it yourself, say so and I\'ll use the setup for my client from the same panel.',
    'Once connected, call workbench_state and tell me the project name and active file, so I can check it\'s my project. If you need a reload or restart to see the tools, tell me.',
  ].join('\n\n');
}

export function setupText({url, token}, client) {
  if (client) return client.format({url, headers: {Authorization: 'Bearer ' + token}});
  return setupPrompt({url, token});
}
