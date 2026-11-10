/*
 * Reading `key: value` rows and indented text (YAML, nested lists) for the
 * outline-as-YAML model (see model.ts).
 */

/**
 * A row being typed as `name: ` (name without spaces), caught right after the
 * space so ordinary text is only converted when the user just typed it.
 */
export const FIELD_TYPED = /^([^\s:][^\s:]{0,39}): /;

/** A `name: value` line (name without spaces), or `name:` alone. */
const FIELD_LINE = /^([^\s:][^\s:]{0,39}):(?:\s+(.*))?$/;

export interface TextRow {
  key: string | null;
  text: string;
  children: TextRow[];
  /** A block field's format (`key: !markdown |`). */
  format?: string;
  /** A checklist line: `- [ ]` open, `- [x]` done. */
  task?: 'open' | 'done';
}

/** A field value opening a block scalar: `|`, `|-`, `>` …, optionally tagged `!format`. */
const BLOCK_START = /^(?:!([\w-]+)\s+)?[|>][-+]?\d?\s*$/;
/** A tagged single-line value: `!markdown **bold**`. */
const TAGGED = /^!([\w-]+)\s+(.*)$/;

/**
 * Indented lines to a tree. Indentation (spaces or tabs) nests; list markers
 * (`- `, `* `, `1. `) are dropped; `name: value` lines become fields. A list
 * item written `- name: value` starts an object: the item is an unnamed row
 * holding that field, and further lines at the field's indentation join it.
 * A block scalar (`name: |` or `name: !markdown |` and the lines indented
 * below it) becomes a block field.
 */
export function parseOutlineText(text: string): TextRow[] {
  const root: TextRow = { key: null, text: '', children: [] };
  const stack: { indent: number; row: TextRow }[] = [{ indent: -1, row: root }];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim() || /^\s*#/.test(raw)) continue;
    let indent = raw.match(/^[ \t]*/)![0].replace(/\t/g, '  ').length;
    let line = raw.trim();
    const marker = line.match(/^(?:[-*+]|\d+[.)])\s+/);
    if (marker) line = line.slice(marker[0].length);
    const check = marker ? line.match(/^\[([ xX])\]\s+/) : null;
    if (check) line = line.slice(check[0].length);
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop();
    const parent = stack[stack.length - 1].row;
    const field = line.match(FIELD_LINE);
    if (marker && field) {
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
    if (field) i = readBlock(lines, i, indent, row);
    parent.children.push(row);
    stack.push({ indent, row });
  }
  return root.children;
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
