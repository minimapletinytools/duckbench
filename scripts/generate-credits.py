"""Collect installed dependency notices and generate the offline About page."""
from html import escape
from importlib.metadata import distributions
import json
from pathlib import Path
import re
import shutil
import sys

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public' / 'licenses'
OUT.mkdir(parents=True, exist_ok=True)
package = json.loads((ROOT / 'package.json').read_text())
entries = []


def notice_file(path):
    return bool(re.match(r'^(licen[cs]e|copying|notice|thirdpartynotices|copyright)', path.name, re.I))


def add(name, version, license_name, files, url='', category='JavaScript'):
    notices = []
    slug = re.sub(r'[^a-zA-Z0-9._-]', '-', name)
    for index, path in enumerate(dict.fromkeys(files)):
        if not path.is_file():
            raise FileNotFoundError(path)
        text = path.read_text(errors='replace')
        destination = f'{slug}-{index}-{path.name}'
        shutil.copyfile(path, OUT / destination)
        notices.append({'name': path.name, 'file': destination, 'text': text})
    entries.append(dict(name=name, version=version, license=license_name,
                        url=url, category=category, notices=notices))


# Include the runtime JavaScript dependency closure, with Electron's own notices.
seen = set()

def javascript(name, parent=ROOT):
    candidate = parent
    while True:
        folder = candidate / 'node_modules' / name
        if (folder / 'package.json').is_file():
            break
        if candidate == candidate.parent:
            raise FileNotFoundError(f'Missing installed dependency: {name}')
        candidate = candidate.parent
    if folder in seen:
        return
    seen.add(folder)
    meta = json.loads((folder / 'package.json').read_text())
    repository = meta.get('repository', {})
    url = repository.get('url', '') if isinstance(repository, dict) else repository
    url = url.removeprefix('git+').removesuffix('.git')
    if not url.startswith('https://'):
        url = ''
    files = [p for p in folder.iterdir() if p.is_file() and notice_file(p)]
    add(name, meta['version'], str(meta.get('license', 'See upstream notices')), files, url)
    if name != 'electron':
        for dependency in meta.get('dependencies', {}):
            javascript(dependency, folder)

for name in package['dependencies']:
    javascript(name)
javascript('electron')
chromium = ROOT / 'node_modules/electron/dist/LICENSES.chromium.html'
if chromium.exists():
    shutil.copyfile(chromium, OUT / 'Electron-Chromium-notices.html')

for dist in sorted(distributions(), key=lambda d: d.metadata['Name'].lower()):
    name = dist.metadata['Name']
    files = [Path(dist.locate_file(f)) for f in (dist.files or []) if notice_file(Path(f))]
    label = dist.metadata.get('License-Expression') or dist.metadata.get('License') or 'See upstream notices'
    if len(label) > 150:
        label = 'See upstream notices'
    url = dist.metadata.get('Home-page', '')
    if not url.startswith('https://'):
        url = ''
    if name.lower().startswith('cadquery-ocp') and not files:
        files = [ROOT / 'licenses/upstream/OCP-LICENSE.txt']
    add(name, dist.version, label, files, url, 'Desktop Python')

python_license = Path(sys.base_prefix) / 'lib' / f'python{sys.version_info.major}.{sys.version_info.minor}' / 'LICENSE.txt'
if python_license.exists():
    add('Python', sys.version.split()[0], 'PSF License and included notices', [python_license], 'https://www.python.org', 'Runtime')
add('Open CASCADE Technology', '8.0.1 (desktop)', 'LGPL-2.1 with OCCT exception',
    [ROOT / 'licenses/upstream/OCCT-LICENSE.txt', ROOT / 'licenses/upstream/OCCT-EXCEPTION.txt'],
    'https://github.com/Open-Cascade-SAS/OCCT/tree/V8_0_1', 'CAD kernel')
add('Pyodide', '314.0.7', 'MPL-2.0 and included notices', [ROOT / 'licenses/upstream/Pyodide-LICENSE.txt'], 'https://github.com/pyodide/pyodide', 'Browser runtime')
bootstrap = json.loads((ROOT / 'public/ocp-bootstrap-source.json').read_text())
add('OCP.wasm bootstrap', bootstrap['commit'][:12], 'MIT', [ROOT / 'public/OCP-wasm-LICENSE.txt'], 'https://github.com/yeicor/OCP.wasm', 'Browser runtime')
add('Duckbench', package['version'], 'Apache-2.0', [ROOT / 'LICENSE', ROOT / 'NOTICE'], category='Application')

(OUT / 'inventory.json').write_text(json.dumps([{k:v for k,v in e.items() if k!='notices'} | {'notices':[{k:v for k,v in n.items() if k!='text'} for n in e['notices']]} for e in entries], indent=2)+'\n')

html = '''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>About Duckbench</title>
<style>
:root{color-scheme:light dark;font:14px/1.6 system-ui,sans-serif;color:#3b3b3b;background:#fff}body{margin:0;padding:32px;max-width:900px;margin-inline:auto}h1{font-size:28px;letter-spacing:-.6px;margin:0}h2{font-size:18px;margin-top:30px}p{max-width:75ch}a{color:#005fb8}small,.muted{color:#717171}.version{font-weight:400;font-size:14px;margin-left:10px}table{border-collapse:collapse;width:100%}td,th{text-align:left;vertical-align:top;padding:10px 8px;border-bottom:1px solid #ddd}th{font-size:12px}details{border-bottom:1px solid #ddd;padding:12px 0}summary{cursor:pointer;font-weight:600}details details{margin-left:16px}pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:360px;overflow:auto;background:#f8f8f8;padding:16px;font:11px/1.6 ui-monospace,monospace}summary:focus-visible,a:focus-visible{outline:2px solid #005fb8;outline-offset:3px}@media(prefers-color-scheme:dark){:root{color:#ccc;background:#1f1f1f}a{color:#75beff}small,.muted{color:#aaa}td,th,details{border-color:#444}pre{background:#181818}}
</style></head><body>'''
html += f'<h1>Duckbench <span class="version">{escape(package["version"])}</span></h1><p>A local Python CAD workbench for desktop and browser.</p>'
html += '<h2>Application license</h2><p>Original Duckbench code is licensed under <strong>Apache License 2.0</strong>. You may use, modify and distribute it, including commercially, subject to the license terms. Third-party components keep their own licenses. This application license does not impose a license on models you create.</p>'
html += '<h2>Built with open source</h2><p>CAD visualization is powered by <strong>three-cad-viewer by Bernhard Walter</strong>, the viewer component used by OCP CAD Viewer. Thank you to the authors and contributors whose work makes this app possible.</p>'
credits = [
 ('three-cad-viewer','Bernhard Walter','3D viewer, toolbar, model tree and inspection tools','https://github.com/bernhard-42/three-cad-viewer'),
 ('ocp-tessellate','Bernhard Walter','CAD tessellation and scene conversion','https://github.com/bernhard-42/ocp-tessellate'),
 ('build123d','The build123d Contributors','Parametric modeling in Python','https://github.com/gumyr/build123d'),
 ('Monaco Editor','Microsoft and contributors','Code editor','https://github.com/microsoft/monaco-editor'),
 ('Three.js','Three.js authors','WebGL rendering','https://github.com/mrdoob/three.js'),
 ('OCP.wasm','Yeicor and contributors','Browser CAD kernel integration','https://github.com/yeicor/OCP.wasm'),
 ('Pyodide','Pyodide contributors','Python in the browser','https://github.com/pyodide/pyodide'),
 ('Open CASCADE Technology / OCP','Open Cascade and CadQuery contributors','Geometry kernel and Python bindings','https://github.com/CadQuery/OCP'),
 ('Electron','Electron contributors','Desktop application runtime','https://github.com/electron/electron')]
html += '<table><thead><tr><th>Project</th><th>Contributors</th><th>Used for</th></tr></thead><tbody>'
for name, author, purpose, url in credits:
    html += f'<tr><td><a href="{url}" target="_blank" rel="noopener noreferrer">{escape(name)}</a></td><td>{escape(author)}</td><td>{escape(purpose)}</td></tr>'
html += '</tbody></table><p class="muted">The workbench layout follows Kigumi’s panel conventions. Upstream project names identify dependencies and do not imply endorsement.</p>'
html += '<h2>Licenses and notices</h2><p>Expand a component to read the license texts and notices supplied with it. Python package versions below describe the desktop environment used for this build; browser packages may resolve to different versions.</p>'
html += '<p><a href="licenses/inventory.json" download>Download the dependency inventory</a> · <a href="licenses/Electron-Chromium-notices.html">Electron / Chromium third-party notices</a></p>'
for entry in sorted(entries, key=lambda e: (e['name']!='Duckbench',e['name'].lower())):
    html += f'<details data-component="{escape(entry["name"], quote=True)}"><summary>{escape(entry["name"])} · {escape(entry["version"])}</summary><p>{escape(entry["license"])} <small>({escape(entry["category"])})</small></p>'
    if entry['url']:
        html += f'<p><a href="{escape(entry["url"], quote=True)}" target="_blank" rel="noopener noreferrer">Project / upstream source</a></p>'
    if not entry['notices']:
        html += '<p>The installed package did not supply a standalone notice file. Refer to its upstream distribution for the applicable terms.</p>'
    for notice in entry['notices']:
        html += f'<details><summary>{escape(notice["name"])}</summary><pre>{escape(notice["text"])}</pre><a href="licenses/{escape(notice["file"], quote=True)}" download>Download this notice</a></details>'
    html += '</details>'
html += '</body></html>'
(ROOT / 'public/about.html').write_text(html)
print(f'Generated About page and notices for {len(entries)} components.')
