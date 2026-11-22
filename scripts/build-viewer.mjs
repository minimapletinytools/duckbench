import {build} from 'vite';
import {createHash} from 'node:crypto';
import {mkdir,writeFile,readFile} from 'node:fs/promises';

const output = await build({configFile:false, publicDir:false, logLevel:'warn', build:{
  write:false, target:'es2022', lib:{entry:'src/standalone/viewer.js',name:'DuckbenchViewer',formats:['iife']},
}});
const parts = output[0].output;
const script = parts.find(item => item.type === 'chunk').code.replace(/<\/script/gi, '<\\/script');
const css = parts.find(item => item.fileName.endsWith('.css')).source;
const policy = 'sha256-' + createHash('sha256').update(script).digest('base64');
const licenseFiles = ['LICENSE','NOTICE','node_modules/three-cad-viewer/LICENSE','node_modules/three/LICENSE',
  'node_modules/postprocessing/LICENSE.md','node_modules/n8ao/LICENSE'];
const notices = Object.fromEntries(await Promise.all(licenseFiles.map(async file => [file,await readFile(file,'utf8')])));
const assets = {css,script,policy,notices};
await mkdir('public/standalone',{recursive:true});
await writeFile('public/standalone/renderer.json',JSON.stringify(assets));
// Existing bookmarks to the empty viewer open the project library. Exported scenes stay self-contained.
await writeFile('public/standalone/viewer.html','<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=../viewer/"><title>Duckbench Viewer</title><a href="../viewer/">Open Duckbench Viewer</a>');
