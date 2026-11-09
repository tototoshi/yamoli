/*
 * The outline as plain data, for the YAML and JSON views.
 *
 * Field rows are already YAML: `key: value`, an object (field children) or a
 * list (plain children). An item is its text alone when that is all it has,
 * otherwise an object:
 *
 *   id: 52e815d313f8      when something links to it ([[id]])
 *   text: 要件定義
 *   done: true            when completed
 *   duration: 3d          its fields
 *   children: [...]       its sub-items
 *
 * A block is its text, tagged with the format in YAML (`note: !markdown |`).
 * Only linked items carry their id, so references resolve without every item
 * being cluttered. A field named like one of those keys wins, and the item's
 * own entry gets a leading `_` instead.
 */
import { refIds, withLabels } from './links';
import type { OutlineStore } from './model';

export type Value = string | number | boolean | null | Tagged | Value[] | { [key: string]: Value };

/** A block's text with its format: `!format` in YAML, the plain string in JSON. */
export class Tagged {
  constructor(
    readonly tag: string,
    readonly value: string
  ) {}
  toJSON() {
    return this.value;
  }
}

/** The item (or field) as data; the root gives the list of top-level items. */
export function toValue(store: OutlineStore, id: string): Value {
  const linked = linkedIds(store);
  if (id === store.rootId) return store.items(id).map((c) => itemValue(store, c, linked));
  const n = store.node(id);
  if (n.key !== null) return { [n.key]: rowValue(store, id) };
  return store.isData(id) ? rowValue(store, id) : itemValue(store, id, linked);
}

/** Items some row or field links to. */
function linkedIds(store: OutlineStore): Set<string> {
  const ids = new Set<string>();
  for (const n of Object.values(store.toJSON().nodes)) for (const r of refIds(n.text)) ids.add(r);
  return ids;
}

function itemValue(store: OutlineStore, id: string, linked: Set<string>): Value {
  const n = store.node(id);
  const fields = n.children.filter((c) => store.isField(c));
  const items = store.items(id);
  const hasId = linked.has(id);
  if (!fields.length && !items.length && !n.completed && !hasId) return n.text;

  const fieldValues: Record<string, Value> = {};
  for (const f of fields) fieldValues[store.node(f).key!] = rowValue(store, f);
  // id, text and done on top, then the fields, then sub-items.
  const out: Record<string, Value> = {};
  const own = (k: string, v: Value) => {
    while (k in fieldValues) k = '_' + k;
    out[k] = v;
  };
  if (hasId) own('id', id);
  own('text', n.text);
  if (n.completed) own('done', true);
  Object.assign(out, fieldValues);
  if (items.length) own('children', items.map((c) => itemValue(store, c, linked)));
  return out;
}

/** A field's value, or a row inside one (a list element). */
function rowValue(store: OutlineStore, id: string): Value {
  const n = store.node(id);
  const kids = n.children;
  if (n.format !== null) return n.format === 'text' ? n.text : new Tagged(n.format, n.text);
  if (!kids.length) return n.key !== null && !n.text.trim() ? null : scalar(n.text);
  const inner = childrenValue(store, kids);
  // A value and children at once (an unusual list element): `text: children`.
  return n.text.trim() ? { [n.text.trim()]: inner } : inner;
}

/** Field children make an object, plain ones a list; mixed, a list. */
function childrenValue(store: OutlineStore, kids: string[]): Value {
  if (kids.every((c) => store.isField(c))) {
    const obj: Record<string, Value> = {};
    for (const c of kids) obj[store.node(c).key!] = rowValue(store, c);
    return obj;
  }
  return kids.map((c) => (store.isField(c) ? { [store.node(c).key!]: rowValue(store, c) } : rowValue(store, c)));
}

/** Field text as a YAML scalar would read: numbers and booleans, else the string. */
function scalar(text: string): Value {
  const t = text.trim();
  if (/^-?(0|[1-9]\d*)(\.\d+)?$/.test(t)) return Number(t);
  if (t === 'true' || t === 'false') return t === 'true';
  return t;
}

// ---------------------------------------------------------------- Markdown list

/**
 * The rows under id as a nested Markdown list, for pasting elsewhere: links
 * become the linked item's label, completed items are struck through and
 * fields read `name: value`. Blocks (multi-line values) are left out.
 * children(id) picks the rows to include, so the view's filters apply.
 */
export function toMarkdownList(store: OutlineStore, id: string, children: (id: string) => string[]): string {
  const lines: string[] = [];
  const add = (c: string, depth: number) => {
    const n = store.node(c);
    if (n.format !== null) return;
    const pad = '  '.repeat(depth);
    let text = withLabels(store, n.text).trim();
    if (n.key !== null) text = `${n.key}: ${text}`.trimEnd();
    else if (n.completed && text) text = `~~${text}~~`;
    lines.push(`${pad}- ${text}`.trimEnd().replace(/\n/g, `\n${pad}  `));
    for (const k of children(c)) add(k, depth + 1);
  };
  for (const c of children(id)) add(c, 0);
  return lines.length ? lines.join('\n') + '\n' : '';
}

// ---------------------------------------------------------------- YAML

export function toYaml(v: Value): string {
  return block(v, 0).replace(/^\n/, '') + '\n';
}

const isObj = (v: Value): v is Record<string, Value> =>
  !!v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Tagged);
const isEmpty = (v: Value) => (Array.isArray(v) ? !v.length : isObj(v) && !Object.keys(v).length);

/** A value placed after `key:` or `- `: inline for scalars, else on the following lines. */
function block(v: Value, indent: number): string {
  const pad = ' '.repeat(indent);
  if (Array.isArray(v) && v.length) {
    return v
      .map((x) => {
        if (isObj(x) && !isEmpty(x)) {
          // `- key: …` with the object's other keys aligned under the first.
          const body = block(x, indent + 2).replace(/^\n */, '');
          return `\n${pad}- ${body}`;
        }
        return `\n${pad}-${inline(x, indent + 2)}`;
      })
      .join('');
  }
  if (isObj(v) && !isEmpty(v)) {
    return Object.entries(v)
      .map(([k, x]) => `\n${pad}${str(k)}:${inline(x, indent + 2)}`)
      .join('');
  }
  return inline(v, indent);
}

/** After `key:` / `-`: ` scalar`, a block scalar, or a nested block. */
function inline(v: Value, indent: number): string {
  if (v === null) return '';
  if (v instanceof Tagged) return ` !${v.tag}` + inline(v.value, indent);
  if (Array.isArray(v) || isObj(v)) return isEmpty(v) ? (Array.isArray(v) ? ' []' : ' {}') : block(v, indent);
  if (typeof v === 'string' && v.includes('\n') && !/^\s/.test(v) && !/[ \t]$/m.test(v)) {
    const pad = ' '.repeat(indent);
    const chomp = v.endsWith('\n') ? '' : '-';
    return ` |${chomp}\n` + v.replace(/\n$/, '').split('\n').map((l) => (l ? pad + l : '')).join('\n');
  }
  return ' ' + str(v);
}

/** A scalar, quoted when plain YAML would read it differently. */
function str(v: string | number | boolean): string {
  if (typeof v !== 'string') return String(v);
  const plain =
    v !== '' &&
    !/^[\s\-?:,[\]{}#&*!|>'"%@`]/.test(v) &&
    !/\s$/.test(v) &&
    !/: |:$| #|[\n\t]/.test(v) &&
    !/^(true|false|null|~|yes|no|on|off|-?[\d.]+(e[+-]?\d+)?|0x[\da-f]+|\.inf|\.nan)$/i.test(v);
  return plain ? v : JSON.stringify(v);
}
