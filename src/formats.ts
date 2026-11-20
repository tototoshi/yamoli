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
 *
 * A format name can carry an argument after a colon: `code:ts` is code in
 * TypeScript, rendered by `code` with `ts` passed on.
 */
import DOMPurify from 'dompurify';
import type { HLJSApi } from 'highlight.js';
import { Marked } from 'marked';
import { jsonTokens, tokensHtml } from './highlight';
import { t } from './i18n';
import { downloadUrl, fileUrl, sizeLabel } from './files';

export interface Format {
  name: string;
  label: string;
  /** Hint in the empty editor (a function when it depends on the language). */
  placeholder: string | (() => string);
  /** arg: what the name carries after its colon (`code:ts`: `ts`), or ''. */
  render: (content: string, arg: string) => string;
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (s: string) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

const registry = new Map<string, Format>();

export function registerFormat(name: string, def: Omit<Format, 'name' | 'placeholder'> & { placeholder?: Format['placeholder'] }) {
  registry.set(name, { name, placeholder: '', ...def });
}

/** A format name and its argument: `code:ts` → ['code', 'ts']. */
const split = (name: string): [string, string] => {
  const at = name.indexOf(':');
  return at < 0 ? [name, ''] : [name.slice(0, at), name.slice(at + 1)];
};
export const hasFormat = (name: string) => registry.has(split(name)[0]);
export const getFormat = (name: string): Format => registry.get(split(name)[0]) ?? registry.get('text')!;
/** What a format name carries after its colon (a code block's language), or ''. */
export const formatArg = (name: string) => split(name)[1];

/** ``` and a language, as a Markdown code fence opens: `ts`, `c++`, `objective-c` … */
export const CODE_FENCE = /^```([\w+#.-]*)$/;
/** A code block's format, in lang (none: plain code). */
export const codeFormat = (lang: string) => (lang ? 'code:' + lang : 'code');
export const listFormats = () => [...registry.values()];
export const placeholderOf = (f: Format) => (typeof f.placeholder === 'function' ? f.placeholder() : f.placeholder);

// Links open in a new tab; files kept with the outline (`files/…`) load from the server.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A' && node.getAttribute('href')) {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
  if (node.tagName === 'IMG' && node.getAttribute('src')) node.setAttribute('src', fileUrl(node.getAttribute('src')!));
  if (node.tagName === 'A' && node.getAttribute('href')) node.setAttribute('href', fileUrl(node.getAttribute('href')!));
});

export function renderFormat(name: string, content: string): string {
  if (!content.trim()) return `<div class="fmt-empty">${t('(空 — クリックして編集)', '(empty — click to edit)')}</div>`;
  let html: string;
  try {
    html = getFormat(name).render(content, formatArg(name));
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

// ---------------------------------------------------------------- code colours

// highlight.js is loaded when code in a language is first drawn, not with the page: until it is there, code is drawn
// plain, and what draws it is told when it comes, to draw it again.
let hljs: HLJSApi | null = null;
let loading: Promise<void> | null = null;
const waiting = new Set<() => void>();

/** Load highlight.js (once); resolves when code can be coloured. */
export function loadHighlighter(): Promise<void> {
  loading ??= import('highlight.js/lib/common').then((m) => {
    hljs = m.default;
    for (const f of waiting) f();
  });
  return loading;
}

/** Call f when highlight.js has come, to colour code drawn plain before; returns what stops it. */
export function onHighlighter(f: () => void): () => void {
  waiting.add(f);
  return () => waiting.delete(f);
}

/** code coloured as lang is (hljs-… spans); only escaped in a language it does not know, or before it is loaded. */
export function highlighted(code: string, lang: string): string {
  if (!lang) return escapeHtml(code);
  if (!hljs) return (loadHighlighter(), escapeHtml(code));
  return hljs.getLanguage(lang) ? hljs.highlight(code, { language: lang, ignoreIllegals: true }).value : escapeHtml(code);
}

// ---------------------------------------------------------------- markdown

const md = new Marked({ gfm: true, breaks: true, async: false });
// Fenced code in its language's colours, as a code block's.
md.use({
  renderer: {
    code: ({ text, lang }) => {
      const l = (lang ?? '').trim().split(/\s/)[0];
      return `<pre><code${l ? ` class="language-${escapeHtml(l)}"` : ''}>${highlighted(text, l)}</code></pre>\n`;
    },
  },
});

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

// ---------------------------------------------------------------- file

/** A file to download: its reference (`files/….pdf`), the name it came with and its size in bytes, then an optional note. */
registerFormat('file', {
  label: 'File',
  placeholder: 'files/….pdf\nreport.pdf\n12345',
  render: (c) => {
    const [ref, name = '', size = '', ...note] = c.split('\n').map((l) => l.trim());
    const bytes = Number(size);
    const label = name || ref.split('/').pop()!;
    return (
      `<div class="fmt-file"><a href="${escapeHtml(downloadUrl(ref, name))}" download="${escapeHtml(label)}">` +
      `<span class="file-name">${escapeHtml(label)}</span>` +
      (size && Number.isFinite(bytes) ? `<span class="file-size">${sizeLabel(bytes)}</span>` : '') +
      `</a>${note.join(' ').trim() ? `<div class="file-note">${escapeHtml(note.join('\n').trim())}</div>` : ''}</div>`
    );
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
  // The language as Markdown's fences mark it, and named in a corner.
  render: (c, lang) =>
    lang
      ? `<pre class="fmt-code" data-lang="${escapeHtml(lang)}"><code class="language-${escapeHtml(lang)}">${highlighted(c, lang)}</code></pre>`
      : `<pre class="fmt-code"><code>${escapeHtml(c)}</code></pre>`,
});
