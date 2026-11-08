/*
 * Links between items. A link is written `[[nodeId]]` in row text (including
 * field values); it is displayed with the target's current text, so renaming
 * the target never breaks it.
 */
import type { OutlineStore } from './model';

const REF_RE = /\[\[([^[\]\s]+)\]\]/g;

/** Ids referenced in text (whether or not they exist). */
export function refIds(text: string): string[] {
  return [...text.matchAll(REF_RE)].map((m) => m[1]);
}

export interface Backlink {
  nodeId: string;
  /** Field the link appears in (on nodeId), or null when it is in the row text. */
  via: string | null;
}

/** All nodes in outline order, root first. */
function* walk(store: OutlineStore, id = store.rootId): Generator<string> {
  yield id;
  for (const c of store.node(id).children) yield* walk(store, c);
}

/** Nodes that link to id, in outline order. */
export function findBacklinks(store: OutlineStore, id: string): Backlink[] {
  const out: Backlink[] = [];
  const seen = new Set<string>();
  for (const nid of walk(store)) {
    if (nid === id || !refIds(store.node(nid).text).includes(id)) continue;
    // A link inside a field counts for the item that owns the field.
    const owner = store.owner(nid);
    if (owner === id) continue;
    let via: string | null = null;
    if (owner !== nid) {
      let top = nid;
      while (store.parentOf(top) !== owner) top = store.parentOf(top)!;
      via = store.node(top).key;
    }
    const k = owner + '\0' + via;
    if (!seen.has(k)) out.push({ nodeId: owner, via });
    seen.add(k);
  }
  return out;
}

/**
 * Plain one-line label for a node: links replaced by their targets' text,
 * inline markup removed.
 */
export function nodeLabel(store: OutlineStore, id: string, depth = 0): string {
  const n = store.get(id);
  if (!n) return '';
  const text = n.text
    .split('\n')[0]
    .replace(REF_RE, (src, ref) => (depth < 2 && store.get(ref) ? nodeLabel(store, ref, depth + 1) : src))
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)\s]+\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*|~~([^~]+)~~|`([^`]+)`|\*([^*\s][^*]*)\*/g, (_, a, b, c, d) => a ?? b ?? c ?? d)
    .trim();
  if (n.key !== null) return `${n.key}: ${text}`;
  return text || '無題';
}

const norm = (s: string) => s.normalize('NFKC').toLowerCase();

/** Nodes whose label contains query, best matches first. */
export function linkCandidates(store: OutlineStore, query: string, excludeId: string, limit = 8): string[] {
  const q = norm(query.trim());
  const scored: [number, number, string][] = [];
  let order = 0;
  for (const id of walk(store)) {
    order++;
    if (id === store.rootId || id === excludeId || !store.node(id).text.trim() || store.isData(id)) continue;
    const label = norm(nodeLabel(store, id));
    const at = q ? label.indexOf(q) : 0;
    if (at < 0) continue;
    scored.push([at === 0 ? 0 : 1, order, id]); // prefix matches first, then outline order
  }
  scored.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return scored.slice(0, limit).map((s) => s[2]);
}

/** If the caret is right after an unclosed `[[query`, where it starts and the query. */
export function pickerQueryAt(value: string, caret: number): { from: number; query: string } | null {
  const m = value.slice(0, caret).match(/\[\[([^[\]\n]*)$/);
  return m ? { from: caret - m[0].length, query: m[1] } : null;
}
