// The Markdown models write (headings, lists, code, emphasis), as DOM nodes. Text is never parsed as HTML.

function inline(parent, text) {
  const pattern = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*|_[^_\n]+_)/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    parent.append(text.slice(last, match.index));
    const [whole] = match;
    const node = document.createElement(match[1] ? 'code' : match[2] ? 'strong' : 'em');
    node.textContent = match[1] ? whole.slice(1, -1) : match[2] ? whole.slice(2, -2) : whole.slice(1, -1);
    parent.append(node);
    last = match.index + whole.length;
  }
  parent.append(text.slice(last));
  return parent;
}

/** `text` as a fragment of paragraphs, headings, lists and code blocks. */
export function renderMarkdown(text) {
  const fragment = document.createDocumentFragment();
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let paragraph = [], list = null;
  const flush = () => {
    if (paragraph.length) fragment.append(inline(document.createElement('p'), paragraph.join('\n')));
    paragraph = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = line.match(/^\s*```\s*([\w+-]*)\s*$/);
    if (fence) {
      flush(); list = null;
      const code = [];
      while (++i < lines.length && !/^\s*```\s*$/.test(lines[i])) code.push(lines[i]);
      const pre = document.createElement('pre'), node = document.createElement('code');
      if (fence[1]) pre.dataset.language = fence[1];
      node.textContent = code.join('\n');
      pre.append(node);
      fragment.append(pre);
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      flush(); list = null;
      fragment.append(inline(document.createElement('h' + Math.min(6, heading[1].length + 3)), heading[2]));
      continue;
    }
    const item = line.match(/^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/);
    if (item) {
      flush();
      const kind = item[1] ? 'UL' : 'OL';
      if (list?.tagName !== kind) { list = document.createElement(kind); fragment.append(list); }
      list.append(inline(document.createElement('li'), item[3]));
      continue;
    }
    if (!line.trim()) { flush(); list = null; continue; }
    if (list && /^\s{2,}\S/.test(line)) { list.lastElementChild.append(' ' + line.trim()); continue; }
    list = null;
    paragraph.push(line);
  }
  flush();
  return fragment;
}
