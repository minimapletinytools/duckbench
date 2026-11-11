import {zipSync, strToU8} from 'fflate';

export function exportProject(record) {
  const folder = record.name.replace(/[^\w.-]+/g,'_').replace(/^\.+/,'') || 'project';
  const entries = Object.fromEntries(Object.entries(record.files).map(([name, text]) => [`${folder}/${name}`, strToU8(text)]));
  const url = URL.createObjectURL(new Blob([zipSync(entries)], {type:'application/zip'}));
  const link = document.createElement('a'); link.href = url; link.download = `${folder}.zip`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function createProjectDialog({list, current, create, open, remove, snapshot}) {
  const dialog = document.createElement('dialog');
  dialog.id = 'projects-dialog'; dialog.className = 'projects-dialog';
  dialog.setAttribute('aria-labelledby','projects-title');
  dialog.innerHTML = '<header><h2 id="projects-title">Project folders</h2><button id="close-projects" aria-label="Close projects">Close</button></header><p class="cache-explanation">Projects are saved in this browser’s cache, not to disk or the cloud. Clearing site data removes them. Export a ZIP to keep a backup.</p><form id="new-project-form"><input id="project-name" aria-label="New project name" placeholder="New project name" maxlength="80" required><button class="primary">New project</button></form><div id="project-list"></div><p id="project-error" role="alert" hidden></p>';
  document.body.append(dialog);
  const rows = dialog.querySelector('#project-list');
  const error = dialog.querySelector('#project-error');
  let working=false;
  async function act(action) {
    if(working)return;
    working=true;error.hidden=true;
    for(const button of dialog.querySelectorAll('button,input'))button.disabled=true;
    try{await action();}catch(reason){error.textContent=reason.message||String(reason);error.hidden=false;}
    finally{working=false;for(const button of dialog.querySelectorAll('button,input'))button.disabled=false;}
  }
  async function render() {
    const projects=await list();
    rows.replaceChildren();
    for(const record of projects){
      const row=document.createElement('div');row.className='project-row';row.dataset.projectId=record.id;
      const info=document.createElement('div');info.className='project-info';
      const title=document.createElement('strong');title.textContent=record.name;
      const details=document.createElement('small');const count=Object.keys(record.files).length;
      details.textContent=`${count} file${count===1?'':'s'}${record.id===current()?' · Open':''}`;
      info.append(title,details);
      const openButton=document.createElement('button');openButton.textContent='Open';openButton.onclick=()=>act(async()=>{await open(record.id);dialog.close();});
      const exportButton=document.createElement('button');exportButton.textContent='Export ZIP';exportButton.onclick=()=>act(()=>exportProject(record.id===current()?snapshot():record));
      const deleteButton=document.createElement('button');deleteButton.textContent='Delete…';
      deleteButton.onclick=()=>{
        const confirm=document.createElement('div');confirm.className='project-delete-confirm';
        const message=document.createElement('p');message.textContent=`Delete “${record.name}” from this browser? Export a ZIP first if you want a backup.`;
        const cancel=document.createElement('button');cancel.textContent='Cancel';cancel.onclick=()=>confirm.remove();
        const yes=document.createElement('button');yes.textContent='Delete project';yes.onclick=()=>act(async()=>{await remove(record);await render();});
        confirm.append(message,cancel,yes);row.querySelector('.project-delete-confirm')?.remove();row.append(confirm);cancel.focus();
      };
      row.append(info,openButton,exportButton,deleteButton);rows.append(row);
    }
  }
  dialog.querySelector('#close-projects').onclick=()=>dialog.close();
  dialog.addEventListener('cancel',event=>{if(working)event.preventDefault();});
  dialog.addEventListener('close',()=>document.querySelector('#projects')?.focus());
  dialog.querySelector('form').onsubmit=event=>{
    event.preventDefault();const input=dialog.querySelector('input');
    if(!input.value.trim())return;
    void act(async()=>{await create(input.value.trim());input.value='';dialog.close();});
  };
  return {show:async()=>{dialog.showModal();await act(render);},dispose:()=>dialog.remove()};
}
