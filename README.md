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

`npm run build` creates `dist/`, which can be served by any static HTTP(S) host, including under a subdirectory. `npm run preview` serves the production build locally. The browser loads Pyodide and CAD packages over the network on first run; it does not submit modeling code to a CAD server. Browser editing is saved in localStorage. Open Folder imports a browser project (Python and common text/CAD data files), preserving paths for sibling imports. Browser Save downloads the active file and updates the in-memory project; reopening the folder is needed after a page reload. Desktop Open Folder browses files directly from disk.

`npm run package` stages the current platform's managed Python interpreter and its dependencies, then builds an Electron application in `release/app/`. Package on each target OS/architecture. A macOS arm64 application is the currently tested target. Local builds are unsigned (`build.mac.identity` is null). Configure signing explicitly for distribution. Distribution installers, notarization, auto-update, and other-platform packaging are follow-up work. `BUILD1234_PYTHON` can override the desktop Python executable.

## Implementation plan and current scope

1. **Shared execution contract — implemented.** `python/runner.py` executes source with `__name__ == '__main__'`, a meaningful filename, and fresh script globals. `result` must be a build123d Shape or completed BuildPart/BuildSketch/BuildLine. Use `Compound(children=[...])` for assemblies. Missing/invalid results produce explicit errors. Desktop sibling imports run relative to the selected file; previously loaded project modules are invalidated on rerun.
2. **Geometry adapter — implemented.** `ocp-tessellate` supplies scene hierarchy, triangles, CAD edges, and face/edge metadata to `three-cad-viewer`. The runner retains the last successful CAD shape for STEP/STL export. Render failures and script errors preserve the last successful viewport. Cancellation destroys the runner and requires rebuilding before export.
3. **Host transports — implemented.** Electron owns a persistent native Python subprocess, communicating via JSON lines. Python and native stdout are routed to the log separately from the protocol. The web host runs the same adapter in a Pyodide worker with OCP.wasm, using worker messages. Both can be terminated to cancel a stuck build.
4. **Workbench — implemented.** Kigumi-style panel shell with a resizable left explorer, central Code / 3D Preview tabs, optional split view, and collapsible Output panel. Monaco provides Python syntax highlighting, editing, undo, and keyboard navigation. The right panel slot is reserved for a future agent; no agent UI is implemented. Also includes open/save, model tree, orbit/pan/zoom, viewer inspection controls, logs/errors, STEP/STL export, and keyboard shortcuts. Desktop watches the selected file for external edits, refreshing when there are no unsaved editor changes. Switching files retains their unsaved text in the current session. The preview fills the available center pane and resizes with the window and panel layout.
5. **Validation and packaging — implemented for macOS arm64 and Chrome.** Native contract tests, actual browser execution/render/export/error/cancel checks, desktop render/export smoke, and production static build. See commands below.
6. **Next increments.** Persistent browser project storage, dependency-file watching on desktop, exact kernel-backed measurement requests, font parity tests, explicit cross-runtime geometry parity tests, browser dependency lock/vendor cache, resource limits, multi-platform release CI and installers.

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
# In another terminal: npm run preview
TEST_URL=http://127.0.0.1:4173 npm run test:browser
```

The browser smoke uses installed Chrome through Playwright; set `TEST_BROWSER_CHANNEL` for another installed Chromium channel. Screenshots are written to `test-artifacts/`.

## Panel architecture

`src/panels.js` owns registration, layout, active tabs and split mode. Panels register an element in `left`, `center`, `right`, or `bottom` and receive layout notifications; a right-side registration reveals the reserved slot. `src/editor.js` owns Monaco and its bundled worker. `src/cad-panel.js` owns the CAD viewer and measures its available area, subtracting the embedded toolbar and tree before sizing the canvas. `src/app.js` coordinates document state, explorer actions, execution and exports. Electron filesystem access is exposed through the narrow preload bridge.

Use the titlebar controls to hide the explorer, show Output, or split Code and 3D Preview. Drag the explorer divider or Output divider to resize them. Ctrl/Cmd+Enter builds the model; Ctrl/Cmd+S saves the source.

## License and credits

Original Duckbench code is licensed under **Apache-2.0**; see [LICENSE](LICENSE) and [NOTICE](NOTICE). This matches build123d and ocp-tessellate and permits use alongside the MIT-licensed three-cad-viewer while retaining its notices. Third-party dependencies keep their own licenses; the application license does not relicense them or impose a license on models created with the app.

The **About** button opens an offline page with upstream credits, full license texts, and notices. `npm run credits` regenerates `public/about.html` and `public/licenses/` from the installed JavaScript and Python packages. It runs automatically before development and production builds. Both the static web build and Electron package include these files, including build123d's NOTICE and Monaco's ThirdPartyNotices. The Electron bundle also retains the Python runtime's supplied notices and Chromium's third-party notices.

`licenses/upstream/` supplements packages that omit standalone license files and records the upstream sources. Open CASCADE Technology is separately licensed under LGPL-2.1 with the OCCT exception; the credits include its license and exception. The generated inventory documents available notices, not a replacement for complying with each dependency's redistribution and source-availability obligations. Browser-resolved transitive Python/WASM packages can differ from the desktop inventory and remain subject to their upstream licenses.
