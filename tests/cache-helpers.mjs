export async function waitForCache(page){
 await page.waitForFunction(()=>document.querySelector('#cache-status')?.textContent==='Saved to browser cache');
}
export async function readCache(page){
 return page.evaluate(async()=>{
  const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('duckbench-projects',1);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  try{return await new Promise((resolve,reject)=>{const tx=db.transaction(['projects','meta']);const records=tx.objectStore('projects').getAll(),active=tx.objectStore('meta').get('active');tx.oncomplete=()=>resolve({projects:records.result,active:active.result});tx.onerror=()=>reject(tx.error);});}finally{db.close();}
 });
}
export async function cachedCode(page){await waitForCache(page);const {projects,active}=await readCache(page);const project=projects.find(record=>record.id===active);return project.files[project.activeFile];}
