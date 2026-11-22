const {build}=require('./package.json');
module.exports = {
  ...build, extends:null, appId:'dev.duckbench.standaloneviewer',productName:'Duckbench Viewer',
  extraMetadata:{main:'electron/viewer-main.cjs',name:'duckbench-viewer'},
  directories:{output:'release/viewer'},
  fileAssociations:[{ext:['step','stp','stl'],name:'CAD Model',role:'Viewer'}],
};
