export function bindTreeKeyboard(root) {
  root.addEventListener('keydown',event=>{
    const row=event.target.closest('.file-row,summary');
    if(!row || !['ArrowDown','ArrowUp','ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    const rows=[...root.querySelectorAll('.file-row,summary')].filter(node=>node.getClientRects().length);
    const i=rows.indexOf(row);
    event.preventDefault();
    if(event.key==='ArrowRight' && row.matches('summary')) {
      if(row.parentElement.open) rows[i+1]?.focus(); else row.parentElement.open=true;
    } else if(event.key==='ArrowLeft'){
      if(row.matches('summary')&&row.parentElement.open)row.parentElement.open=false;
      else row.parentElement.closest('[role=group]')?.parentElement.querySelector('summary')?.focus();
    } else {
      const index={Home:0,End:rows.length-1,ArrowDown:i+1,ArrowUp:i-1}[event.key];
      if(index!==undefined)rows[Math.max(0,Math.min(index,rows.length-1))]?.focus();
    }
  });
}

export function requestFilename(initial,label="New file name") {
  const dialog=document.createElement('dialog');
  dialog.className='file-dialog';
  dialog.innerHTML='<form method="dialog"><label>New file name <input required autocomplete="off"></label><button value="create" class="primary">Create</button><button value="cancel" formnovalidate>Cancel</button></form>';
  dialog.querySelector('label').firstChild.textContent=label+' ';
  const input=dialog.querySelector('input');input.value=initial;
  document.body.append(dialog);dialog.showModal();input.select();
  return new Promise(resolve=>dialog.addEventListener('close',()=>{
    const value=dialog.returnValue==='create'?input.value.trim():null;
    dialog.remove();resolve(value);
  },{once:true}));
}
