import {zipSync, unzipSync, strToU8} from 'fflate';
import {validPath} from './agent/tools.js';

const manifest = 'duckbench-project.json';
export function projectArchive(record) {
  const folder = record.name.replace(/[^\w.-]+/g,'_').replace(/^\.+/,'') || 'project';
  const entries = Object.fromEntries(Object.entries(record.files).map(([name,text])=>[folder+'/'+name,strToU8(text)]));
  for (const [name,bytes] of Object.entries(record.modelFiles || {})) entries[folder+'/'+name] = bytes;
  entries[manifest] = strToU8(JSON.stringify({version:1,folder,name:record.name,activeFile:record.activeFile,runTarget:record.runTarget||null}));
  return {filename:folder+'.zip',bytes:zipSync(entries)};
}
export function restoreArchive(bytes, filename) {
  let total = 0, count = 0;
  const members = unzipSync(bytes,{filter(entry) {
    if (entry.name.endsWith('/')) return false;
    total += entry.originalSize;
    if (++count > 10000 || total > 128*1024*1024) throw new Error('Project ZIP is too large.');
    if (!validPath(entry.name)) throw new Error('Invalid project path.');
    return true;
  }});
  const decoder = new TextDecoder('utf-8',{fatal:true});
  let info;
  if (Object.hasOwn(members,manifest)) {
    info = JSON.parse(decoder.decode(members[manifest]));
    if (info?.version !== 1 || typeof info.name !== 'string' || !validPath(info.folder) || info.folder.includes('/')) throw new Error('Unsupported project manifest.');
    delete members[manifest];
  }
  const names = Object.keys(members);
  if (!names.length && !info) throw new Error('Project ZIP contains no files.');
  const first = names[0]?.split('/')[0];
  const folder = info?.folder ?? (names.every(name=>name.startsWith(first+'/')) ? first : '');
  const files = Object.create(null), modelFiles = Object.create(null);
  for (const name of names) {
    if (folder && !name.startsWith(folder+'/')) throw new Error('File outside the archived project.');
    const relative = folder ? name.slice(folder.length+1) : name;
    if (!validPath(relative) || relative.split('/').some(part=>['__proto__','constructor','prototype'].includes(part))) throw new Error('Invalid project path.');
    if (/\.stl$/i.test(relative)) { modelFiles[relative] = members[name]; continue; }
    const text = decoder.decode(members[name]);
    if (text.includes('\u0000')) throw new Error('Projects support text files only.');
    files[relative] = text;
  }
  const paths = new Set([...Object.keys(files), ...Object.keys(modelFiles)]);
  for (const name of paths) {
    const pieces = name.split('/');
    for (let i = 1; i < pieces.length; i++) {
      if (paths.has(pieces.slice(0,i).join('/'))) throw new Error('A ZIP path is both a file and a folder.');
    }
  }
  const activeFile = typeof info?.activeFile === 'string' && Object.hasOwn(files,info.activeFile) ? info.activeFile : Object.keys(files).find(p=>p.endsWith('.py')) || Object.keys(files)[0];
  return {name:info?.name || folder || filename.replace(/\.zip$/i,''), files, modelFiles, activeFile,
    runTarget:typeof info?.runTarget === 'string' && Object.hasOwn(files,info.runTarget) && info.runTarget.endsWith('.py') ? info.runTarget : null};
}
