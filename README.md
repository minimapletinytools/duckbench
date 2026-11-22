# Duckbench

A standalone build123d workbench for Electron and static web hosting. Assign a shape to `result`; the app executes the script and displays that object. No `show()` call or CAD server is required.

```python
from build123d import *
result = Box(40, 30, 8) - Cylinder(6, 12)
```

[Open Duckbench](https://minimapletinytools.github.io/duckbench/)

## GitHub Pages

Pushes to `main` run `.github/workflows/pages.yml`: install locked dependencies, run the Python contract tests, regenerate credits, build the static app, and deploy `dist/` to GitHub Pages. The workflow can also be started manually from Actions. In repository Settings → Pages, the source must be **GitHub Actions**.

## Run

Requires Node.js and uv for development.

```sh
npm install
uv sync
npm run desktop
```

For the browser:

```sh
npm run dev
```

`npm run build` creates `dist/`, which can be served by any static HTTP(S) host, including under a subdirectory. `npm run preview` serves the production build locally. The browser loads Pyodide and CAD packages over the network on first run; it does not submit modeling code to a CAD server. Browser projects are saved in IndexedDB. **Projects** creates, opens, deletes, and exports multiple named project folders; the last project and active file are restored on reload. Edits, new files, imports, and deletions are automatically saved, with **Save to cache** available for an immediate commit. **Download file** downloads the current source, and **Export ZIP** backs up a whole project. **Projects → Import project ZIP** restores the files into a new project. Duckbench archives also restore the active file and pinned run target. Older source-only ZIPs are supported. **Import folder** creates a separate cached project (Python and common text/CAD data files), preserving paths for sibling imports. Browser cache is local to this origin and browser profile, not disk files or cloud storage; clearing site data removes it. Desktop Open Folder browses files directly from disk.

`npm run package` stages the current platform's managed Python interpreter and its dependencies, then builds an Electron application in `release/app/`. Package on each target OS/architecture. A macOS arm64 application is the currently tested target. Local builds are unsigned (`build.mac.identity` is null). Configure signing explicitly for distribution. Distribution installers, notarization, auto-update, and other-platform packaging are follow-up work. `BUILD1234_PYTHON` can override the desktop Python executable.

## Standalone viewer

Open **Duckbench Viewer** and choose **Open model…** (⌘O / Ctrl+O). It opens STEP, STP, STL and interactive HTML exported by Duckbench. STEP assemblies retain the part names available in the source. STL supplies a triangle mesh. The packaged viewer includes its CAD importer and works offline without signing in.

Run the viewer from the checkout or build a separate desktop application for the current platform.

```sh
uv sync
npm run viewer
npm run viewer -- ./part.step
npm run package:viewer
```

On Apple silicon the bundle is `release/viewer/mac-arm64/Duckbench Viewer.app`. Local macOS builds are unsigned. In the workbench, build a model and choose **Preview → Viewer HTML ↓** to share one offline, interactive file. Open the HTML directly in a WebGL-capable browser or in the desktop viewer. It contains the displayed geometry, its assembly tree, renderer and license notices. Source code and project history stay in the workbench. After a failed build the export uses the last successful preview.

## Agent, files and MCP

In the explorer, use **Find a file** (⌘P / Ctrl+P), arrow keys and Enter to open a match. Right-click a Python file and choose **Set as run target** to keep building it while editing a helper. The run button shows the target. Browser builds use current project buffers. On desktop, **Save changed files & Run** writes edited project helpers before Python imports them.

Open **Agent** and expand **Account & MCP** to sign in. Mention a file with `@path`, or use **Ask agent about this file** in the explorer. The agent can propose an edit to any project text file. Review the path and diff, then choose **Apply edit**, **Apply & Run** or **Discard**. Duckbench checks the original text again on approval. Native edits stay in memory until saved or explicitly saved for a build.

The model picker uses the Duckbench Worker catalog. Chat charges the signed-in Kigumi account. Sending a message can send mentioned files and project text requested by the model to that backend. Drafts and conversations are stored locally for the current account and project. Reopen **History** to resume a previous conversation.

### Connect an external MCP client

1. Open the project and select **Agent → Account & MCP → MCP connection → Connect MCP**. The web version requires sign-in. Desktop can serve a local client while signed out.
2. Select **Copy client setup**. The JSON contains the Streamable HTTP endpoint and its bearer header. Clients such as Cursor accept the `mcpServers` entry directly. For a client with separate fields, use the supplied URL and Authorization header.
3. Keep the Duckbench window open. **Disconnect MCP**, signing out, or switching projects ends access. Reconnecting creates fresh client setup.

| Tool | What the client can do |
| --- | --- |
| `workbench_state` | Inspect the project name, current file, and build or preview status. |
| `build_result` | Inspect the build target, last attempt, project traceback locations and displayed build. |
| `list_files` | Browse one project directory at a time. |
| `read_file` | Read project text, including unsaved edits, in chunks using `nextOffset`. |
| `propose_edit` | Submit one exact replacement for review in a project file. Duckbench checks that the source still matches when the user clicks Apply. |

Desktop uses a bearer-protected HTTP server on an ephemeral loopback port. The Electron renderer dispatches tool calls against the open folder or the active standalone document. Its OAuth callback also uses loopback, with a separate listener that exists only during sign-in. Desktop account sessions last until the window closes.

On the web, the static app creates a relay session using its Supabase access token, requests a single-use ticket and opens an outbound WebSocket to the Worker. The external client speaks Streamable HTTP to the Worker with a separate relay credential. The tab answers tool requests using the current IndexedDB project and editor buffers. A temporary socket loss triggers reconnection to the same session. The Worker expires sessions after 24 hours.

### Hosted setup

Duckbench uses its own Cloudflare Worker, `https://duckbench-backend.kigumi-backend.workers.dev`, and the existing Kigumi Supabase project. Users and chat balances are shared. The Worker owns Duckbench’s relay sessions, signing secret, rate limits and allowed browser origins.

- In the Kigumi Supabase project, add any missing Duckbench sign-in redirects for the clients you use. The web URLs are `https://minimapletinytools.github.io/duckbench/` and `http://localhost:5173/`. Electron uses `http://127.0.0.1:43781/auth/callback`.
- Chat needs two secrets on the Duckbench Worker. Set `SUPABASE_SERVICE_ROLE_KEY` from the shared project and `OPENROUTER_API_KEY` from OpenRouter. The browser MCP relay uses its own `MCP_ROUTING_SECRET` and works independently of chat.
- To release Worker changes, run `npm run deploy:duckbench` from the sibling `kigumi-backend` repository. This targets `wrangler.duckbench.jsonc`. Kigumi’s existing deployment workflow owns shared database migrations. The Duckbench GitHub Pages workflow deploys the web client separately.

For local web development, run `npm run dev -- --host localhost --port 5173 --strictPort` and open `http://localhost:5173/`. The public defaults are in `src/agent/config.json`. The web build and Electron launcher support overrides through `VITE_KIGUMI_BACKEND_URL`, `VITE_KIGUMI_SUPABASE_URL` and `VITE_KIGUMI_SUPABASE_KEY` (publishable key). [Duckbench setup guide](duckbench-setup.html)

### Relationship to Kigumi

Kigumi’s `agent/account.js`, `agent/mcp-relay.js` and `agent/mcp-http.js` establish the sign-in and transport contracts. The public HTTP routes, credential checks, tickets and session expiry are owned by `kigumi-backend/src/index.ts` and `src/mcp-relay.ts` in that repository. Duckbench supplies its own tool registry and adapts those calls to Monaco, the build123d preview and its existing file stores. The Duckbench relay identifies itself as `duckbench` during MCP initialization and returns the tab’s instructions and tool list.

Duckbench supports one pending edit at a time. Batch edits and project-wide checkpoints remain future work.

## Implementation plan and current scope

1. **Shared execution contract — implemented.** `python/runner.py` executes source with `__name__ == '__main__'`, a meaningful filename, and fresh script globals. `result` must be a build123d Shape or completed BuildPart/BuildSketch/BuildLine. Use `Compound(children=[...])` for assemblies. Missing/invalid results produce explicit errors. Desktop sibling imports run relative to the selected file; previously loaded project modules are invalidated on rerun.
2. **Geometry adapter — implemented.** `ocp-tessellate` supplies scene hierarchy, triangles, CAD edges, and face/edge metadata to `three-cad-viewer`. The runner retains the last successful CAD shape for STEP/STL export. Render failures and script errors preserve the last successful viewport. Cancellation destroys the runner and requires rebuilding before export.
3. **Host transports — implemented.** Electron owns a persistent native Python subprocess, communicating via JSON lines. Python and native stdout are routed to the log separately from the protocol. The web host runs the same adapter in a Pyodide worker with OCP.wasm, using worker messages. Both can be terminated to cancel a stuck build.
4. **Workbench — implemented.** Kigumi-style panel shell with a resizable left explorer, a combined filename / Preview tab, optional split view, and collapsible Output panel. Monaco provides Python syntax highlighting, editing, undo, and keyboard navigation. The Agent button opens project-aware chat and MCP connection controls. Also includes open/save, model tree, orbit/pan/zoom, viewer inspection controls, logs/errors, STEP/STL export, and keyboard shortcuts. Desktop watches the selected file for external edits and updates the editor when there are no unsaved changes; the preview offers a refresh button instead of rebuilding automatically. Switching files retains their unsaved text in the current session. The preview fills the available center pane and resizes with the window and panel layout.
5. **Validation and packaging — implemented for macOS arm64 and Chrome.** Native contract tests, actual browser execution/render/export/error/cancel checks, desktop render/export smoke, and production static build. See commands below.
6. **Next increments.** Dependency-file watching on desktop, exact kernel-backed measurement requests, font parity tests, explicit cross-runtime geometry parity tests, browser dependency lock/vendor cache, resource limits, multi-platform release CI and installers.

The architecture follows Kigumi's host/runner boundaries. The implementation is new and does not copy its Kumiki-specific runner or timber geometry code. Native Python executes selected scripts with the user's filesystem/process access; it is not a sandbox. A worker keeps browser execution off the UI thread but is not an isolated origin for hostile scripts.

## Versions and provenance

- build123d 0.13.0 and ocp-tessellate 3.6.3; native dependency resolution is in `uv.lock`.
- three-cad-viewer 5.1.3; JavaScript dependencies are in `package-lock.json`.
- Pyodide 314.0.7 from jsDelivr. Browser transitive Python/WASM dependencies are resolved by the upstream bootstrap and are not yet fully locked or vendored.
- OCP.wasm bootstrap is vendored at the commit recorded in `public/ocp-bootstrap-source.json`; its license is alongside it.

## Checks

```sh
npm test
npm run build
node tests/desktop.mjs
node tests/file-actions-desktop.mjs
node tests/agent.mjs desktop
# Requires ../kigumi-backend with its locked dev dependencies installed.
node tests/agent.mjs web
# In another terminal: npm run preview
TEST_URL=http://127.0.0.1:4173 npm run test:browser
TEST_URL=http://127.0.0.1:4173 node tests/workbench.mjs
TEST_URL=http://127.0.0.1:4173 node tests/projects.mjs
TEST_URL=http://127.0.0.1:4173 node tests/viewer-workflow.mjs
```

The web agent test uses a local authenticated Cloudflare Worker fixture, a simulated OAuth provider and a model stub. It covers PKCE callback handling, real WebSocket and MCP requests, edit review and revocation. Set `KIGUMI_BACKEND_DIR` to use a different backend checkout.

The viewer workflow restores a ZIP, exports all three geometry formats, opens the HTML offline and exercises the independent Electron app. Set `TEST_VIEWER` to the packaged viewer executable to test the bundle.

The browser smoke uses installed Chrome through Playwright; set `TEST_BROWSER_CHANNEL` for another installed Chromium channel. Screenshots are written to `test-artifacts/`.

## Panel architecture

`src/panels.js` owns registration, layout, active tabs and split mode. Panels register an element in `left`, `center`, `right`, or `bottom` and receive layout notifications. The Agent toggle opens the right slot. `src/editor.js` owns Monaco and its bundled worker. `src/cad-panel.js` owns the CAD viewer and measures its available area, subtracting the embedded toolbar and tree before sizing the canvas. `src/app.js` coordinates document state, explorer actions, execution and exports. Electron filesystem access is exposed through the narrow preload bridge.

Fresh sessions open `duck.py`, the bundled Puddle the duck example; an existing saved editor buffer is restored instead. **New file** creates a blank, uniquely named Python document and focuses the editor. Save chooses its desktop location or commits it to the browser project cache. The first cache migration preserves the previously remembered source file; only an exact, unedited legacy box template in `example.py` or `plate.py` is replaced with the duck. Modified legacy files are preserved with a separate `duck.py` starter.

The combined **[filename | Preview]** tab highlights both halves in split view. Clicking a half returns to that single view; the split button shows both again. Use the titlebar controls to hide the explorer, show Output, or split the editor and preview. Drag the explorer divider or Output divider to resize them. In split view, drag the divider between editor and preview to adjust their widths (heights on narrow screens). The split ratio persists across reloads; focus the divider to use arrow keys, or double-click it for an equal split. Ctrl/Cmd+Enter builds the model; Ctrl/Cmd+S saves the source. The first browser run shows setup progress and explains the initial package downloads. Later builds show compact progress in the preview toolbar, preserving the previous model. **Refresh preview** appears when the active source or imported project differs from the last successful build, including edits made during a build.

Right-click a file in Explorer (or press Shift+F10) and choose **Delete file…**. A confirmation explains the action: desktop files move to Trash, while browser files are removed from the cached project without changing the originals on disk. Unsaved edits to the deleted file are discarded; deleting the last open file leaves a blank editor. Deleted browser dependencies are removed from the Python runtime on the next build.

## License and credits

Original Duckbench code is licensed under **Apache-2.0**; see [LICENSE](LICENSE) and [NOTICE](NOTICE). This matches build123d and ocp-tessellate and permits use alongside the MIT-licensed three-cad-viewer while retaining its notices. Third-party dependencies keep their own licenses; the application license does not relicense them or impose a license on models created with the app.

The **?** button beside the Duckbench title opens an offline page with upstream credits, full license texts, and notices. `npm run credits` regenerates `public/about.html` and `public/licenses/` from the installed JavaScript and Python packages. It runs automatically before development and production builds. Both the static web build and Electron package include these files, including build123d's NOTICE and Monaco's ThirdPartyNotices. The Electron bundle also retains the Python runtime's supplied notices and Chromium's third-party notices.

`licenses/upstream/` supplements packages that omit standalone license files and records the upstream sources. Open CASCADE Technology is separately licensed under LGPL-2.1 with the OCCT exception; the credits include its license and exception. The generated inventory documents available notices, not a replacement for complying with each dependency's redistribution and source-availability obligations. Browser-resolved transitive Python/WASM packages can differ from the desktop inventory and remain subject to their upstream licenses.

## App icon

The icon is a screenshot of the original **Puddle the duck** model in `examples/duck.py`, rendered with three-cad-viewer without CAD overlays. `public/icons/duck.png` is the transparent 1024px capture; the smaller PNG, ICO, and ICNS files are derived from it. On macOS, run `npm run icons` to recapture it (requires installed Chrome, uv, and the built-in `sips` / `iconutil` tools). No generated illustration or third-party image is used.

`src/project-store.js` owns atomic project records and the active-project ID. Autosave reports success only after an IndexedDB transaction commits, and revision checks prevent stale tabs from overwriting newer edits. Storage failures keep the current editor contents available for download or ZIP export. `src/project-dialog.js` provides the browser project-folder list and backup exports.
