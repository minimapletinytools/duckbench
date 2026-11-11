import bootstrapSource from '../public/ocp-bootstrap.py?raw';
import runner from '../python/runner.py?raw';
let ready;
const send = data=>self.postMessage(data);
async function initialize() {
  send({status:'Loading Python…'});
  const base='https://cdn.jsdelivr.net/pyodide/v314.0.7/full/';
  const {loadPyodide}=await import(/* @vite-ignore */ base+'pyodide.mjs');
  const py=await loadPyodide({indexURL:base,stdout:s=>send({log:s+'\n'}),stderr:s=>send({log:s+'\n'})});
  await py.loadPackage('micropip');
  send({status:'Loading CAD kernel and packages…'});
  await py.runPythonAsync(bootstrapSource);
  await py.runPythonAsync(`
import os
for name in ('geteuid', 'getegid'):
    if not hasattr(os, name): setattr(os, name, lambda: 0)
await bootstrap('0.13.0')
await micropip.install('ocp-tessellate==3.6.3')
`);
  py.globals.set('__name__','build1234_runner');
  py.runPython(runner);
  py.FS.mkdirTree('/project');
  send({status:'Ready'});
  return py;
}
let queue=Promise.resolve();
self.onmessage=({data})=>{queue=queue.then(async()=>{
  try {
    const py=await (ready??=initialize());
    if(data.method==='run') {
      const relative=name=>name.replaceAll('\\','/').split('/').filter(part=>part && part!=='.' && part!=='..').join('/');
      for(const [name,content] of Object.entries(data.params.files||{})) {
        const filename='/project/'+relative(name);
        py.FS.mkdirTree(filename.slice(0,filename.lastIndexOf('/')));
        py.FS.writeFile(filename,content);
      }
      data.params.filename='/project/'+relative(data.params.filename);
      py.FS.mkdirTree(data.params.filename.slice(0,data.params.filename.lastIndexOf('/')));
      delete data.params.files;
    }
    py.globals.set('_request_json',JSON.stringify(data));
    const result=JSON.parse(await py.runPythonAsync('json.dumps(dispatch(json.loads(_request_json)))'));
    send({id:data.id,result});
  }catch(error){send({id:data.id,error:String(error.stack||error)});}
});};
