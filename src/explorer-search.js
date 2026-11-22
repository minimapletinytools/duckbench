// Keep the expanded tree intact while a search visits unopened folders.
export function installExplorerSearch({input, tree, entries, listDirectory, fileRow, sync}) {
  const results = document.createElement('div');
  results.className = 'explorer-tree';
  results.setAttribute('role', 'tree');
  results.setAttribute('aria-label', 'Matching files');
  results.hidden = true;
  tree.after(results);
  let revision = 0;
  async function refresh() {
    const version = ++revision;
    const query = input.value.trim().toLowerCase();
    tree.hidden = !!query;
    results.hidden = !query;
    results.replaceChildren();
    if (!query) return;
    const status = document.createElement('div');
    status.className = 'explorer-empty';
    status.setAttribute('role','status');
    status.textContent = 'Searching…';
    results.append(status);
    const queue = [{items: entries(), prefix: ''}];
    let matches = 0, scanned = 0, skipped = 0;
    for (let i = 0; i < queue.length && matches < 150 && scanned < 10000; i++) {
      const folder = queue[i];
      let items;
      try { items = folder.items || await listDirectory(folder.path); }
      catch { skipped++; continue; }
      if (version !== revision) return;
      for (const entry of items) {
        if (++scanned > 10000 || matches >= 150) break;
        const label = folder.prefix + entry.name;
        if (entry.directory) queue.push({items: entry.children, path: entry.path, prefix: label + '/'});
        else if (label.toLowerCase().includes(query)) {
          const row = fileRow({...entry,name:label}, 0);
          results.insertBefore(row, status);
          matches++;
        }
      }
    }
    if (version !== revision) return;
    status.textContent = matches + (matches === 1 ? ' match' : ' matches') +
      (matches >= 150 || scanned >= 10000 ? ' · search limit reached' : '') +
      (skipped ? ' · some folders unavailable' : '');
    sync();
  }
  input.oninput = refresh;
  input.onkeydown = event => {
    if (event.key === 'Escape') { input.value = ''; void refresh(); }
    if (event.key === 'ArrowDown'){event.preventDefault();results.querySelector('.file-row')?.focus();}
    if (event.key === 'Enter') results.querySelector('.file-row')?.click();
  };
  return refresh;
}
