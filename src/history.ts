/*
 * Snapshot-based undo/redo. Each entry is a serialized outline plus whatever
 * the caller wants restored with it (e.g. focus).
 *
 * Consecutive records with the same coalesce key (e.g. typing in one field)
 * collapse into a single undo step until there is a pause of `mergeMs`.
 */

export interface Entry<M> {
  state: string;
  meta: M;
}

export class UndoHistory<M> {
  private undoStack: Entry<M>[] = [];
  private redoStack: Entry<M>[] = [];
  private current: string;
  private lastKey: string | null = null;
  private lastTime = 0;

  constructor(
    initial: string,
    private limit = 200,
    private mergeMs = 1000
  ) {
    this.current = initial;
  }

  /**
   * Record `next` as the current state. `meta` describes the state being
   * left behind (restored if this step is undone). Returns false if unchanged.
   */
  record(next: string, meta: M, key: string | null = null, now = Date.now()): boolean {
    if (next === this.current) return false;
    const merge = key !== null && key === this.lastKey && now - this.lastTime < this.mergeMs;
    if (!merge) {
      this.undoStack.push({ state: this.current, meta });
      if (this.undoStack.length > this.limit) this.undoStack.shift();
    }
    this.redoStack = [];
    this.current = next;
    this.lastKey = key;
    this.lastTime = now;
    return true;
  }

  /** Step back. `meta` describes the state being left (restored on redo). */
  undo(meta: M): Entry<M> | null {
    return this.step(this.undoStack, this.redoStack, meta);
  }

  redo(meta: M): Entry<M> | null {
    return this.step(this.redoStack, this.undoStack, meta);
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }

  get canRedo() {
    return this.redoStack.length > 0;
  }

  private step(from: Entry<M>[], to: Entry<M>[], meta: M): Entry<M> | null {
    const e = from.pop();
    if (!e) return null;
    to.push({ state: this.current, meta });
    this.current = e.state;
    this.lastKey = null;
    return e;
  }
}
