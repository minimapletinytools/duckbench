/** A keyboard-accessible context menu and confirmation shared by both hosts. */
export function createFileActions({isDiskFile, removeFile, onError}) {
  const menu = document.createElement('div');
  menu.id = 'file-context-menu';
  menu.className = 'file-context-menu';
  menu.setAttribute('role', 'menu');
  menu.hidden = true;
  menu.innerHTML = '<button role="menuitem">Delete file…</button>';
  const dialog = document.createElement('dialog');
  dialog.id = 'delete-file-dialog';
  dialog.className = 'file-dialog';
  dialog.setAttribute('aria-labelledby', 'delete-file-title');
  dialog.setAttribute('aria-describedby', 'delete-file-description');
  dialog.innerHTML = '<h2 id="delete-file-title"></h2><p id="delete-file-description"></p><form method="dialog"><button value="cancel" autofocus>Cancel</button><button value="delete" class="primary" id="confirm-delete">Delete</button></form>';
  document.body.append(menu, dialog);
  let selected, sourceRow;
  function closeMenu(restore = false) {
    menu.hidden = true;
    if (restore && sourceRow?.isConnected) sourceRow.focus();
  }
  menu.querySelector('button').onclick = () => {
    closeMenu();
    const disk = isDiskFile(selected.path);
    dialog.querySelector('h2').textContent = `Delete “${selected.name}”?`;
    dialog.querySelector('p').textContent = disk
      ? 'This file will be moved to Trash. Any unsaved edits in the editor will be discarded.'
      : 'This removes the file and any unsaved edits from this workspace. Your original file on disk will not be changed.';
    dialog.querySelector('#confirm-delete').textContent = disk ? 'Move to Trash' : 'Delete';
    dialog.returnValue = 'cancel';
    dialog.showModal();
  };
  dialog.addEventListener('close', async () => {
    if (dialog.returnValue !== 'delete') { closeMenu(true); return; }
    const target = selected;
    try { await removeFile(target.path); }
    catch (error) { onError(error); }
    finally { document.querySelector('.file-row.selected')?.focus(); }
  });
  const outside = event => { if (!menu.contains(event.target)) closeMenu(); };
  const keyboard = event => {
    if (menu.hidden) return;
    if (event.key === 'Escape' || event.key === 'Tab') closeMenu(true);
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); }
  };
  document.addEventListener('pointerdown', outside);
  document.addEventListener('keydown', keyboard, true);
  window.addEventListener('resize', closeMenu);
  return {
    bind(row, entry) {
      const open = event => {
        event.preventDefault();
        selected = entry; sourceRow = row;
        menu.hidden = false;
        const bounds = row.getBoundingClientRect();
        const x = event.type === 'contextmenu' && event.clientX ? event.clientX : bounds.left + 20;
        const y = event.type === 'contextmenu' && event.clientY ? event.clientY : bounds.bottom;
        menu.style.left = `${Math.max(0, Math.min(x, innerWidth - menu.offsetWidth - 8))}px`;
        menu.style.top = `${Math.max(0, Math.min(y, innerHeight - menu.offsetHeight - 8))}px`;
        menu.querySelector('button').focus();
      };
      row.addEventListener('contextmenu', open);
      row.addEventListener('keydown', event => {
        if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) open(event);
      });
    },
    dispose() {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', keyboard, true);
      window.removeEventListener('resize', closeMenu);
      menu.remove(); dialog.remove();
    },
  };
}
