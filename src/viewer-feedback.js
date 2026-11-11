/** Loading and stale-preview UI lives outside the canvas so an existing model stays usable. */
export function createViewerFeedback(preview, onRefresh) {
  const toolbar = preview.querySelector('.panel-toolbar');
  const refresh = document.createElement('button');
  refresh.id = 'refresh-preview';
  refresh.className = 'refresh-preview';
  refresh.textContent = '↻ Refresh preview';
  refresh.title = 'The source has changed. Rebuild the preview (Ctrl/Cmd+Enter).';
  refresh.hidden = true;
  refresh.onclick = onRefresh;
  const compact = document.createElement('span');
  compact.id = 'preview-progress';
  compact.className = 'preview-progress';
  compact.setAttribute('role', 'status');
  compact.hidden = true;
  compact.innerHTML = '<span class="loading-spinner" aria-hidden="true"></span><span></span>';
  toolbar.insertBefore(compact, toolbar.querySelector('.panel-spacer'));
  toolbar.insertBefore(refresh, toolbar.querySelector('.panel-spacer'));

  const loading = document.createElement('div');
  loading.id = 'preview-loading';
  loading.setAttribute('role', 'status');
  loading.hidden = true;
  loading.innerHTML = '<span class="loading-spinner" aria-hidden="true"></span><strong></strong><p></p>';
  preview.querySelector('.viewport-wrap').append(loading);

  return {
    update({busy, hasModel, needsSetup, stale, disabled, message}) {
      preview.querySelector('#cad-view').setAttribute('aria-busy', String(busy));
      preview.querySelector('#empty-state').hidden = hasModel || busy;
      loading.hidden = !busy || hasModel;
      compact.hidden = !busy || !hasModel;
      loading.querySelector('strong').textContent = message;
      loading.querySelector('p').textContent = needsSetup
        ? 'The first run downloads Python and CAD packages and warms the browser cache. This can take a minute or more. Later runs are usually faster.'
        : 'Building your model and preparing the 3D preview…';
      compact.lastElementChild.textContent = message;
      compact.title = message;
      refresh.hidden = !hasModel || !stale || busy;
      refresh.disabled = disabled;
    },
  };
}
