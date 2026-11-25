import * as monaco from 'monaco-editor/editor/editor.api.js';
import 'monaco-editor/languages/definitions/python/register.js';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';
globalThis.MonacoEnvironment={...globalThis.MonacoEnvironment,getWorker:()=>new EditorWorker()};
export function createEditor(element,{value='',onChange=()=>{},onCursor=()=>{}}={}) {
  const media=matchMedia('(prefers-color-scheme: dark)');
  const theme=()=>monaco.editor.setTheme(media.matches?'vs-dark':'vs');
  media.addEventListener('change',theme);
  const model=monaco.editor.createModel(value,'python');
  const instance=monaco.editor.create(element,{model,theme:media.matches?'vs-dark':'vs',automaticLayout:true,fontSize:13,lineHeight:21,fontFamily:'ui-monospace,"SF Mono",Menlo,Consolas,monospace',minimap:{enabled:false},scrollBeyondLastLine:false,wordWrap:'off',padding:{top:14,bottom:14},tabSize:4,insertSpaces:true,renderWhitespace:'selection',smoothScrolling:true,lineNumbersMinChars:3,glyphMargin:false,folding:true,overviewRulerLanes:0,hideCursorInOverviewRuler:true});
  let setting=false;
  const change=model.onDidChangeContent(()=>{if(!setting)onChange(model.getValue());});
  const cursor=instance.onDidChangeCursorPosition(event=>onCursor(event.position));
  function replaceRange(start,length,text) {
    const from=model.getPositionAt(start),to=model.getPositionAt(start+length);
    instance.pushUndoStop();
    instance.executeEdits('agent',[{range:new monaco.Range(from.lineNumber,from.column,to.lineNumber,to.column),text}]);
    instance.pushUndoStop();
  }
  return {selection:()=>{const range=instance.getSelection(),position=instance.getPosition();if(!position)return null;const text=range&&!range.isEmpty()?model.getValueInRange(range):'';return {line:position.lineNumber,column:position.column,...(text?{selectedLines:[range.startLineNumber,range.endLineNumber],selectedText:text.length>1500?text.slice(0,1500)+'…':text}:{})};},goToLine:line=>{instance.setPosition({lineNumber:line,column:1});instance.revealLineInCenter(line);instance.focus();},replaceRange,getValue:()=>model.getValue(),setValue:value=>{setting=true;try{if(model.getValue()!==value)model.setValue(value);}finally{setting=false;}},focus:()=>instance.focus(),layout:()=>{if(element.clientWidth&&element.clientHeight)instance.layout();},setFilename:filename=>{instance.updateOptions({ariaLabel:`Python editor: ${filename||'untitled.py'}`});element.setAttribute('aria-label',`Python editor: ${filename||'untitled.py'}`);},dispose:()=>{media.removeEventListener('change',theme);change.dispose();cursor.dispose();instance.dispose();model.dispose();}};
}
