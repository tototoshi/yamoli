/*
 * Reading `key: value` rows and indented text (YAML, nested lists) for the
 * outline-as-YAML model (see model.ts).
 */

/**
 * A row being typed as `name: ` (name without spaces), caught right after the
 * space so ordinary text is only converted when the user just typed it.
 */
export const FIELD_TYPED = /^([^\s:][^\s:]{0,39}): /;

/**
 * A `name: value` line (name without spaces), or `name:` alone. Not a sentence
 * running on to a colon (`…は、\`views: gantt\` を…`): no backquote, 、 or 。 in the name.
 */
const FIELD_LINE = /^([^\s:`、。][^\s:`、。]{0,39}):(?:\s+(.*))?$/;

export interface TextRow {
  key: string | null;
  text: string;
  children: TextRow[];
  /** A block field's format (`key: !markdown |`). */
  format?: string;
  /** A checklist line: `- [ ]` open, `- [x]` done. */
  task?: 'open' | 'done';
  /** An item of a numbered list (`1. `), in a Markdown list. */
  numbered?: boolean;
  /** A quotation (`> `), in a Markdown list. */
  quote?: boolean;
}

/** A Markdown heading (`# ` to `### `), a quotation (`> `) or a dividing line: a row of its own among a list's items. */
const HEADING_LINE = /^(?:#{1,3}[ \u3000]|>(?:[ \u3000]|$)|(?:-{3,}|\*{3,}|_{3,})\s*$)/;

/** A Markdown code fence opening (```, or more backquotes, and a language): the code is a code block. */
const FENCE = /^(`{3,})([\w+#.-]*)\s*$/;

/** A field value opening a block scalar: `|`, `|-`, `>` …, optionally tagged `!format` (or `!code:ts`). */
const BLOCK_START = /^(?:!([\w-]+(?::[\w+#.-]+)?)\s+)?[|>][-+]?\d?\s*$/;
/** A tagged single-line value: `!markdown **bold**`. */
const TAGGED = /^!([\w-]+(?::[\w+#.-]+)?)\s+(.*)$/;

/**
 * Indented lines to a tree. Indentation (spaces or tabs) nests; list markers
 * (`- `, `* `, `1. `) are dropped; `name: value` lines become fields. A list
 * item written `- name: value` starts an object: the item is an unnamed row
 * holding that field, and further lines at the field's indentation join it.
 * A block scalar (`name: |` or `name: !markdown |` and the lines indented
 * below it) becomes a block field.
 *
 * A Markdown list (every line a list item, as copied rows are written) is
 * read as rows instead: `- name: value` is a field of the row above, and a
 * line indented under an item's text continues that text.
 *
 * Fenced code (```ts … ```) is a code block in its language, among the rows
 * where it is (under the item it is indented under).
 */
export function parseOutlineText(text: string): TextRow[] {
  const root: TextRow = { key: null, text: '', children: [] };
  const stack: { indent: number; row: TextRow }[] = [{ indent: -1, row: root }];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const list = isMarkdownList(lines);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim()) continue; // (a `#` line is a row: a heading, as in Markdown)
    let indent = raw.match(/^[ \t]*/)![0].replace(/\t/g, '  ').length;
    let line = raw.trim();
    const fence = line.match(FENCE);
    if (fence) {
      const [code, end] = fenced(lines, i, indent, fence[1]);
      i = end;
      while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop();
      const parent = stack[stack.length - 1].row;
      // Its own name beside other code blocks there.
      let key = 'code';
      for (let n = 2; parent.children.some((c) => c.key === key); n++) key = 'code' + n;
      parent.children.push({ key, text: code, children: [], format: fence[2] ? 'code:' + fence[2] : 'code' });
      continue;
    }
    const marker = line.match(/^(?:[-*+]|\d+[.)])\s+/);
    if (list && !marker && !(indent === 0 && HEADING_LINE.test(raw))) {
      // More of the text of the item above.
      const above = stack[stack.length - 1].row;
      above.text += '\n' + line;
      continue;
    }
    if (marker) line = line.slice(marker[0].length);
    const quoted = list && !marker && indent === 0 ? line.match(/^>[ \u3000]?/) : null;
    if (quoted) line = line.slice(quoted[0].length);
    const check = marker ? line.match(/^\[([ xX])\]\s+/) : null;
    if (check) line = line.slice(check[0].length);
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop();
    const parent = stack[stack.length - 1].row;
    const field = quoted ? null : line.match(FIELD_LINE); // a quotation is words, whatever they look like
    if (marker && field && !list) {
      // `- name: value`: an object in a list.
      const item: TextRow = { key: null, text: '', children: [] };
      parent.children.push(item);
      stack.push({ indent, row: item });
      indent += marker[0].length;
      const row = fieldRow(field);
      i = readBlock(lines, i, indent, row);
      item.children.push(row);
      stack.push({ indent, row });
      // Sibling fields of this object are indented to `indent`; pop to the item for them.
      stack[stack.length - 1].indent = indent;
      stack[stack.length - 2].indent = indent - 1;
      continue;
    }
    const row: TextRow = field ? fieldRow(field) : { key: null, text: line, children: [] };
    if (check && !field) row.task = check[1] === ' ' ? 'open' : 'done';
    if (list && marker && /^\d/.test(marker[0]) && !field) row.numbered = true;
    if (quoted) row.quote = true;
    if (field) i = readBlock(lines, i, indent, row);
    parent.children.push(row);
    stack.push({ indent, row });
  }
  return root.children;
}

/**
 * Whether lines are a Markdown list: each one an item, a line of an item's
 * text indented under it, or part of a block field's value.
 */
function isMarkdownList(lines: string[]): boolean {
  let textAt = -1; // where the last item's text starts, for lines continuing it
  let blockAt = -1; // the indentation of a block field, for its value's lines
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim()) continue;
    const indent = raw.match(/^[ \t]*/)![0].replace(/\t/g, '  ').length;
    const fence = raw.trim().match(FENCE);
    if (fence && !(blockAt >= 0 && indent > blockAt)) {
      i = fenced(lines, i, indent, fence[1])[1]; // code, whatever is in it
      continue;
    }
    if (blockAt >= 0 && indent > blockAt) continue;
    blockAt = -1;
    const marker = raw.trim().match(/^(?:[-*+]|\d+[.)])\s+/);
    if (!indent && HEADING_LINE.test(raw)) textAt = -1;
    else if (marker) {
      const field = raw.trim().slice(marker[0].length).match(FIELD_LINE);
      if (field && BLOCK_START.test(field[2] ?? '')) blockAt = indent;
      textAt = field ? -1 : indent + marker[0].length;
    } else if (textAt < 0 || indent < textAt) return false;
  }
  return true;
}

/**
 * The code in a fence opened on line i (indented by indent, with fence's backquotes): its lines up to the closing
 * fence (or the end), dedented; and the line it ends on.
 */
function fenced(lines: string[], i: number, indent: number, fence: string): [string, number] {
  const body: string[] = [];
  let j = i + 1;
  for (; j < lines.length; j++) {
    const t = lines[j].trim();
    if (t.startsWith(fence) && /^`+$/.test(t)) break;
    body.push(lines[j].replace(/\t/g, '  '));
  }
  const cut = (l: string) => l.slice(Math.min(indent, l.match(/^ */)![0].length));
  return [body.map(cut).join('\n'), Math.min(j, lines.length - 1)];
}

function fieldRow(m: RegExpMatchArray): TextRow {
  const tagged = (m[2] ?? '').match(TAGGED);
  if (tagged && !BLOCK_START.test(m[2])) return { key: m[1], text: unquote(tagged[2]), children: [], format: tagged[1] };
  return { key: m[1], text: unquote(m[2] ?? ''), children: [] };
}

/**
 * If row's value opens a block scalar, take the lines indented deeper than
 * `indent` after line i as its text (dedented) and return the last one used.
 */
function readBlock(lines: string[], i: number, indent: number, row: TextRow): number {
  const m = row.text.match(BLOCK_START);
  if (!m || row.format) return i;
  const body: string[] = [];
  let j = i + 1;
  for (; j < lines.length; j++) {
    const l = lines[j].replace(/\t/g, '  ');
    if (l.trim() && l.match(/^ */)![0].length <= indent) break;
    body.push(l);
  }
  while (body.length && !body[body.length - 1].trim()) body.pop();
  const cut = Math.min(...body.filter((l) => l.trim()).map((l) => l.match(/^ */)![0].length));
  row.text = body.map((l) => l.slice(Math.min(cut, l.length))).join('\n');
  row.format = m[1] ?? 'text';
  return i + body.length;
}

const unquote = (s: string) => s.trim().replace(/^(["'])(.*)\1$/, '$2');
