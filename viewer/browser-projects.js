import {openProjectStore} from '../src/project-store.js';
import {createRuntime} from '../src/runtime.js';

export function browserProjects(status) {
  const db=openProjectStore();
  let runtime;
  async function read(name,data) {
    if(/\.html$/i.test(name)){
      // Parse only the exported JSON, never navigate to or execute the imported document.
      const match=data.match(/<script type="application\/json" id="duckbench-scene">([\s\S]*?)<\/script>/);
      if(!match)throw new Error('Select an HTML viewer exported from Duckbench.');
      return {model:JSON.parse(match[1])};
    }
    if(/\.(stl|stp|step)$/i.test(name)){
      runtime??=await createRuntime({onStatus:status});
      const bytes=typeof data==='string'?new TextEncoder().encode(data):data;
      return {model:await runtime.importCad(name,bytes)};
    }
    return {source:data};
  }
  return {
    list:async()=>(await db).list(),
    open:async id=>{const record=await (await db).get(id);if(!record)throw new Error('Project was removed.');return record;},
    create:async(name,files,modelFiles,meta)=>(await db).create(name,files,meta.activeFile,meta.runTarget,modelFiles),
    async add(record,files,modelFiles){
      return (await db).save({...record,files:{...record.files,...files},modelFiles:{...record.modelFiles,...modelFiles}});
    },
    remove:async record=>(await db).remove(record.id,record.revision),
    read:(record,name)=>read(name,record.modelFiles?.[name]??record.files[name]),
    async build(record,name){
      runtime??=await createRuntime({onStatus:status});
      const {scene}=await runtime.run({filename:name,code:record.files[name],files:{...record.files,...record.modelFiles}});
      return {version:1,name,scene};
    },
    loose:read,
    select:async id=>(await db).select(id),
    cancel(){runtime?.cancel();}
  };
}
