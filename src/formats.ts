/*
 * Data format registry.
 *
 * Each format turns a data block's raw `content` string into HTML for display.
 * Add your own with:
 *
 *   registerFormat('yaml', {
 *     label: 'YAML',
 *     placeholder: 'key: value',
 *     render: (content) => `<pre>${escapeHtml(content)}</pre>`,
 *   });
 *
 * Whatever render() returns is passed through DOMPurify before display.
 */
import DOMPurify from 'dompurify';
import { Marked } from 'marked';
import { t } from './i18n';

export interface Format {
  name: string;
  label: string;
  /** Hint in the empty editor (a function when it depends on the language). */
  placeholder: string | (() => string);
  render: (content: string) => string;
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (s: string) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

const registry = new Map<string, Format>();

export function registerFormat(name: string, def: Omit<Format, 'name' | 'placeholder'> & { placeholder?: Format['placeholder'] }) {
  registry.set(name, { name, placeholder: '', ...def });
}

export const hasFormat = (name: string) => registry.has(name);
export const getFormat = (name: string): Format => registry.get(name) ?? registry.get('text')!;
export const listFormats = () => [...registry.values()];
export const placeholderOf = (f: Format) => (typeof f.placeholder === 'function' ? f.placeholder() : f.placeholder);

// Links open in a new tab.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A' && node.getAttribute('href')) {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

export function renderFormat(name: string, content: string): string {
  if (!content.trim()) return `<div class="fmt-empty">${t('(空 — クリックして編集)', '(empty — click to edit)')}</div>`;
  let html: string;
  try {
    html = getFormat(name).render(content);
  } catch (e) {
    html = `<div class="fmt-error">${escapeHtml((e as Error).message)}</div><pre>${escapeHtml(content)}</pre>`;
  }
  return DOMPurify.sanitize(html, { ADD_ATTR: ['target'] });
}

// ---------------------------------------------------------------- text

registerFormat('text', {
  label: 'Text',
  placeholder: () => t('プレーンテキスト', 'Plain text'),
  render: (c) => `<div class="fmt-text">${escapeHtml(c)}</div>`,
});

// ---------------------------------------------------------------- markdown

const md = new Marked({ gfm: true, breaks: true, async: false });

export const markdown = (src: string) => md.parse(src) as string;

registerFormat('markdown', {
  label: 'Markdown',
  placeholder: () => t('# 見出し\n\n- **太字** や `code` が使えます', '# Heading\n\n- **bold** and `code` work'),
  render: (c) => `<div class="fmt-markdown">${markdown(c)}</div>`,
});

// ---------------------------------------------------------------- json

function highlightJson(json: string): string {
  return escapeHtml(json).replace(
    /(&quot;(?:\\.|[^\\&]|&(?!quot;))*?&quot;)(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g,
    (m, str, colon, lit) => {
      if (str) return colon ? `<span class="j-key">${str}</span>${colon}` : `<span class="j-str">${str}</span>`;
      if (lit) return `<span class="j-lit">${m}</span>`;
      return `<span class="j-num">${m}</span>`;
    }
  );
}

registerFormat('json', {
  label: 'JSON',
  placeholder: '{ "key": "value" }',
  render: (c) => `<pre class="fmt-json">${highlightJson(JSON.stringify(JSON.parse(c), null, 2))}</pre>`,
});

// ---------------------------------------------------------------- csv

export function parseCsv(src: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}

registerFormat('csv', {
  label: 'CSV',
  placeholder: 'name,qty\napple,3',
  render: (c) => {
    const [head, ...body] = parseCsv(c);
    const tr = (r: string[], tag: string) => `<tr>${r.map((x) => `<${tag}>${escapeHtml(x)}</${tag}>`).join('')}</tr>`;
    return `<table class="fmt-csv"><thead>${tr(head, 'th')}</thead><tbody>${body.map((r) => tr(r, 'td')).join('')}</tbody></table>`;
  },
});

// ---------------------------------------------------------------- code

registerFormat('code', {
  label: 'Code',
  placeholder: 'function hello() {}',
  render: (c) => `<pre class="fmt-code"><code>${escapeHtml(c)}</code></pre>`,
});
