import {createCadPanel} from '../cad-panel.js';
import './viewer.css';

const cad = createCadPanel(document.querySelector('#viewport'));
const notice = document.querySelector('#notice');
function display(model) {
  if (model?.version !== 1 || !Array.isArray(model.scene?.parts) || typeof model.name !== 'string') {
    throw new Error('Unsupported Duckbench scene.');
  }
  cad.render(model.scene);
  document.querySelector('#model-name').textContent = model.name;
  document.title = model.name + ' — Duckbench Viewer';
  notice.textContent = '';
}
const embedded = JSON.parse(document.querySelector('#duckbench-scene').textContent);
if (embedded) {
  try { display(embedded); } catch (error) { notice.textContent = error.message; }
} else if (window.cadViewer) {
  const open = document.querySelector('#open-cad');
  open.hidden = false;
  open.onclick = () => window.cadViewer.open();
  notice.textContent = 'Open a STEP, STL or Duckbench viewer HTML file.';
  window.cadViewer.onModel(({model, message}) => {
    try {
      if (model) display(model);
      else notice.textContent = message;
    } catch (error) { notice.textContent = error.message; }
  });
  window.cadViewer.ready();
}
