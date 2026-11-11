export class PanelShell {
  constructor(root) {
    this.root=root; this.panels=new Map(); this.listeners=new Set(); this.mode='tabs'; this.active=null; this.cleanups=[];
    root.innerHTML=`<div class="shell"><header class="titlebar"><div class="shell-brand"><img class="brand-icon" src="${new URL('icons/duck-64.png',document.baseURI).href}" width="25" height="25" alt="" /><span class="brand-name">Duckbench</span></div><div id="toolbar" class="toolbar"></div><div class="layout-actions"><button id="toggle-explorer" class="layout-toggle is-active" title="Toggle explorer" aria-label="Toggle explorer" aria-pressed="true">◧</button><button id="toggle-console" class="layout-toggle" title="Toggle console" aria-label="Toggle console" aria-pressed="false">▤</button><button id="toggle-split" class="layout-toggle" title="Split views" aria-label="Split views" aria-pressed="false">◫</button></div></header><aside id="left-slot" class="slot slot-left" aria-label="Explorer"></aside><div id="splitter-left" class="splitter" role="separator" aria-label="Resize explorer" aria-orientation="vertical" tabindex="0"></div><main class="main"><section id="center-slot" class="slot-center"><div id="center-tabs" class="tabs-bar" role="tablist" aria-label="Workspace views"></div><div id="center-body" class="center-body"></div></section><div id="splitter-bottom" class="splitter-bottom" role="separator" aria-label="Resize console" aria-orientation="horizontal" tabindex="0" hidden></div><section id="bottom-slot" class="slot slot-bottom" aria-label="Console" hidden></section></main><div id="splitter-right" class="splitter" hidden></div><aside id="right-slot" class="slot slot-right" hidden></aside><footer id="statusbar" class="statusbar"></footer></div>`;
    this.shell=root.querySelector('.shell');
    this.slots=Object.fromEntries(['left','center','right','bottom'].map(s=>[s,root.querySelector(s==='center'?'#center-body':`#${s}-slot`)]));
    this.tabs=root.querySelector('#center-tabs');
    this.centerDivider=document.createElement('div');this.centerDivider.id='splitter-center';this.centerDivider.className='splitter-center';this.centerDivider.hidden=true;this.centerDivider.tabIndex=0;this.centerDivider.setAttribute('role','separator');this.centerDivider.setAttribute('aria-label','Resize editor and preview');this.centerDivider.setAttribute('aria-controls','panel-source panel-preview');this.slots.center.append(this.centerDivider);
    this.addCenterSplitter();
    this.tabGroup=document.createElement('div');this.tabGroup.className='document-tab';this.tabGroup.setAttribute('role','presentation');this.tabs.append(this.tabGroup);
    root.querySelector('#toggle-explorer').onclick=()=>this.toggle('left'); root.querySelector('#toggle-console').onclick=()=>this.toggle('bottom'); root.querySelector('#toggle-split').onclick=()=>this.setMode(this.mode==='tabs'?'split':'tabs');
    try {const saved=JSON.parse(localStorage.getItem('build1234.layout')||'{}'); for(const s of ['left','bottom']) if(Number.isFinite(saved[s])) this.shell.style.setProperty(s==='left'?'--left-width':'--bottom-height',`${Math.max(s==='left'?140:80,Math.min(480,saved[s]))}px`);}catch{}
    this.addSplitter('left');this.addSplitter('bottom');this.observer=new ResizeObserver(()=>this.notify());this.observer.observe(this.shell);
  }
  register({id,title,slot,element}) {
    if(this.panels.has(id))throw new Error(`Duplicate panel: ${id}`);if(!this.slots[slot])throw new Error(`Unknown slot: ${slot}`);
    element.classList.add('shell-panel');element.dataset.panelId=id;element.id||=`panel-${id}`;
    if(slot==='center'&&![...this.panels.values()].some(p=>p.slot==='center'))this.slots.center.insertBefore(element,this.centerDivider);else this.slots[slot].append(element);
    const panel={id,title,slot,element};this.panels.set(id,panel);
    if(slot==='center') {
      const tab=document.createElement('button');tab.className='tab';tab.textContent=title;tab.id=`tab-${id}`;tab.setAttribute('role','tab');tab.setAttribute('aria-controls',element.id);element.setAttribute('role','tabpanel');element.setAttribute('aria-labelledby',tab.id);tab.onclick=()=>this.select(id);
      tab.onkeydown=e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const all=[...this.panels.values()].filter(p=>p.slot==='center');const i=all.findIndex(p=>p.id===id);const n=e.key==='Home'?0:e.key==='End'?all.length-1:(i+(e.key==='ArrowRight'?1:-1)+all.length)%all.length;this.select(all[n].id);all[n].tab.focus();};
      panel.tab=tab;this.tabGroup.append(tab);this.active||=id;
    }
    if(slot==='right'){this.slots.right.hidden=false;this.root.querySelector('#splitter-right').hidden=false;}
    this.update();return panel;
  }
  setTitle(id,title,description=title){const panel=this.panels.get(id);if(!panel)return;panel.title=title;if(panel.tab){panel.tab.textContent=title;panel.tab.title=description;}}
  select(id){if(this.panels.get(id)?.slot!=='center')return;this.mode='tabs';this.activate(id);}
  activate(id){if(this.panels.get(id)?.slot!=='center')return;this.active=id;this.update();}
  toggle(slot){if(!['left','bottom'].includes(slot))return;const hidden=this.slots[slot].hidden=!this.slots[slot].hidden;this.root.querySelector(`#splitter-${slot}`).hidden=hidden;this.shell.classList.toggle(`is-${slot}-hidden`,hidden);const button=this.root.querySelector(slot==='left'?'#toggle-explorer':'#toggle-console');button.classList.toggle('is-active',!hidden);button.setAttribute('aria-pressed',String(!hidden));this.notify();}
  setMode(mode){if(!['tabs','split'].includes(mode))throw new Error(`Unknown mode: ${mode}`);this.mode=mode;this.update();}
  update(){this.centerDivider.hidden=this.mode!=='split';this.tabs.setAttribute('aria-multiselectable',String(this.mode==='split'));this.slots.center.classList.toggle('is-split',this.mode==='split');const button=this.root.querySelector('#toggle-split');button.classList.toggle('is-active',this.mode==='split');button.setAttribute('aria-pressed',String(this.mode==='split'));for(const p of this.panels.values()){if(p.slot!=='center')continue;const active=p.id===this.active;p.element.hidden=this.mode!=='split'&&!active;const visible=this.mode==='split'||active;p.tab.classList.toggle('is-active',visible);p.tab.setAttribute('aria-selected',String(visible));p.tab.tabIndex=active?0:-1;}this.notify();}
  onLayout(callback){this.listeners.add(callback);return()=>this.listeners.delete(callback);}
  notify(){this.centerDivider?.setAttribute('aria-orientation',matchMedia('(max-width:560px)').matches?'horizontal':'vertical');for(const callback of this.listeners)callback({mode:this.mode,active:this.active});}
  addCenterSplitter(){
    let ratio=.5;const divider=this.centerDivider,body=this.slots.center;
    const set=value=>{ratio=Math.max(.15,Math.min(.85,value));body.style.setProperty('--editor-fr',`${ratio}fr`);body.style.setProperty('--preview-fr',`${1-ratio}fr`);divider.setAttribute('aria-valuenow',String(Math.round(ratio*100)));this.notify();};
    const save=()=>{try{localStorage.setItem('duckbench.splitRatio',String(ratio));}catch{}};
    divider.setAttribute('aria-valuemin','15');divider.setAttribute('aria-valuemax','85');
    try{const stored=localStorage.getItem('duckbench.splitRatio');if(stored!==null&&Number.isFinite(Number(stored)))ratio=Number(stored);}catch{}
    set(ratio);
    divider.onpointerdown=event=>{
      if(event.button!==0)return;event.preventDefault();divider.setPointerCapture(event.pointerId);this.shell.classList.add('is-resizing');
      const vertical=matchMedia('(max-width:560px)').matches;
      const move=point=>{const rect=body.getBoundingClientRect();set((vertical?point.clientY-rect.top:point.clientX-rect.left)/(vertical?rect.height:rect.width));};
      const end=()=>{divider.removeEventListener('pointermove',move);divider.removeEventListener('pointerup',end);divider.removeEventListener('pointercancel',end);if(divider.hasPointerCapture(event.pointerId))divider.releasePointerCapture(event.pointerId);this.shell.classList.remove('is-resizing');save();};
      divider.addEventListener('pointermove',move);divider.addEventListener('pointerup',end);divider.addEventListener('pointercancel',end);this.cleanups.push(end);
    };
    divider.onkeydown=event=>{const backward=matchMedia('(max-width:560px)').matches?'ArrowUp':'ArrowLeft',forward=matchMedia('(max-width:560px)').matches?'ArrowDown':'ArrowRight';if(![backward,forward,'Home','End'].includes(event.key))return;event.preventDefault();set(event.key==='Home'?.15:event.key==='End'?.85:ratio+(event.key===backward?-.02:.02));save();};
    divider.ondblclick=()=>{set(.5);save();};
  }
  addSplitter(slot){
    const el=this.root.querySelector(`#splitter-${slot}`),prop=slot==='left'?'--left-width':'--bottom-height';
    const size=()=>this.slots[slot].getBoundingClientRect()[slot==='left'?'width':'height'];
    const set=n=>{const max=slot==='left'?Math.max(140,this.shell.clientWidth-300):Math.max(80,this.shell.clientHeight-220);this.shell.style.setProperty(prop,`${Math.max(slot==='left'?140:80,Math.min(max,n))}px`);this.notify();};
    const save=()=>{try{const prefs={};for(const s of ['left','bottom'])prefs[s]=parseFloat(getComputedStyle(this.shell).getPropertyValue(s==='left'?'--left-width':'--bottom-height'));localStorage.setItem('build1234.layout',JSON.stringify(prefs));}catch{}};
    el.onpointerdown=e=>{if(e.button!==0)return;e.preventDefault();const start=slot==='left'?e.clientX:e.clientY,initial=size();el.setPointerCapture(e.pointerId);this.shell.classList.add('is-resizing');const move=n=>set(initial+(slot==='left'?n.clientX-start:start-n.clientY));const end=()=>{el.removeEventListener('pointermove',move);el.removeEventListener('pointerup',end);el.removeEventListener('pointercancel',end);this.shell.classList.remove('is-resizing');save();};el.addEventListener('pointermove',move);el.addEventListener('pointerup',end);el.addEventListener('pointercancel',end);this.cleanups.push(end);};
    el.onkeydown=e=>{const keys=slot==='left'?['ArrowLeft','ArrowRight']:['ArrowDown','ArrowUp'];if(!keys.includes(e.key))return;e.preventDefault();set(size()+(e.key===keys[0]?-10:10));save();};
  }
  dispose(){this.observer.disconnect();for(const cleanup of this.cleanups)cleanup();this.listeners.clear();this.panels.clear();this.root.replaceChildren();}
}
