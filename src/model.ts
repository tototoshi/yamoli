/*
 * Outline data model. A flat map of nodes; each node lists its children by id.
 *
 * The outline doubles as YAML: a row with a key (`key: value`) is a field of
 * its parent, its text being the value. A field without a value holds an
 * object (field children) or a list (plain children):
 *
 *   ・project                 project:
 *     ・start: 2026-11-09       start: 2026-11-09
 *     ・budget:                 budget:
 *       ・amount: 1200000         amount: 1200000
 *     ・links:                  links:
 *       ・https://…               - https://…
 *     ・design                (a sub-item, not a field)
 *
 * Rows inside a field are data; the rest are items. An item is a task (something
 * to do, rather than a note) when marked so, completed, or scheduled (`duration`,
 * `due`).
 *
 * A field with a format is a block: its value is multi-line text shown as
 * that format (Markdown, CSV, code, …), YAML's `key: !markdown |`.
 */

export interface OutlineNode {
  id: string;
  text: string;
  collapsed: boolean;
  completed: boolean;
  /** Marked as something to do. */
  task: boolean;
  children: string[];
  /** Set on field rows: the field's name. null on ordinary rows. */
  key: string | null;
  /** Set on block fields: how the multi-line value is shown. */
  format: string | null;
}

export interface OutlineJSON {
  version: number;
  rootId: string;
  nodes: Record<string, OutlineNode>;
}

export function uid(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 12);
}

function makeNode(text = ''): OutlineNode {
  return { id: uid(), text, collapsed: false, completed: false, task: false, children: [], key: null, format: null };
}

function normalizeNode(id: string, raw: any): OutlineNode {
  const n = raw || {};
  return {
    id,
    text: typeof n.text === 'string' ? n.text : '',
    collapsed: !!n.collapsed,
    completed: !!n.completed,
    task: !!n.task,
    children: Array.isArray(n.children) ? n.children.slice() : [],
    key: typeof n.key === 'string' ? n.key : null,
    format: typeof n.key === 'string' && typeof n.format === 'string' ? n.format : null,
  };
}

export class OutlineStore {
  rootId: string;
  nodes: Record<string, OutlineNode>;
  private parent: Record<string, string> = {};

  constructor(state: { rootId: string; nodes: Record<string, OutlineNode> }) {
    this.rootId = state.rootId;
    this.nodes = state.nodes;
    this.reindex();
  }

  static create(rootText = 'Home'): OutlineStore {
    const root = makeNode(rootText);
    root.id = 'root';
    return new OutlineStore({ rootId: 'root', nodes: { root } });
  }

    static fromJSON(json: any): OutlineStore {
    if (!json || typeof json !== 'object' || !json.nodes || !json.rootId || !json.nodes[json.rootId]) {
      throw new Error('Invalid outline data');
    }
    const nodes: Record<string, OutlineNode> = {};
    for (const [id, raw] of Object.entries(json.nodes)) nodes[id] = normalizeNode(id, raw);
    // Earlier versions kept attributes on the node: they become field rows
    // at the top of its children.
    for (const [id, raw] of Object.entries<any>(json.nodes)) {
      if (!Array.isArray(raw?.attributes) || !raw.attributes.length) continue;
      const fields = raw.attributes.map((a: any) => {
        const f = makeNode(String(a?.value ?? ''));
        f.key = String(a?.key ?? '').trim();
        nodes[f.id] = f;
        return f.id;
      });
      nodes[id].children.unshift(...fields);
    }
    // Drop dangling child references.
    for (const n of Object.values(nodes)) n.children = n.children.filter((c) => nodes[c] && c !== n.id);
    const store = new OutlineStore({ rootId: json.rootId, nodes });
    // Earlier versions had data blocks beside the fields: they become blocks
    // named after their format (plain text as `note`, since an item's own
    // `text` has that name in YAML), and JSON becomes nested fields.
    for (const [id, raw] of Object.entries<any>(json.nodes)) {
      if (!nodes[id] || !Array.isArray(raw?.data)) continue;
      for (const d of raw.data) {
        const format = String(d?.format || 'text');
        const content = String(d?.content ?? '');
        const key = store.freeKey(id, format === 'text' ? 'note' : format);
        let parsed: unknown;
        try {
          parsed = format === 'json' ? JSON.parse(content) : undefined;
        } catch {
          // not JSON after all: kept as code below
        }
        if (parsed !== undefined) addValue(store, store.addField(id, key).id, parsed);
        else store.addBlock(id, key, format === 'json' ? 'code' : format, content).collapsed = !!d?.collapsed;
      }
    }
    return store;
  }

  toJSON(): OutlineJSON {
    return { version: 1, rootId: this.rootId, nodes: this.nodes };
  }

  private reindex() {
    this.parent = {};
    for (const n of Object.values(this.nodes)) {
      for (const c of n.children) this.parent[c] = n.id;
    }
  }

  // ---------- queries

  get(id: string): OutlineNode | undefined {
    return this.nodes[id];
  }

  /** Like get(), for ids known to exist. */
  node(id: string): OutlineNode {
    const n = this.nodes[id];
    if (!n) throw new Error(`Unknown node ${id}`);
    return n;
  }

  parentOf(id: string): string | undefined {
    return this.parent[id];
  }

  siblings(id: string): string[] {
    const p = this.parent[id];
    return p ? this.node(p).children : [];
  }

  indexOf(id: string): number {
    return this.siblings(id).indexOf(id);
  }

  /** Ancestors from the root down to (and including) id. */
  path(id: string): string[] {
    const out: string[] = [];
    for (let cur: string | undefined = id; cur; cur = this.parent[cur]) out.unshift(cur);
    return out;
  }

  isAncestor(ancestorId: string, id: string): boolean {
    for (let cur = this.parent[id]; cur; cur = this.parent[cur]) {
      if (cur === ancestorId) return true;
    }
    return false;
  }

  /** Depth-first list of node ids visible beneath viewId (respecting collapsed state). */
  visible(viewId: string): string[] {
    const out: string[] = [];
    const walk = (id: string) => {
      for (const c of this.node(id).children) {
        out.push(c);
        if (!this.node(c).collapsed) walk(c);
      }
    };
    walk(viewId);
    return out;
  }

  // ---------- structure

  private insert(id: string, parentId: string, index: number) {
    const kids = this.node(parentId).children;
    if (index < 0 || index > kids.length) index = kids.length;
    kids.splice(index, 0, id);
    this.parent[id] = parentId;
  }

  private detach(id: string) {
    const p = this.parent[id];
    if (!p) return;
    const kids = this.node(p).children;
    kids.splice(kids.indexOf(id), 1);
    delete this.parent[id];
  }

  addChild(parentId: string, index = -1, text = ''): OutlineNode {
    const n = makeNode(text);
    this.nodes[n.id] = n;
    this.insert(n.id, parentId, index);
    this.node(parentId).collapsed = false;
    return n;
  }

  addSiblingAfter(id: string, text = ''): OutlineNode {
    return this.addChild(this.parent[id], this.indexOf(id) + 1, text);
  }

  addSiblingBefore(id: string, text = ''): OutlineNode {
    return this.addChild(this.parent[id], this.indexOf(id), text);
  }

  setText(id: string, text: string) {
    this.node(id).text = text;
  }

  /**
   * Copy id and its subtree right after it. Links ([[id]]) between items
   * inside the copy point to the copies, so e.g. dependencies within a
   * duplicated project stay within it.
   */
  duplicate(id: string): OutlineNode | null {
    if (id === this.rootId) return null;
    const ids = new Map<string, string>();
    const collect = (nid: string) => {
      ids.set(nid, uid());
      this.node(nid).children.forEach(collect);
    };
    collect(id);
    const relink = (s: string) => s.replace(/\[\[([^[\]\s]+)\]\]/g, (m, ref) => (ids.has(ref) ? `[[${ids.get(ref)}]]` : m));
    for (const [from, to] of ids) {
      const n = this.node(from);
      this.nodes[to] = {
        ...n,
        id: to,
        text: relink(n.text),
        children: n.children.map((c) => ids.get(c)!),
      };
      this.parent[to] = from === id ? this.parent[id] : ids.get(this.parent[from])!;
    }
    const copy = ids.get(id)!;
    this.node(this.parent[id]).children.splice(this.indexOf(id) + 1, 0, copy);
    return this.node(copy);
  }

  /** Number of items below id. */
  descendantCount(id: string): number {
    return this.node(id).children.reduce((sum, c) => sum + 1 + this.descendantCount(c), 0);
  }

  remove(id: string): boolean {
    if (id === this.rootId) return false;
    this.detach(id);
    const drop = (nid: string) => {
      for (const c of this.node(nid).children) drop(c);
      delete this.nodes[nid];
      delete this.parent[nid];
    };
    drop(id);
    return true;
  }

  /** Make id the last child of its previous sibling. */
  indent(id: string): boolean {
    const idx = this.indexOf(id);
    if (idx <= 0) return false;
    const prev = this.siblings(id)[idx - 1];
    this.detach(id);
    this.insert(id, prev, -1);
    this.node(prev).collapsed = false;
    return true;
  }

  /** Move id to just after its parent. Never moves above viewId (the zoomed node). */
  outdent(id: string, viewId = this.rootId): boolean {
    const p = this.parent[id];
    if (!p || p === viewId) return false;
    const gp = this.parent[p];
    if (!gp) return false;
    this.detach(id);
    this.insert(id, gp, this.node(gp).children.indexOf(p) + 1);
    return true;
  }

  /**
   * Move id (with its subtree) under parentId, just before sibling beforeId
   * (or at the end when null). Refuses moves into its own subtree and no-op moves.
   */
  moveTo(id: string, parentId: string, beforeId: string | null): boolean {
    if (id === this.rootId || id === parentId || this.isAncestor(id, parentId) || beforeId === id) return false;
    const kids = this.node(parentId).children;
    if (this.parent[id] === parentId && (kids[kids.indexOf(id) + 1] ?? null) === beforeId) return false;
    this.detach(id);
    this.insert(id, parentId, beforeId ? kids.indexOf(beforeId) : -1);
    this.node(parentId).collapsed = false;
    return true;
  }

  /** Swap with the previous (delta=-1) or next (delta=1) sibling. */
  move(id: string, delta: -1 | 1): boolean {
    const kids = this.siblings(id);
    const i = kids.indexOf(id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= kids.length) return false;
    [kids[i], kids[j]] = [kids[j], kids[i]];
    return true;
  }

  setCollapsed(id: string, collapsed: boolean): boolean {
    const n = this.node(id);
    if (!n.children.length && n.format === null && collapsed) return false; // a block folds its text
    if (n.collapsed === collapsed) return false;
    n.collapsed = collapsed;
    return true;
  }

  setCompleted(id: string, completed: boolean) {
    this.node(id).completed = completed;
  }

  /** Append src's text, data and children to dst, then delete src. */
  mergeInto(srcId: string, dstId: string) {
    const src = this.node(srcId);
    const dst = this.node(dstId);
    dst.text += src.text;
    for (const c of src.children.slice()) {
      this.detach(c);
      this.insert(c, dstId, -1);
    }
    this.remove(srcId);
  }

  // ---------- tasks

  /** Whether id is something to do: marked as a task, completed, or scheduled (`duration`, `due`). */
  isTask(id: string): boolean {
    const n = this.node(id);
    if (n.key !== null || id === this.rootId || this.isData(id)) return false;
    return n.task || n.completed || !!this.field(id, 'duration') || !!this.field(id, 'due');
  }

  setTask(id: string, task: boolean): boolean {
    const n = this.node(id);
    if (n.task === task) return false;
    n.task = task;
    return true;
  }

  // ---------- fields

  isField(id: string): boolean {
    return this.node(id).key !== null;
  }

  /** Inside a field (or one itself): part of a value rather than an item. */
  isData(id: string): boolean {
    for (let n: string | undefined = id; n; n = this.parent[n]) if (this.node(n).key !== null) return true;
    return false;
  }

  /** The item a data row belongs to (id itself for items). */
  owner(id: string): string {
    let n = id;
    while (this.isData(n) && this.parent[n]) n = this.parent[n];
    return n;
  }

  /** Children that are items rather than fields. */
  items(id: string): string[] {
    return this.node(id).children.filter((c) => this.node(c).key === null);
  }

  /** The field named key directly under id (names compare trimmed, case-insensitively). */
  field(id: string, key: string): OutlineNode | undefined {
    const want = key.trim().toLowerCase();
    for (const c of this.node(id).children) {
      const k = this.node(c).key;
      if (k !== null && k.trim().toLowerCase() === want) return this.node(c);
    }
    return undefined;
  }

  /** The field at a path of names, e.g. ['budget', 'amount']. */
  fieldAt(id: string, path: string[]): OutlineNode | undefined {
    let n: OutlineNode | undefined = this.node(id);
    for (const key of path) n = n && this.field(n.id, key);
    return n;
  }

  /** A field's trimmed value; undefined when missing or empty. */
  fieldValue(id: string, key: string): string | undefined {
    return this.field(id, key)?.text.trim() || undefined;
  }

  /** The text of a field and everything inside it (for searching and links). */
  fieldTexts(id: string): string[] {
    const n = this.node(id);
    return [n.text, ...n.children.flatMap((c) => [this.node(c).key ?? '', ...this.fieldTexts(c)])];
  }

  /** Add a field to id, after its existing fields. */
  addField(id: string, key: string, value = ''): OutlineNode {
    const kids = this.node(id).children;
    let at = 0;
    kids.forEach((c, i) => this.node(c).key !== null && (at = i + 1));
    const f = this.addChild(id, at, value);
    f.key = key;
    return f;
  }

  /** Turn a row into a field (key) or back into an ordinary row (null). */
  setKey(id: string, key: string | null) {
    this.node(id).key = key;
  }

  /** Add a block (a multi-line field) to id, after its existing fields. */
  addBlock(id: string, key: string, format = 'markdown', content = ''): OutlineNode {
    const f = this.addField(id, key, content);
    f.format = format;
    return f;
  }

  /** A field name like key that id doesn't use yet: note, note2, … */
  freeKey(id: string, key: string): string {
    let k = key;
    for (let i = 2; this.field(id, k); i++) k = key + i;
    return k;
  }

  /** Make a field a block of the given format, or a plain field (null). */
  setFormat(id: string, format: string | null) {
    this.node(id).format = format;
  }
}

/** Write a JSON value into the field or row id as YAML-style rows. */
function addValue(store: OutlineStore, id: string, v: unknown) {
  if (Array.isArray(v)) {
    for (const x of v) addValue(store, store.addChild(id, -1).id, x);
  } else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) addValue(store, store.addField(id, k).id, x);
  } else {
    store.setText(id, v === null ? '' : String(v));
  }
}
