import {createViewer} from './viewer/viewer.js';

/**
 * The preview: Duckbench's own viewer (src/viewer/) behind the interface the workbench, the agent
 * and the standalone viewer use. `options` are the viewer's: describe, onPrompt, insertText, onSelect.
 */
export function createCadPanel(container, options = {}) {
  let viewer = null;
  const ensure = () => (viewer ??= createViewer(container, options));
  return {
    layout: () => viewer?.layout(),
    clear: () => viewer?.clear(),
    render: scene => ensure().show(scene),
    picks: limit => viewer?.picks(limit) || [],
    selection: () => viewer?.selection() || null,
    async screenshot(view = 'current') {
      if (!viewer) throw new Error('No model is shown. Build one first.');
      return viewer.screenshot(view);
    },
    camera(args = {}) {
      if (!viewer) throw new Error('No model is shown. Build one first.');
      return viewer.camera(args);
    },
    setOptions: next => { Object.assign(options, next); viewer?.setOptions(next); },
    dispose: () => { viewer?.dispose(); viewer = null; },
  };
}
