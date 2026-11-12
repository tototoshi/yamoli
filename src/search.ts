/*
 * Search query parsing and matching.
 *
 * Query syntax (terms are ANDed):
 *   word           text or field name contains word (block contents too)
 *   "two words"    phrase
 *   key:value      a field named key whose value contains value
 *                  (key.sub:value looks inside an object field)
 *   key:           has a field named key
 *   is:done        completed rows (also is:完了)
 *   is:task        tasks: marked so, completed or scheduled (is:タスク)
 *   is:todo        open tasks (is:未完了)
 *   is:ready       open rows whose dependencies are all done (is:着手可)
 *   is:blocked     open rows waiting on a dependency (is:待ち)
 *   is:cycle       rows on a dependency cycle (is:循環)
 *   is:late        open rows scheduled to finish after their due date (is:遅延)
 *   is:critical    tasks on the critical chain (is:クリティカル)
 *   is:milestone   zero-length tasks (is:マイルストーン)
 *   -term          negation of any of the above
 * Matching ignores case and full-/half-width differences.
 */
import { depStatus, findCycles, type DepStatus } from './deps';
import type { OutlineNode, OutlineStore } from './model';
import { computeSchedule, type Sched } from './schedule';

export interface Term {
  negate: boolean;
  /** Field name (or dotted path) for key:value terms; undefined for plain text terms. */
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

const TASK: Record<string, (task: boolean, n: OutlineNode) => boolean> = {
  task: (task) => task,
  タスク: (task) => task,
  todo: (task, n) => task && !n.completed,
  未完了: (task, n) => task && !n.completed,
};
const isTaskTerm = (t: Term) => t.key === 'is' && t.value in TASK;

const STATUS: Record<string, DepStatus> = {
  ready: 'ready',
  着手可: 'ready',
  blocked: 'blocked',
  待ち: 'blocked',
  cycle: 'cycle',
  循環: 'cycle',
};
const isStatusTerm = (t: Term) => t.key === 'is' && t.value in STATUS;

const SCHED: Record<string, (s: Sched, n: OutlineNode) => boolean> = {
  late: (s, n) => s.late > 0 && !n.completed,
  遅延: (s, n) => s.late > 0 && !n.completed,
  critical: (s) => s.critical && s.kind !== 'summary',
  クリティカル: (s) => s.critical && s.kind !== 'summary',
  milestone: (s) => s.kind === 'milestone',
  マイルストーン: (s) => s.kind === 'milestone',
};
const isSchedTerm = (t: Term) => t.key === 'is' && t.value in SCHED;

/** Lazily computed facts about a node that some terms need. */
export interface MatchContext {
  status: () => DepStatus;
  sched: () => Sched | undefined;
  /** The texts of the field at a path of names under the node, or null if there is none. */
  field: (path: string[]) => string[] | null;
  /** Whether the node is a task (OutlineStore.isTask). */
  task: () => boolean;
}

const NO_CONTEXT: MatchContext = { status: () => 'none', sched: () => undefined, field: () => null, task: () => false };

/** The query explicitly asks for completed rows (so they should be shown even if hidden). */
export const wantsCompleted = (terms: Term[]) => terms.some((t) => isDoneTerm(t) && !t.negate);

function matchTerm(n: OutlineNode, t: Term, ctx: MatchContext): boolean {
  if (isDoneTerm(t)) return n.completed;
  if (isTaskTerm(t)) return TASK[t.value](ctx.task(), n);
  if (isStatusTerm(t)) {
    const want = STATUS[t.value];
    return ctx.status() === want && (want === 'cycle' || !n.completed);
  }
  if (isSchedTerm(t)) {
    const s = ctx.sched();
    return !!s && SCHED[t.value](s, n);
  }
  if (t.key !== undefined) {
    const texts = ctx.field(t.key.split('.'));
    return !!texts && (!t.value || texts.some((x) => norm(x).includes(t.value)));
  }
  return norm(n.text).includes(t.value) || (n.key !== null && norm(n.key).includes(t.value));
}

export function matchNode(n: OutlineNode, terms: Term[], ctx: MatchContext = NO_CONTEXT): boolean {
  return terms.every((t) => matchTerm(n, t, ctx) !== t.negate);
}

/** Search every descendant of viewId, including inside collapsed nodes. */
export function searchTree(
  store: OutlineStore,
  viewId: string,
  terms: Term[],
  jpDays: ReadonlyMap<string, string> | null = null
): SearchResult {
  const result: SearchResult = { matches: new Set(), shown: new Set() };
  const needsDeps = terms.some((t) => isStatusTerm(t) || isSchedTerm(t));
  const cycles = needsDeps ? findCycles(store) : new Set<string>();
  const schedule = terms.some(isSchedTerm) ? computeSchedule(store, cycles, jpDays) : null;
  const walk = (id: string, ancestors: string[]) => {
    for (const c of store.node(id).children) {
      const ctx: MatchContext = {
        status: () => depStatus(store, c, cycles),
        sched: () => schedule?.byId.get(c),
        field: (path) => {
          const f = store.fieldAt(c, path);
          return f ? store.fieldTexts(f.id) : null;
        },
        task: () => store.isTask(c),
      };
      if (matchNode(store.node(c), terms, ctx)) {
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
