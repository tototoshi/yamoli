/*
 * Undo/redo by differences. A state is a map of parts (for the outline: one
 * serialized node per id); each step keeps only the parts that changed, so
 * a long history of small edits stays small however big the outline is.
 * Each step also carries whatever the caller wants restored with it (e.g.
 * focus).
 *
 * Consecutive records with the same coalesce key (e.g. typing in one field)
 * collapse into a single undo step until there is a pause of `mergeMs`.
 */

export type State = ReadonlyMap<string, string>;

/** What a step changed: each part's value before and after (undefined: absent). */
type Patch = Map<string, { before: string | undefined; after: string | undefined }>;

interface Step<M> {
  patch: Patch;
  meta: M;
}

export interface Entry<M> {
  state: State;
  meta: M;
}

export class UndoHistory<M> {
  private undoStack: Step<M>[] = [];
  private redoStack: Step<M>[] = [];
  private current: Map<string, string>;
  private lastKey: string | null = null;
  private lastTime = 0;

  constructor(
    initial: State,
    private limit = 200,
    private mergeMs = 1000
  ) {
    this.current = new Map(initial);
  }

  /**
   * Record `next` as the current state. `meta` describes the state being
   * left behind (restored if this step is undone). Returns false if unchanged.
   */
  record(next: State, meta: M, key: string | null = null, now = Date.now()): boolean {
    const patch: Patch = new Map();
    for (const [k, v] of next) if (this.current.get(k) !== v) patch.set(k, { before: this.current.get(k), after: v });
    for (const [k, v] of this.current) if (!next.has(k)) patch.set(k, { before: v, after: undefined });
    if (!patch.size) return false;
    const merge = key !== null && key === this.lastKey && now - this.lastTime < this.mergeMs && this.undoStack.length > 0;
    if (merge) {
      // One step from before the first of them to after the last.
      const top = this.undoStack[this.undoStack.length - 1].patch;
      for (const [k, { before, after }] of patch) top.set(k, { before: top.has(k) ? top.get(k)!.before : before, after });
    } else {
      this.undoStack.push({ patch, meta });
      if (this.undoStack.length > this.limit) this.undoStack.shift();
    }
    apply(this.current, patch, 'after');
    this.redoStack = [];
    this.lastKey = key;
    this.lastTime = now;
    return true;
  }

  /** Step back. `meta` describes the state being left (restored on redo). */
  undo(meta: M): Entry<M> | null {
    return this.step(this.undoStack, this.redoStack, 'before', meta);
  }

  redo(meta: M): Entry<M> | null {
    return this.step(this.redoStack, this.undoStack, 'after', meta);
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }

  get canRedo() {
    return this.redoStack.length > 0;
  }

  private step(from: Step<M>[], to: Step<M>[], side: 'before' | 'after', meta: M): Entry<M> | null {
    const s = from.pop();
    if (!s) return null;
    apply(this.current, s.patch, side);
    to.push({ patch: s.patch, meta });
    this.lastKey = null;
    return { state: this.current, meta: s.meta };
  }
}

function apply(state: Map<string, string>, patch: Patch, side: 'before' | 'after') {
  for (const [k, change] of patch) {
    const v = change[side];
    if (v === undefined) state.delete(k);
    else state.set(k, v);
  }
}
