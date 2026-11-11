function bytes(base64) {return Uint8Array.from(atob(base64), c=>c.charCodeAt(0));}
export async function createRuntime({onLog=()=>{},onStatus=()=>{}}={}) {
  if(window.desktop) {
    const unsubscribe=window.desktop.onLog(onLog);
    return {run: ({code,filename})=>window.desktop.request({method:'run',params:{code,filename}}), exportModel: async format=>bytes(await window.desktop.request({method:'export',params:{format}})), cancel:()=>window.desktop.cancel(),dispose:()=>{unsubscribe();window.desktop.cancel();}};
  }
  let worker, next=0;
  const pending=new Map();
  function stop() {worker?.terminate();worker=null;for(const p of pending.values())p.reject(new Error('Run cancelled. Run again to restart Python.'));pending.clear();}
  function request(method,params) {
    if(!worker) {
      worker=new Worker(new URL('./worker.js',import.meta.url),{type:'module'});
      worker.onmessage=({data})=>{
        if(data.log!==undefined)onLog(data.log);
        else if(data.status)onStatus(data.status);
        else {const p=pending.get(data.id);if(p){pending.delete(data.id);data.error?p.reject(new Error(data.error)):p.resolve(data.result);}}
      };
      worker.onerror=e=>{onLog(e.message);stop();};
    }
    const id=++next;
    return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});worker.postMessage({id,method,params});});
  }
  return {run:params=>request('run',params), exportModel:async format=>bytes(await request('export',{format})),cancel:stop,dispose:stop};
}
