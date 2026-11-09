/*
 * Dependencies between items, expressed as links in an `after` field:
 *
 *   after: [[design]], [[api]]   -> this item can start once both are completed
 *
 * (or as a list: `after:` with one linked row per dependency)
 *
 *   after: ^                     -> after the item just above (its previous sibling)
 *   sequential: true             -> on a parent: each child item comes after the
 *                                   one above it, unless it has its own `after`
 *
 * The dependency graph is a DAG unless someone writes a cycle; items on a
 * cycle are reported so the UI can warn about them.
 */
import { refIds } from './links';
import type { OutlineStore } from './model';

export const DEP_KEY = 'after';
export const SEQUENTIAL_KEY = 'sequential';

export type DepStatus = 'none' | 'ready' | 'blocked' | 'cycle';

/** Items id depends on (existing, de-duplicated, never itself). */
export function dependencies(store: OutlineStore, id: string): string[] {
  const out = new Set<string>();
  const f = store.field(id, DEP_KEY);
  if (!f || !store.fieldTexts(f.id).some((t) => t.trim())) {
    const parent = store.parentOf(id);
    const prev = parent && isSequential(store, parent) ? previousItem(store, id) : null;
    return prev ? [prev] : [];
  }
  for (const text of store.fieldTexts(f.id)) {
    for (const ref of refIds(text)) if (ref !== id && store.get(ref)) out.add(ref);
    if (text.split(',').some((part) => part.trim() === '^')) {
      const prev = previousItem(store, id);
      if (prev) out.add(prev);
    }
  }
  return [...out];
}

/** The item just above id among its siblings (fields aside). */
function previousItem(store: OutlineStore, id: string): string | null {
  const parent = store.parentOf(id);
  if (!parent || store.node(id).key !== null) return null;
  const items = store.items(parent);
  return items[items.indexOf(id) - 1] ?? null;
}

const isSequential = (store: OutlineStore, id: string) =>
  /^(true|yes|on)$/i.test(store.fieldValue(id, SEQUENTIAL_KEY)?.trim() ?? '');

/** Items that depend on id. */
export function dependents(store: OutlineStore, id: string): string[] {
  return Object.keys(store.nodes).filter((n) => n !== id && dependencies(store, n).includes(id));
}

/** Ids of every item that sits on a dependency cycle (Tarjan's SCC). */
export function findCycles(store: OutlineStore): Set<string> {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const result = new Set<string>();
  let counter = 0;

  const visit = (v: string) => {
    index.set(v, counter);
    low.set(v, counter);
    counter++;
    stack.push(v);
    onStack.add(v);
    for (const w of dependencies(store, v)) {
      if (!index.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v)!, index.get(w)!));
      }
    }
    if (low.get(v) === index.get(v)) {
      const scc: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        scc.push(w);
      } while (w !== v);
      if (scc.length > 1) scc.forEach((id) => result.add(id));
    }
  };

  for (const id of Object.keys(store.nodes)) if (!index.has(id)) visit(id);
  return result;
}

export function depStatus(store: OutlineStore, id: string, cycles: Set<string>): DepStatus {
  const deps = dependencies(store, id);
  if (!deps.length) return 'none';
  if (cycles.has(id)) return 'cycle';
  return deps.every((d) => store.node(d).completed) ? 'ready' : 'blocked';
}

/** The dependencies of id that are not completed yet. */
export function blockers(store: OutlineStore, id: string): string[] {
  return dependencies(store, id).filter((d) => !store.node(d).completed);
}
