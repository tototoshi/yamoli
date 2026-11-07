/*
 * Search query parsing and matching.
 *
 * Query syntax (terms are ANDed):
 *   word           text, attribute key/value or data content contains word
 *   "two words"    phrase
 *   key:value      an attribute named key whose value contains value
 *   key:           has an attribute named key
 *   is:done        completed rows (also is:完了)
 *   is:ready       open rows whose dependencies are all done (is:着手可)
 *   is:blocked     open rows waiting on a dependency (is:待ち)
 *   is:cycle       rows on a dependency cycle (is:循環)
 *   -term          negation of any of the above
 * Matching ignores case and full-/half-width differences.
 */
import { depStatus, findCycles, type DepStatus } from './deps';
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

const DONE = new Set(['done', 'completed', '完了']);
const isDoneTerm = (t: Term) => t.key === 'is' && DONE.has(t.value);

const STATUS: Record<string, DepStatus> = {
  ready: 'ready',
  着手可: 'ready',
  blocked: 'blocked',
  待ち: 'blocked',
  cycle: 'cycle',
  循環: 'cycle',
};
const isStatusTerm = (t: Term) => t.key === 'is' && t.value in STATUS;

/** The query explicitly asks for completed rows (so they should be shown even if hidden). */
export const wantsCompleted = (terms: Term[]) => terms.some((t) => isDoneTerm(t) && !t.negate);

function matchTerm(n: OutlineNode, t: Term, status: () => DepStatus): boolean {
  if (isDoneTerm(t)) return n.completed;
  if (isStatusTerm(t)) {
    const want = STATUS[t.value];
    return status() === want && (want === 'cycle' || !n.completed);
  }
  if (t.key !== undefined) {
    return n.attributes.some((a) => norm(a.key) === t.key && (!t.value || norm(a.value).includes(t.value)));
  }
  return (
    norm(n.text).includes(t.value) ||
    n.attributes.some((a) => norm(a.key).includes(t.value) || norm(a.value).includes(t.value)) ||
    n.data.some((d) => norm(d.content).includes(t.value))
  );
}

/** `status` gives n's dependency status; only consulted for is:ready/blocked/cycle. */
export function matchNode(n: OutlineNode, terms: Term[], status: () => DepStatus = () => 'none'): boolean {
  return terms.every((t) => matchTerm(n, t, status) !== t.negate);
}

/** Search every descendant of viewId, including inside collapsed nodes. */
export function searchTree(store: OutlineStore, viewId: string, terms: Term[]): SearchResult {
  const result: SearchResult = { matches: new Set(), shown: new Set() };
  const cycles = terms.some(isStatusTerm) ? findCycles(store) : new Set<string>();
  const walk = (id: string, ancestors: string[]) => {
    for (const c of store.node(id).children) {
      if (matchNode(store.node(c), terms, () => depStatus(store, c, cycles))) {
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
