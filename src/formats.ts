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
import { jsonTokens, tokensHtml } from './highlight';
import { t } from './i18n';
import { fileUrl } from './files';

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

// Links open in a new tab; images kept with the outline (`files/…`) load from the server.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A' && node.getAttribute('href')) {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
  if (node.tagName === 'IMG' && node.getAttribute('src')) node.setAttribute('src', fileUrl(node.getAttribute('src')!));
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

// ---------------------------------------------------------------- image

/** A picture: its reference (`files/….png`, or a web address) on the first line, an optional caption below. */
registerFormat('image', {
  label: 'Image',
  placeholder: 'files/….png',
  render: (c) => {
    const [src, ...caption] = c.split('\n');
    const text = caption.join('\n').trim();
    const alt = escapeHtml(text);
    return `<figure class="fmt-image"><img src="${escapeHtml(src.trim())}" alt="${alt}">${text ? `<figcaption>${alt}</figcaption>` : ''}</figure>`;
  },
});

// ---------------------------------------------------------------- json

registerFormat('json', {
  label: 'JSON',
  placeholder: '{ "key": "value" }',
  render: (c) => `<pre class="fmt-json">${tokensHtml(jsonTokens(JSON.stringify(JSON.parse(c), null, 2)))}</pre>`,
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
