import {describeChange, validPath} from './tools.js';

const TEXT = /\.(py|json|txt|csv|svg|step|stp|md|toml|yaml|yml|cfg|ini)$/i;
const MAX_WALK = 2000;

// Expose the selected folder, or just the active buffer when no folder is open.
// `host` is the workbench (src/app.js): its build, output, viewer, editor and file operations.
export function agentProject({workspace, documents, filename, preview, desktop, host}) {
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
  const project = {
    relative,
    key(path) {
      if(!validPath(path))throw new Error('Use a project-relative file path.');
      if(!desktop)return path;
      if(workspace()?.root)return diskPath(path);
      if(relative(filename())===path)return filename();
      throw new Error('File outside the active document. Open a workspace folder to work with other files.');
    },
    state: () => {
      const selection = host?.selection?.();
      return {project: workspace()?.name || 'Active file', activeFile: relative(filename()),
        ...(selection ? {editor: selection} : {}),
        unsaved: [...buffers()].filter(([, doc]) => doc.code !== doc.saved || doc.untitled).map(([path]) => path),
        preview: preview()};
    },
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
    /** Every file under `path`, project-relative, at most MAX_WALK. */
    async walk(path = '') {
      if (!(desktop && workspace()?.root)) {
        const prefix = path ? path + '/' : '';
        const files = [...buffers().keys()].filter(key => key.startsWith(prefix)).sort();
        if (path && !files.length) throw new Error('Directory not found.');
        return files.slice(0, MAX_WALK);
      }
      const files = [], folders = [path];
      while (folders.length && files.length < MAX_WALK) {
        const folder = folders.shift();
        for (const entry of await project.list(folder)) {
          const child = folder ? folder + '/' + entry.name : entry.name;
          if (entry.directory) folders.push(child); else files.push(child);
        }
      }
      // Files made in this session and not yet listed by the explorer.
      for (const key of buffers().keys()) if (!files.includes(key) && key.startsWith(path ? path + '/' : '')) files.push(key);
      return files.filter(file => TEXT.test(file) || buffers().has(file)).sort().slice(0, MAX_WALK);
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
    output: (start = 0) => host.output().slice(start),
    async build(path, {save = true} = {}) {
      if (path !== undefined && !/\.py$/i.test(path)) throw new Error('Build a Python file.');
      return host.build(path === undefined ? undefined : project.key(path), {save});
    },
    describe: () => host.describe(),
    screenshot: view => host.screenshot(view),
    picks: limit => host.picks(limit),
    api: args => host.api(args),
    source: args => host.source(args),
    camera: args => host.camera(args),
    /** Apply a change the panel approved, checking the file still holds what the agent read. */
    async apply(change) {
      const now = await project.read(change.path).catch(() => null);
      if (now !== change.source) throw new Error(change.path + ' changed since it was read. Request a fresh edit.');
      if (change.kind === 'delete') return host.remove(project.key(change.path));
      if (change.kind === 'rename') return host.rename(project.key(change.path), change.to);
      return host.write(change.path, change.next);
    },
    /**
     * Apply an MCP client's change at once, outside the built-in agent's review and Undo. On desktop it
     * is saved to disk too, so a file with the user's unsaved edits is refused rather than saved for them.
     */
    async commit(change) {
      if (desktop) for (const path of [change.path, change.to]) {
        const doc = path && documents.get(project.key(path));
        if (doc && doc.code !== doc.saved) throw new Error(path + ' has unsaved changes in Duckbench. Ask the user to save or revert them first.');
      }
      await project.apply(change);
      if (desktop && (change.kind === 'edit' || change.kind === 'write')) await host.save(project.key(change.path));
      return describeChange(change) + ([change.path, change.to].some(path => path?.endsWith('.py')) ? ' Call run_build to check the model builds.' : '');
    },
    /** Put a file back as it was: its text, or gone when it did not exist (for Undo). */
    async restore(path, before) {
      const now = await project.read(path).catch(() => null);
      if (before === null) { if (now !== null) await host.remove(project.key(path)); }
      else if (now !== before) await host.write(path, before);
    },
  };
  return project;
}
