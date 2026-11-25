import {Display,Viewer} from 'three-cad-viewer';
import 'three-cad-viewer/css';

export function createCadPanel(container) {
  let viewer, host, sequence=0, scheduled;
  // What the user picked in the preview, newest first, for the agent.
  const picks=[];
  function notify(change){
    const pick=change?.lastPick?.new;
    if(!pick?.name)return;
    const box=pick.boundingBox||{};
    picks.unshift({at:new Date().toISOString(),name:pick.name,path:pick.path,
      boundingBox:box.xmin===undefined?null:{min:[box.xmin,box.ymin,box.zmin],max:[box.xmax,box.ymax,box.zmax]}});
    picks.length=Math.min(picks.length,20);
  }
  const options={up:'Z',axes:true,axes0:true,grid:[true,false,false],ortho:true,transparent:false,tools:true,glass:false};
  const renderOptions={ambientIntensity:1.1,directIntensity:1.1,metalness:0.15,roughness:0.65,edgeColor:0x394751};
  function sizes(element=host) {
    const {width,height}=container.getBoundingClientRect();
    const toolbar=element?.querySelector('.tcv_cad_toolbar')?.getBoundingClientRect().height || 38;
    const treeWidth=width<650?140:180;
    return {cadWidth:Math.max(1,Math.floor(width-treeWidth-4)),treeWidth,height:Math.max(1,Math.floor(height-toolbar-4))};
  }
  function layout() {
    if(!viewer || !container.clientWidth || !container.clientHeight)return;
    const size=sizes();
    viewer.resizeCadView(size.cadWidth,size.treeWidth,size.height,false);
  }
  function schedule(){cancelAnimationFrame(scheduled);scheduled=requestAnimationFrame(layout);}
  const observer=new ResizeObserver(schedule);observer.observe(container);
  return {
    layout:schedule,
    clear(){viewer?.dispose();host?.remove();viewer=null;host=null;picks.length=0;},
    picks:limit=>picks.slice(0,limit),
    /** The camera, after moving it to a preset view, position, target or zoom when given. */
    camera({view,position,target,zoom}={}){
      if(!viewer)throw new Error('No model is shown. Build one first.');
      if(view)viewer.presetCamera(view);
      if(position||target||zoom!==undefined)viewer.setCameraLocationSettings(position??null,null,target??null,zoom??null);
      const round=values=>values.map(value=>+value.toFixed(3));
      const now=viewer.getCameraLocationSettings();
      return {position:round(now.position),target:round(now.target),zoom:+now.zoom.toFixed(4),projection:viewer.getCameraType()};
    },
    /** The canvas as an image at most 1024 pixels wide, after moving the camera to a preset view. */
    async screenshot(view='current'){
      if(!viewer)throw new Error('No model is shown. Build one first.');
      if(view!=='current')viewer.presetCamera(view);
      const {dataUrl}=await viewer.getImage('agent');
      if(!dataUrl)throw new Error('The preview is not ready yet.');
      const image=new Image();image.src=dataUrl;await image.decode();
      const scale=Math.min(1,1024/image.width),canvas=document.createElement('canvas');
      canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));
      const context=canvas.getContext('2d');context.fillStyle=getComputedStyle(container).backgroundColor||'#fff';
      context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);
      const jpeg=canvas.toDataURL('image/jpeg',0.88);
      return {data:jpeg.slice(jpeg.indexOf(',')+1),mimeType:'image/jpeg',width:canvas.width,height:canvas.height};
    },
    render(scene){
      const nextHost=document.createElement('div');nextHost.className='cad-instance';nextHost.id=`cad-scene-${++sequence}`;
      nextHost.style.visibility='hidden';container.append(nextHost);
      let next;
      try {
        const size=sizes(nextHost);
        const display=new Display(nextHost,{...options,...size,treeHeight:Math.max(80,size.height-100),theme:'browser',pinning:true});
        next=new Viewer(display,{...options,...size},notify);
        next.render(scene,renderOptions,{...options,...size});
      }catch(error){next?.dispose();nextHost.remove();throw error;}
      viewer?.dispose();host?.remove();viewer=next;host=nextHost;host.style.visibility='visible';layout();schedule();
    },
    dispose(){observer.disconnect();cancelAnimationFrame(scheduled);viewer?.dispose();host?.remove();}
  };
}
