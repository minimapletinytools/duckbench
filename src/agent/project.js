import {validPath} from './tools.js';

// Expose the selected folder, or just the active buffer when no folder is open.
export function agentProject({workspace, documents, filename, preview, desktop}) {
  const normalize = path => path.replaceAll('\\', '/');
  function relative(path) {
    if (!desktop) return path;
    const folder = workspace()?.root;
    if (!folder) return path === filename() ? normalize(path).split('/').pop() : null;
    const prefix = normalize(folder).replace(/\/$/, '') + '/';
    if (!normalize(path).startsWith(prefix)) return null;
    const relativePath = normalize(path).slice(prefix.length);
    return relativePath.split('/').some(part => part.startsWith('.') || part === 'node_modules' || part === 'release') ? null : relativePath;
  }
  function buffers() {
    return new Map([...documents].map(([path, doc]) => [relative(path), doc]).filter(([path]) => validPath(path)));
  }
  function diskPath(path) {
    const root=workspace().root;return path?root+(root.includes('\\')?'\\':'/')+(root.includes('\\')?path.replaceAll('/','\\'):path):root;
  }
  return {
    relative,
    key(path) {
      if(!validPath(path))throw new Error('Use a project-relative file path.');
      if(!desktop)return path;
      if(workspace()?.root)return diskPath(path);
      if(relative(filename())===path)return filename();
      throw new Error('File outside the active document.');
    },
    state: () => ({project: workspace()?.name || 'Active file', activeFile: relative(filename()), preview: preview()}),
    async list(path) {
      if (desktop && workspace()?.root) {
        const entries = await desktop.listFiles(diskPath(path));
        return entries.map(entry => ({name: entry.name, directory: entry.directory}));
      }
      const prefix = path ? path + '/' : '';
      const entries = new Map();
      for (const key of buffers().keys()) {
        if (!key.startsWith(prefix)) continue;
        const [name, child] = key.slice(prefix.length).split('/');
        entries.set(name, {name, directory: child !== undefined});
      }
      if (path && !entries.size) throw new Error('Directory not found.');
      return [...entries.values()].sort((a,b) => Number(b.directory)-Number(a.directory) || a.name.localeCompare(b.name));
    },
    async read(path) {
      const doc = buffers().get(path);
      if (desktop && workspace()?.root) {
        const key = diskPath(path);
        if (doc && (key === filename() || doc.code !== doc.saved)) return doc.code;
        const source = await desktop.readProjectText(key);
        if (doc && documents.get(key) === doc && key !== filename() && doc.code === doc.saved) {
          doc.code = doc.saved = source;
        }
        return doc?.code ?? source;
      }
      if (doc) return doc.code;
      throw new Error('File not found in this project.');
    },
  };
}
