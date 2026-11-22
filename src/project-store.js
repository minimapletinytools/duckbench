import OLD_DUCK from './legacy/duck-v1.py?raw';

/** Browser project files and the last open project, committed atomically in IndexedDB. */
export async function openProjectStore() {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('duckbench-projects', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('projects', {keyPath: 'id'});
      request.result.createObjectStore('meta');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Close other Duckbench tabs to open browser storage.'));
  });
  db.onversionchange = () => db.close();
  function transaction(stores, mode, work) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(stores, mode);
      let result, failure;
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () => reject(failure || tx.error || new Error('Browser storage could not save this project.'));
      try { work(tx, value => { result = value; }, error => { failure = error; tx.abort(); }); }
      catch (error) { failure = error; tx.abort(); }
    });
  }
  return {
    list: () => transaction(['projects'], 'readonly', (tx, done) => {
      tx.objectStore('projects').getAll().onsuccess = event => done(event.target.result);
    }),
    // Claim the previous active project once. The transaction also serializes first visits in two tabs.
    defaultProject: (files, activeFile, duck) => transaction(['projects','meta'],'readwrite',(tx,done)=>{
      const projects=tx.objectStore('projects'),meta=tx.objectStore('meta');
      const preferred=meta.get('defaultProject'),active=meta.get('active');
      active.onsuccess=()=>{
        const id=preferred.result || active.result;
        function claim(previous){
          const now=Date.now();
          const record=previous || {id:crypto.randomUUID(),files,activeFile,created:now,updated:now,revision:0};
          let changed=record.name!=='Default Project';
          for(const path of starterPaths){
            if(!Object.hasOwn(record.files,path))continue;
            const source=migrateExample(path,record.files[path],duck);
            if(source!==record.files[path]){
              record.files[path]=source;
              changed=true;
            }
          }
          if(changed){
            record.name='Default Project';record.revision++;projects.put(record);
          }
          meta.put(record.id,'defaultProject');meta.put(record.id,'active');done(record);
        }
        function fallback(){projects.openCursor().onsuccess=e=>claim(e.target.result?.value);}
        if(id)projects.get(id).onsuccess=e=>e.target.result?claim(e.target.result):fallback();
        else fallback();
      };
    }),
    save: record => transaction(['projects'], 'readwrite', (tx, done, fail) => {
      const store = tx.objectStore('projects');
      store.get(record.id).onsuccess = event => {
        const previous = event.target.result;
        if (!previous || previous.revision !== record.revision) {
          fail(new Error('This project changed in another tab. Export your current project as a ZIP before reloading.'));
          return;
        }
        const updated = {...record, revision: record.revision+1, updated: Date.now()};
        try { store.put(updated); done(updated); } catch (error) { fail(error); }
      };
    }),
    close: () => db.close(),
  };
}

const starterPaths = ['duck.py', 'example.py', 'plate.py'];
const OLD_EXAMPLE = `from build123d import *

# Dimensions in millimeters.
plate = Box(60, 40, 12)
hole = Cylinder(9, 14)

result = plate - hole
result.label = "Mounting plate"
`;
export function migrateExample(filename, code, duck) {
  if (!starterPaths.includes(filename)) return code;
  const normalized = code.replaceAll('\r\n', '\n');
  if (normalized === OLD_DUCK) return duck;
  return filename !== 'duck.py' && normalized.trim() === OLD_EXAMPLE.trim() ? duck : code;
}
