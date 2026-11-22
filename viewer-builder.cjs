module.exports = {
  extends:null, appId:'dev.duckbench.standaloneviewer',productName:'Duckbench Viewer',
  extraMetadata:{main:'electron/viewer-main.cjs',name:'duckbench-viewer'},
  directories:{output:'release/viewer'},
  files:['dist/standalone/viewer.html','dist/about.html','dist/licenses/**','electron/viewer-*.cjs','package.json','LICENSE','NOTICE','!node_modules/**/*'],
  extraResources:[{from:'release/python',to:'python'},{from:'python/viewer_import.py',to:'python/viewer_import.py'}],
  fileAssociations:[{ext:['step','stp','stl'],name:'CAD Model',role:'Viewer'}],
  icon:'public/icons/duck-512.png',mac:{target:'dir',identity:null,icon:'public/icons/duck.icns'},
  win:{target:'dir',icon:'public/icons/duck.ico'},linux:{target:'dir'},
};
