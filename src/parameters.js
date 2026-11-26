// A model's parameters: the UPPER_CASE number constants at the top level of its file, each with the
// comment after it, grouped under `# --- Section` lines. The panel over the preview edits them in place
// and rebuilds, as QuiCAD's parameters panel does.
import './parameters.css';

const PARAMETER = /^([A-Z][A-Z0-9_]*)(\s*(?::\s*(?:float|int)\s*)?=\s*)([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)(\s*(?:#\s*(.*))?)$/;
const SECTION = /^#\s*-{2,}\s*(.*?)\s*-*\s*$/;

/** Each parameter: {name, value (as written), line (0-based), comment, section}. */
export function parseParameters(code) {
  const found = [];
  let section = '';
  code.split('\n').forEach((text, line) => {
    const heading = text.match(SECTION);
    if (heading) { section = heading[1]; return; }
    const match = text.match(PARAMETER);
    if (match) found.push({name: match[1], value: match[3], line, comment: (match[5] || '').trim(), section});
  });
  return found;
}

/** `code` with one parameter's value replaced, keeping the rest of its line. */
export function setParameter(code, parameter, value) {
  const lines = code.split('\n');
  const match = lines[parameter.line]?.match(PARAMETER);
  if (!match || match[1] !== parameter.name) throw new Error(`${parameter.name} has moved; open the panel again.`);
  lines[parameter.line] = match[1] + match[2] + value + match[4];
  return lines.join('\n');
}

/** A number as the user typed it, or null when it is not one. Integers stay integers. */
export function normalizeValue(text) {
  const trimmed = String(text).trim();
  if (!/^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(trimmed)) return null;
  return trimmed.replace(/^\+/, '');
}

/**
 * The panel in `host`. `source()` gives {name, code} of the file to edit, or null; `apply({name,
 * from, to, code})` writes the new code and rebuilds.
 */
export function createParametersPanel(host, toggle, {source, apply}) {
  const panel = document.createElement('section');
  panel.className = 'parameters-panel';
  panel.setAttribute('aria-label', 'Parameters');
  panel.hidden = true;
  panel.innerHTML = '<header><strong>Parameters</strong><span></span></header><div class="parameters-list"></div><p class="parameters-note"></p>';
  host.append(panel);
  const list = panel.querySelector('.parameters-list'), note = panel.querySelector('.parameters-note');
  let shown = '';

  function refresh() {
    const file = source();
    const parameters = file ? parseParameters(file.code) : [];
    toggle.textContent = parameters.length ? `Parameters (${parameters.length})` : 'Parameters';
    panel.querySelector('header span').textContent = file?.name || '';
    // Leave the fields alone while one is being typed in, unless the file itself changed shape.
    const key = (file?.name || '') + '|' + parameters.map(p => p.name + '=' + p.value + '@' + p.line).join(',');
    if (key === shown) return;
    if (panel.contains(document.activeElement) && document.activeElement.tagName === 'INPUT' && shown.split('|')[0] === (file?.name || '')) return;
    shown = key;
    list.replaceChildren();
    note.textContent = parameters.length ? '' : 'No parameters. Put each size in an UPPER_CASE constant at the top of the file, such as WIDTH = 40  # mm, to change it here.';
    let section = null;
    for (const parameter of parameters) {
      if (parameter.section && parameter.section !== section) {
        section = parameter.section;
        const heading = document.createElement('h3');
        heading.textContent = section;
        list.append(heading);
      }
      const row = document.createElement('label');
      row.className = 'parameter';
      const name = document.createElement('span');
      name.className = 'parameter-name';
      name.textContent = parameter.name;
      const field = document.createElement('input');
      field.type = 'text';
      field.inputMode = 'decimal';
      field.value = parameter.value;
      field.spellcheck = false;
      field.setAttribute('aria-label', parameter.name + (parameter.comment ? ': ' + parameter.comment : ''));
      const commit = () => {
        const value = normalizeValue(field.value);
        if (value === null) { field.setAttribute('aria-invalid', 'true'); note.textContent = `${parameter.name} needs a number.`; return; }
        field.removeAttribute('aria-invalid');
        if (value === parameter.value) return;
        const current = source();
        if (!current) return;
        try {
          const code = setParameter(current.code, parameter, value);
          note.textContent = '';
          apply({name: parameter.name, from: parameter.value, to: value, code});
          parameter.value = value;
        } catch (error) { note.textContent = error.message; }
      };
      field.addEventListener('change', commit);
      field.addEventListener('keydown', event => {
        if (event.key === 'Enter') { event.preventDefault(); commit(); }
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          // Step by the last written digit: 40 by 1, 2.5 by 0.1, 0.25 by 0.01. Shift steps ten times as far.
          const value = Number(field.value);
          if (!Number.isFinite(value)) return;
          event.preventDefault();
          const decimals = (field.value.split('.')[1] || '').replace(/e.*/i, '').length;
          const step = 10 ** -decimals * (event.shiftKey ? 10 : 1) * (event.key === 'ArrowUp' ? 1 : -1);
          field.value = (value + step).toFixed(decimals);
          commit();
        }
      });
      row.append(name, field);
      if (parameter.comment) {
        const comment = document.createElement('span');
        comment.className = 'parameter-comment';
        comment.textContent = parameter.comment;
        row.append(comment);
      }
      list.append(row);
    }
  }

  toggle.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    toggle.setAttribute('aria-pressed', String(!panel.hidden));
    if (!panel.hidden) { shown = ''; refresh(); }
  });
  return {refresh, element: panel};
}
