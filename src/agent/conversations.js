// Keep local transcripts outside the project files and scope them to a project and account.
export function conversations(account, project) {
  const prefix = 'duckbench.chat.' + JSON.stringify([account,project]) + '.';
  const active = prefix+'active';
  function read(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
  }
  function list() {
    return Object.keys(localStorage).filter(key=>key.startsWith(prefix+'thread.')).map(read)
      .filter(record=>record?.id).sort((a,b)=>b.updated-a.updated);
  }
  function fresh() { return {id:crypto.randomUUID(),history:[],transcript:[],draft:'',model:'',updated:Date.now()}; }
  return {
    list, fresh,
    load(id=localStorage.getItem(active)) {return read(prefix+'thread.'+id)||fresh();},
    save(record) {
      if(!record.transcript.length&&!record.draft&&!record.model)return;
      record.updated=Date.now();
      localStorage.setItem(prefix+'thread.'+record.id,JSON.stringify(record));
      localStorage.setItem(active,record.id);
    },
  };
}
