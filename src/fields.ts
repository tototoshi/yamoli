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
}

/**
 * Indented lines to a tree. Indentation (spaces or tabs) nests; list markers
 * (`- `, `* `, `1. `) are dropped; `name: value` lines become fields. A list
 * item written `- name: value` starts an object: the item is an unnamed row
 * holding that field, and further lines at the field's indentation join it.
 */
export function parseOutlineText(text: string): TextRow[] {
  const root: TextRow = { key: null, text: '', children: [] };
  const stack: { indent: number; row: TextRow }[] = [{ indent: -1, row: root }];
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (!raw.trim() || /^\s*#/.test(raw)) continue;
    let indent = raw.match(/^[ \t]*/)![0].replace(/\t/g, '  ').length;
    let line = raw.trim();
    const marker = line.match(/^(?:[-*+]|\d+[.)])\s+/);
    if (marker) line = line.slice(marker[0].length);
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
      item.children.push(row);
      stack.push({ indent, row });
      // Sibling fields of this object are indented to `indent`; pop to the item for them.
      stack[stack.length - 1].indent = indent;
      stack[stack.length - 2].indent = indent - 1;
      continue;
    }
    const row = field ? fieldRow(field) : { key: null, text: line, children: [] };
    parent.children.push(row);
    stack.push({ indent, row });
  }
  return root.children;
}

const fieldRow = (m: RegExpMatchArray): TextRow => ({ key: m[1], text: unquote(m[2] ?? ''), children: [] });

const unquote = (s: string) => s.trim().replace(/^(["'])(.*)\1$/, '$2');
