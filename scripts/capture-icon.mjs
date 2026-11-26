// Render the original duck with the application's 3D viewer and screenshot its canvas.
// Requires Chrome, uv, and macOS's sips/iconutil for the desktop icon sizes.
import {createServer} from 'vite';
import {chromium} from 'playwright';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'..');
const output=path.join(root,'public/icons');
await fs.mkdir(output,{recursive:true});
const code=await fs.readFile(path.join(root,'examples/duck.py'),'utf8');
const response=JSON.parse(execFileSync('uv',['run','python','python/runner.py'],{
 cwd:root,input:JSON.stringify({id:1,method:'run',params:{code,filename:path.join(root,'examples/duck.py')}})+'\n',
 encoding:'utf8',maxBuffer:32*1024*1024,
}));
if(response.error)throw new Error(response.error);
const server=await createServer({root,server:{host:'127.0.0.1',port:0},plugins:[{
 name:'icon-capture',configureServer(server){server.middlewares.use('/__icon',(_,res)=>{
  res.setHeader('Content-Type','text/html');
  res.end('<!doctype html><html><head><style>html,body{margin:0;background:transparent}#capture{position:relative;width:1024px;height:1024px}</style></head><body><div id="capture"></div></body></html>');
 });},
}]});
await server.listen();
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1250,height:1150},deviceScaleFactor:1,colorScheme:'light'});
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__icon`);
 await page.evaluate(async scene=>{
  const {createViewer}=await import('/src/viewer/viewer.js');
  // Only the duck, shaded, on a transparent canvas: the duck and its turquoise pond form the silhouette.
  const viewer=createViewer(document.querySelector('#capture'),{plain:true});
  viewer.show(scene);
  // From the front right and a little above, aimed just below the model's centre.
  const [x,y,z]=viewer.camera().target;
  viewer.camera({position:[x+40,y-100,z+41],target:[x,y,z-4],zoom:1.35});
  window.iconViewer=viewer;
 },response.result.scene);
 await page.waitForTimeout(500);
 await page.locator('#capture canvas.dbv-canvas').screenshot({path:path.join(output,'duck.png'),omitBackground:true});
}finally{await browser.close();await server.close();}

for(const size of [16,32,48,64,128,180,192,256,512]){
 execFileSync('sips',['-z',String(size),String(size),path.join(output,'duck.png'),'--out',path.join(output,`duck-${size}.png`)],{stdio:'ignore'});
}
const iconset=path.join(root,'test-artifacts/Duckbench.iconset');
await fs.mkdir(iconset,{recursive:true});
for(const size of [16,32,128,256,512])for(const scale of [1,2]){
 const source=size*scale===1024?'duck.png':`duck-${size*scale}.png`;
 await fs.copyFile(path.join(output,source),path.join(iconset,`icon_${size}x${size}${scale===2?'@2x':''}.png`));
}
execFileSync('iconutil',['-c','icns',iconset,'-o',path.join(output,'duck.icns')]);
// ICO supports PNG payloads; include multiple sizes for Windows shell scaling.
const sizes=[16,32,48,256];
const images=await Promise.all(sizes.map(size=>fs.readFile(path.join(output,`duck-${size}.png`))));
const header=Buffer.alloc(6+16*sizes.length);header.writeUInt16LE(1,2);header.writeUInt16LE(sizes.length,4);
let offset=header.length;
images.forEach((image,i)=>{const entry=6+16*i;header[entry]=header[entry+1]=sizes[i]%256;header.writeUInt16LE(1,entry+4);header.writeUInt16LE(32,entry+6);header.writeUInt32LE(image.length,entry+8);header.writeUInt32LE(offset,entry+12);offset+=image.length;});
await fs.writeFile(path.join(output,'duck.ico'),Buffer.concat([header,...images]));
console.log('Captured Puddle the duck and generated browser, macOS, and Windows icons.');
