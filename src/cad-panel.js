import {Display,Viewer} from 'three-cad-viewer';
import 'three-cad-viewer/css';

export function createCadPanel(container) {
  let viewer, host, sequence=0, scheduled;
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
    render(scene){
      const nextHost=document.createElement('div');nextHost.className='cad-instance';nextHost.id=`cad-scene-${++sequence}`;
      nextHost.style.visibility='hidden';container.append(nextHost);
      let next;
      try {
        const size=sizes(nextHost);
        const display=new Display(nextHost,{...options,...size,treeHeight:Math.max(80,size.height-100),theme:'browser',pinning:true});
        next=new Viewer(display,{...options,...size},()=>{});
        next.render(scene,renderOptions,{...options,...size});
      }catch(error){next?.dispose();nextHost.remove();throw error;}
      viewer?.dispose();host?.remove();viewer=next;host=nextHost;host.style.visibility='visible';layout();schedule();
    },
    dispose(){observer.disconnect();cancelAnimationFrame(scheduled);viewer?.dispose();host?.remove();}
  };
}
