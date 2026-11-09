/*
 * Links between items. A link is written `[[nodeId]]` in row text (including
 * field values); it is displayed with the target's current text, so renaming
 * the target never breaks it.
 */
import { t } from './i18n';
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
  return text || t('無題', 'Untitled');
}

const norm = (s: string) => s.normalize('NFKC').toLowerCase();

/** text with each [[id]] replaced by the label of the item it links to. */
export const withLabels = (store: OutlineStore, text: string) =>
  text.replace(REF_RE, (src, ref) => (store.get(ref) ? nodeLabel(store, ref) : src));

/**
 * Items whose label contains query, best first: prefix matches, then the
 * ones nearest to fromId in the outline (fewest steps through the tree, then
 * those just above it). For dependencies (`after`), the item's own ancestors
 * and descendants are left out, as it can't wait for them.
 */
export function linkCandidates(
  store: OutlineStore,
  query: string,
  fromId: string,
  { deps = false, limit = 8 }: { deps?: boolean; limit?: number } = {}
): string[] {
  const q = norm(query.trim());
  const self = store.get(fromId) ? store.owner(fromId) : fromId;
  const up = new Map<string, number>(); // self and its ancestors -> steps up from self
  for (let n: string | undefined = self, d = 0; n; n = store.parentOf(n), d++) up.set(n, d);
  const distance = (id: string) => {
    let d = 0;
    let n = id;
    while (!up.has(n)) {
      n = store.parentOf(n)!;
      d++;
    }
    return d + up.get(n)!;
  };

  const all = [...walk(store)];
  const at = all.indexOf(self);
  const scored: [number, number, number, string][] = [];
  all.forEach((id, order) => {
    if (id === store.rootId || id === self || !store.node(id).text.trim() || store.isData(id)) return;
    if (deps && (up.has(id) || store.isAncestor(self, id))) return;
    const pos = q ? norm(nodeLabel(store, id)).indexOf(q) : 0;
    if (pos < 0) return;
    // Above comes before below at the same distance: dependencies are usually earlier work.
    const side = order < at ? at - order : all.length + order - at;
    scored.push([pos === 0 ? 0 : 1, distance(id), side, id]);
  });
  scored.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  return scored.slice(0, limit).map((s) => s[3]);
}

/** If the caret is right after an unclosed `[[query`, where it starts and the query. */
export function pickerQueryAt(value: string, caret: number): { from: number; query: string } | null {
  const m = value.slice(0, caret).match(/\[\[([^[\]\n]*)$/);
  return m ? { from: caret - m[0].length, query: m[1] } : null;
}
