/*
 * Dependencies between items, expressed as links in an `after` field:
 *
 *   after: [[design]], [[api]]   -> this item can start once both are completed
 *
 * (or as a list: `after:` with one linked row per dependency)
 *
 * The dependency graph is a DAG unless someone writes a cycle; items on a
 * cycle are reported so the UI can warn about them.
 */
import { addRef, refIds, removeRef } from './links';
import type { OutlineStore } from './model';

export const DEP_KEY = 'after';

export type DepStatus = 'none' | 'ready' | 'blocked' | 'cycle';

/** Items id depends on (existing, de-duplicated, never itself). */
export function dependencies(store: OutlineStore, id: string): string[] {
  const f = store.field(id, DEP_KEY);
  if (!f) return [];
  const out = new Set<string>();
  for (const text of store.fieldTexts(f.id)) for (const ref of refIds(text)) if (ref !== id && store.get(ref)) out.add(ref);
  return [...out];
}

/** Make id wait for dep: a link to it added to id's `after` (inline, or as a row when it is a list). */
export function addDependency(store: OutlineStore, id: string, dep: string) {
  if (!dependencies(store, id).includes(dep)) addRef(store, id, DEP_KEY, dep);
}

/** Stop id waiting for dep: the links to it taken out of id's `after`, and the field once nothing is left. */
export function removeDependency(store: OutlineStore, id: string, dep: string) {
  const f = store.field(id, DEP_KEY);
  if (f) removeRef(store, f.id, dep);
}

/** Whether making id wait for dep would close a cycle (dep already waits for id, however indirectly). */
export function wouldCycle(store: OutlineStore, id: string, dep: string): boolean {
  const seen = new Set<string>();
  const stack = [dep];
  while (stack.length) {
    const n = stack.pop()!;
    if (n === id) return true;
    if (seen.has(n)) continue;
    seen.add(n);
    stack.push(...dependencies(store, n));
  }
  return false;
}

/** Links in id's `after` to items that no longer exist (deleted since), which hold nothing up. */
export function missingDependencies(store: OutlineStore, id: string): string[] {
  const f = store.field(id, DEP_KEY);
  if (!f) return [];
  return [...new Set(store.fieldTexts(f.id).flatMap(refIds))].filter((ref) => !store.get(ref));
}

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
