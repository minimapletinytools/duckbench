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
  const get = id => transaction(['projects'], 'readonly', (tx, done) => {
    tx.objectStore('projects').get(id).onsuccess = event => done(event.target.result);
  });
  return {
    get,
    list: () => transaction(['projects'], 'readonly', (tx, done) => {
      tx.objectStore('projects').getAll().onsuccess = event => done(event.target.result.sort((a,b) => b.updated-a.updated));
    }),
    active: () => transaction(['meta'], 'readonly', (tx, done) => {
      tx.objectStore('meta').get('active').onsuccess = event => done(event.target.result);
    }),
    select: id => transaction(['meta'], 'readwrite', tx => tx.objectStore('meta').put(id, 'active')),
    create: (name, files, activeFile = Object.keys(files)[0]) => {
      const now = Date.now();
      const record = {id: crypto.randomUUID(), name: name.trim().slice(0,80) || 'Untitled project', files,
        activeFile, expanded: [], created: now, updated: now, revision: 1};
      return transaction(['projects', 'meta'], 'readwrite', (tx, done) => {
        tx.objectStore('projects').add(record);
        tx.objectStore('meta').put(record.id, 'active');
        done(record);
      });
    },
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
    remove: (id, revision) => transaction(['projects', 'meta'], 'readwrite', (tx, done, fail) => {
      const store = tx.objectStore('projects');
      store.get(id).onsuccess = event => {
        if (event.target.result?.revision !== revision) { fail(new Error('This project changed in another tab. Reopen the project list before deleting it.')); return; }
        store.delete(id);
        const meta = tx.objectStore('meta');
        meta.get('active').onsuccess = event => { if (event.target.result === id) meta.delete('active'); };
        done();
      };
    }),
    close: () => db.close(),
  };
}

// Upgrade only the exact unedited template shipped by early Duckbench versions.
const OLD_EXAMPLE = `from build123d import *

# Dimensions in millimeters.
plate = Box(60, 40, 12)
hole = Cylinder(9, 14)

result = plate - hole
result.label = "Mounting plate"
`;
export function migrateExample(filename, code, duck) {
  return ['example.py','plate.py'].includes(filename) && code.replaceAll('\r\n','\n').trim() === OLD_EXAMPLE.trim() ? duck : code;
}
