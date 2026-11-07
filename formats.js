/*
 * Data format registry.
 *
 * Each format turns a data block's raw `content` string into HTML for display.
 * Add your own with:
 *
 *   Formats.register('yaml', {
 *     label: 'YAML',
 *     placeholder: 'key: value',
 *     render: (content) => `<pre>${Formats.escape(content)}</pre>`,
 *   });
 *
 * render() must return safe HTML: escape anything that comes from content.
 */
(function (global) {
  'use strict';

  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const escape = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

  const registry = new Map();

  const Formats = {
    escape,
    register(name, def) {
      registry.set(name, {
        name,
        label: def.label || name,
        placeholder: def.placeholder || '',
        render: def.render,
      });
    },
    has(name) {
      return registry.has(name);
    },
    get(name) {
      return registry.get(name) || registry.get('text');
    },
    list() {
      return [...registry.values()];
    },
    render(name, content) {
      if (!content.trim()) return '<div class="fmt-empty">(空 — クリックして編集)</div>';
      try {
        return this.get(name).render(content);
      } catch (e) {
        return `<div class="fmt-error">${escape(e.message)}</div><pre>${escape(content)}</pre>`;
      }
    },
  };

  // ---------------------------------------------------------------- text

  Formats.register('text', {
    label: 'Text',
    placeholder: 'プレーンテキスト',
    render: (c) => `<div class="fmt-text">${escape(c)}</div>`,
  });

  // ---------------------------------------------------------------- markdown

  function safeUrl(u) {
    // Content is already HTML-escaped, so only the scheme needs checking.
    if (/^[a-z][a-z0-9+.-]*:/i.test(u) && !/^(https?|mailto):/i.test(u)) return '#';
    return u;
  }

  function mdInline(src) {
    const codes = [];
    let s = src.replace(/`([^`]+)`/g, (_, c) => {
      codes.push(c);
      return `\u0000${codes.length - 1}\u0000`;
    });
    s = escape(s);
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, u) => `<img alt="${alt}" src="${safeUrl(u)}">`);
    s = s.replace(
      /\[([^\]]+)\]\(([^)\s]+)\)/g,
      (_, t, u) => `<a href="${safeUrl(u)}" target="_blank" rel="noopener">${t}</a>`
    );
    s = s.replace(
      /(^|[\s(])(https?:\/\/[^\s<)]+)/g,
      '$1<a href="$2" target="_blank" rel="noopener">$2</a>'
    );
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
    s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${escape(codes[+i])}</code>`);
    return s;
  }

  const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
  const HR_RE = /^\s*([-*_])(\s*\1){2,}\s*$/;
  const TABLE_SEP_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

  function parseList(lines, i, indent) {
    const ordered = /\d/.test(lines[i].match(LIST_RE)[2]);
    let html = '';
    while (i < lines.length) {
      const m = lines[i].match(LIST_RE);
      if (!m) break;
      const ind = m[1].length;
      if (ind < indent) break;
      if (ind > indent) {
        const [sub, next] = parseList(lines, i, ind);
        html = html.replace(/<\/li>$/, sub + '</li>');
        i = next;
        continue;
      }
      const task = m[3].match(/^\[([ xX])\]\s+(.*)$/);
      html += task
        ? `<li class="task"><input type="checkbox" disabled${task[1] === ' ' ? '' : ' checked'}> ${mdInline(task[2])}</li>`
        : `<li>${mdInline(m[3])}</li>`;
      i++;
    }
    const tag = ordered ? 'ol' : 'ul';
    return [`<${tag}>${html}</${tag}>`, i];
  }

  function splitRow(row) {
    return row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
  }

  function markdown(src) {
    const lines = src.replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    const isBlockStart = (l) => /^(#{1,6}\s|```|>)/.test(l) || LIST_RE.test(l) || HR_RE.test(l);
    let i = 0;
    while (i < lines.length) {
      const l = lines[i];
      let m;
      if (!l.trim()) {
        i++;
      } else if ((m = l.match(/^```\s*([\w-]*)/))) {
        const buf = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
        i++;
        const cls = m[1] ? ` class="lang-${escape(m[1])}"` : '';
        out.push(`<pre><code${cls}>${escape(buf.join('\n'))}</code></pre>`);
      } else if ((m = l.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/))) {
        const n = m[1].length;
        out.push(`<h${n}>${mdInline(m[2])}</h${n}>`);
        i++;
      } else if (HR_RE.test(l)) {
        out.push('<hr>');
        i++;
      } else if (/^>/.test(l)) {
        const buf = [];
        while (i < lines.length && /^>/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''));
        out.push(`<blockquote>${markdown(buf.join('\n'))}</blockquote>`);
      } else if (LIST_RE.test(l)) {
        const [html, next] = parseList(lines, i, l.match(LIST_RE)[1].length);
        out.push(html);
        i = next;
      } else if (l.includes('|') && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1])) {
        const head = splitRow(l);
        const align = splitRow(lines[i + 1]).map((c) =>
          c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : ''
        );
        const td = (tag, c, j) => `<${tag}${align[j] ? ` style="text-align:${align[j]}"` : ''}>${mdInline(c)}</${tag}>`;
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
          rows.push(`<tr>${splitRow(lines[i++]).map((c, j) => td('td', c, j)).join('')}</tr>`);
        }
        out.push(
          `<table><thead><tr>${head.map((c, j) => td('th', c, j)).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`
        );
      } else {
        const buf = [];
        while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) buf.push(lines[i++]);
        out.push(`<p>${buf.map(mdInline).join('<br>')}</p>`);
      }
    }
    return out.join('\n');
  }

  Formats.register('markdown', {
    label: 'Markdown',
    placeholder: '# 見出し\n\n- **太字** や `code` が使えます',
    render: (c) => `<div class="fmt-markdown">${markdown(c)}</div>`,
  });

  // ---------------------------------------------------------------- json

  function highlightJson(json) {
    return escape(json).replace(
      /(&quot;(?:\\.|[^\\&]|&(?!quot;))*?&quot;)(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g,
      (m, str, colon, lit) => {
        if (str) return colon ? `<span class="j-key">${str}</span>${colon}` : `<span class="j-str">${str}</span>`;
        if (lit) return `<span class="j-lit">${m}</span>`;
        return `<span class="j-num">${m}</span>`;
      }
    );
  }

  Formats.register('json', {
    label: 'JSON',
    placeholder: '{ "key": "value" }',
    render: (c) => `<pre class="fmt-json">${highlightJson(JSON.stringify(JSON.parse(c), null, 2))}</pre>`,
  });

  // ---------------------------------------------------------------- csv

  function parseCsv(src) {
    const rows = [];
    let row = [];
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

  Formats.register('csv', {
    label: 'CSV (表)',
    placeholder: 'name,qty\napple,3',
    render: (c) => {
      const [head, ...body] = parseCsv(c);
      const tr = (r, tag) => `<tr>${r.map((x) => `<${tag}>${escape(x)}</${tag}>`).join('')}</tr>`;
      return `<table class="fmt-csv"><thead>${tr(head, 'th')}</thead><tbody>${body.map((r) => tr(r, 'td')).join('')}</tbody></table>`;
    },
  });

  // ---------------------------------------------------------------- code

  Formats.register('code', {
    label: 'Code',
    placeholder: 'function hello() {}',
    render: (c) => `<pre class="fmt-code"><code>${escape(c)}</code></pre>`,
  });

  global.Formats = Formats;
  if (typeof module !== 'undefined' && module.exports) module.exports = { Formats, markdown, parseCsv };
})(typeof window !== 'undefined' ? window : globalThis);
