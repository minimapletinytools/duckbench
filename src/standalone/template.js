// Imported scenes are JSON data. Only the bundled renderer is executable.
export function viewerPage({css, script, policy, notices}, model = null) {
  const payload = JSON.stringify(model).replaceAll('<', '\\u003c');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src '${policy}'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'">
<title>Duckbench Viewer</title><style>${css}</style></head><body>
<header><strong>Duckbench Viewer</strong><span id="model-name"></span><button id="open-cad" hidden>Open model…</button></header>
<main id="viewport" aria-label="3D model"></main><p id="notice" role="status"></p>
<script type="application/json" id="duckbench-licenses">${JSON.stringify(notices || {}).replaceAll('<', '\\u003c')}</script>
<script type="application/json" id="duckbench-scene">${payload}</script><script>${script}</script></body></html>`;
}
