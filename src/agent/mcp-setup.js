// Build clipboard text on demand from the current session's client credentials.
const json = value => JSON.stringify(value, null, 2);
const quote = text => "'" + text.replaceAll("'", "'\\''") + "'";

export const clients = [
  {
    label: 'Claude Code',
    next: 'Run the copied command in a terminal, then open /mcp in Claude Code.',
    format: ({url, headers}) => `claude mcp add --transport http --scope user duckbench ${quote(url)} --header ${quote('Authorization: ' + headers.Authorization)}`,
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

export function setupText({url, token}, client) {
  const server = {url, headers: {Authorization: 'Bearer ' + token}};
  if (client) return client.format(server);
  return [
    'Connect yourself to my open Duckbench CAD project using its Streamable HTTP MCP server, named duckbench.',
    'Choose the setup for your own client below. Add or update only the duckbench entry in your local user configuration. Preserve my other MCP servers and keep the credential out of project files and replies.',
    ...clients.map(({label, next, format}) => label + '\n' + next + '\n' + format(server)),
    'Once connected, call workbench_state and tell me the project name and active file. If your client needs a reload or restart to see the tools, tell me what to do. Keep Duckbench open during the connection.',
  ].join('\n\n');
}
