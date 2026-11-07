/*
 * Outline data model. A flat map of nodes; each node lists its children by id.
 */

export interface Attribute {
  id: string;
  key: string;
  value: string;
}

export interface DataBlock {
  id: string;
  format: string;
  content: string;
  collapsed: boolean;
}

export interface OutlineNode {
  id: string;
  text: string;
  collapsed: boolean;
  completed: boolean;
  children: string[];
  attributes: Attribute[];
  data: DataBlock[];
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
  return { id: uid(), text, collapsed: false, completed: false, children: [], attributes: [], data: [] };
}

function normalizeNode(id: string, raw: any): OutlineNode {
  const n = raw || {};
  return {
    id,
    text: typeof n.text === 'string' ? n.text : '',
    collapsed: !!n.collapsed,
    completed: !!n.completed,
    children: Array.isArray(n.children) ? n.children.slice() : [],
    attributes: (Array.isArray(n.attributes) ? n.attributes : []).map((a: Partial<Attribute>) => ({
      id: a.id || uid(),
      key: String(a.key ?? ''),
      value: String(a.value ?? ''),
    })),
    data: (Array.isArray(n.data) ? n.data : []).map((d: Partial<DataBlock>) => ({
      id: d.id || uid(),
      format: String(d.format || 'text'),
      content: String(d.content ?? ''),
      collapsed: !!d.collapsed,
    })),
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
    // Drop dangling child references.
    for (const n of Object.values(nodes)) n.children = n.children.filter((c) => nodes[c] && c !== n.id);
    return new OutlineStore({ rootId: json.rootId, nodes });
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
    if (!n.children.length && collapsed) return false;
    if (n.collapsed === collapsed) return false;
    n.collapsed = collapsed;
    return true;
  }

  setCompleted(id: string, completed: boolean) {
    this.node(id).completed = completed;
  }

  /** Append src's text, attributes, data and children to dst, then delete src. */
  mergeInto(srcId: string, dstId: string) {
    const src = this.node(srcId);
    const dst = this.node(dstId);
    dst.text += src.text;
    dst.attributes.push(...src.attributes);
    dst.data.push(...src.data);
    for (const c of src.children.slice()) {
      this.detach(c);
      this.insert(c, dstId, -1);
    }
    src.attributes = [];
    src.data = [];
    this.remove(srcId);
  }

  // ---------- attributes

  addAttribute(id: string, key = '', value = ''): Attribute {
    const a = { id: uid(), key, value };
    this.node(id).attributes.push(a);
    return a;
  }

  updateAttribute(id: string, attrId: string, patch: Partial<Omit<Attribute, 'id'>>) {
    const a = this.node(id).attributes.find((x) => x.id === attrId);
    if (a) Object.assign(a, patch);
    return a;
  }

  removeAttribute(id: string, attrId: string): boolean {
    const list = this.node(id).attributes;
    const i = list.findIndex((x) => x.id === attrId);
    if (i >= 0) list.splice(i, 1);
    return i >= 0;
  }

  // ---------- data

  addData(id: string, format = 'markdown', content = ''): DataBlock {
    const d = { id: uid(), format, content, collapsed: false };
    this.node(id).data.push(d);
    return d;
  }

  getData(id: string, dataId: string): DataBlock | undefined {
    return this.nodes[id]?.data.find((x) => x.id === dataId);
  }

  updateData(id: string, dataId: string, patch: Partial<Omit<DataBlock, 'id'>>) {
    const d = this.getData(id, dataId);
    if (d) Object.assign(d, patch);
    return d;
  }

  removeData(id: string, dataId: string): boolean {
    const list = this.node(id).data;
    const i = list.findIndex((x) => x.id === dataId);
    if (i >= 0) list.splice(i, 1);
    return i >= 0;
  }
}
