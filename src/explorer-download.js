import {strToU8,zipSync} from 'fflate';

export async function explorerDownload(entry,{list,read}){
  const name=entry.path.split(/[\\/]/).pop();
  async function bytes(path){
    const content=await read(path);
    return typeof content==='string'?strToU8(content):content;
  }
  if(!entry.directory)return {name,bytes:await bytes(entry.path)};
  const files=Object.create(null);
  async function collect(folder,prefix){
    files[prefix+'/']=new Uint8Array();
    for(const child of folder.children??await list(folder.path)){
      const path=prefix+'/'+child.name;
      if(child.directory)await collect(child,path);
      else files[path]=await bytes(child.path);
    }
  }
  await collect(entry,name);
  return {name:name+'.zip',bytes:zipSync(files)};
}
