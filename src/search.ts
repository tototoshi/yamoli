/*
 * Search query parsing and matching.
 *
 * Query syntax (terms are ANDed):
 *   word           text, attribute key/value or data content contains word
 *   "two words"    phrase
 *   key:value      an attribute named key whose value contains value
 *   key:           has an attribute named key
 *   -term          negation of any of the above
 * Matching ignores case and full-/half-width differences.
 */
import type { OutlineNode, OutlineStore } from './model';

export interface Term {
  negate: boolean;
  /** Attribute key for key:value terms; undefined for plain text terms. */
  key?: string;
  value: string;
}

export interface SearchResult {
  /** Nodes that match the query. */
  matches: Set<string>;
  /** Nodes to display: matches plus their ancestors below the view root. */
  shown: Set<string>;
}

const norm = (s: string) => s.normalize('NFKC').toLowerCase();

const TOKEN = /(-?)(?:([^\s:"]+):)?(?:"([^"]*)"?|([^\s"]*))/g;

export function parseQuery(q: string): Term[] {
  const terms: Term[] = [];
  for (const m of norm(q).matchAll(TOKEN)) {
    if (!m[0]) continue;
    const value = m[3] ?? m[4] ?? '';
    if (m[2] === undefined && !value) continue;
    terms.push({ negate: m[1] === '-', key: m[2], value });
  }
  return terms;
}

function matchTerm(n: OutlineNode, t: Term): boolean {
  if (t.key !== undefined) {
    return n.attributes.some((a) => norm(a.key) === t.key && (!t.value || norm(a.value).includes(t.value)));
  }
  return (
    norm(n.text).includes(t.value) ||
    n.attributes.some((a) => norm(a.key).includes(t.value) || norm(a.value).includes(t.value)) ||
    n.data.some((d) => norm(d.content).includes(t.value))
  );
}

export function matchNode(n: OutlineNode, terms: Term[]): boolean {
  return terms.every((t) => matchTerm(n, t) !== t.negate);
}

/** Search every descendant of viewId, including inside collapsed nodes. */
export function searchTree(store: OutlineStore, viewId: string, terms: Term[]): SearchResult {
  const result: SearchResult = { matches: new Set(), shown: new Set() };
  const walk = (id: string, ancestors: string[]) => {
    for (const c of store.node(id).children) {
      if (matchNode(store.node(c), terms)) {
        result.matches.add(c);
        result.shown.add(c);
        for (const a of ancestors) result.shown.add(a);
      }
      walk(c, [...ancestors, c]);
    }
  };
  walk(viewId, []);
  return result;
}
