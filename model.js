/*
 * Outline data model.
 *
 * Node shape:
 *   {
 *     id, text, collapsed,
 *     children:   [nodeId, ...],
 *     attributes: [{ id, key, value }, ...],
 *     data:       [{ id, format, content, collapsed }, ...]
 *   }
 */
(function (global) {
  'use strict';

  function uid() {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') {
      return global.crypto.randomUUID().replace(/-/g, '').slice(0, 12);
    }
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  }

  function makeNode(text = '') {
    return { id: uid(), text, collapsed: false, children: [], attributes: [], data: [] };
  }

  function normalizeNode(id, raw) {
    const n = raw || {};
    return {
      id,
      text: typeof n.text === 'string' ? n.text : '',
      collapsed: !!n.collapsed,
      children: Array.isArray(n.children) ? n.children.slice() : [],
      attributes: (Array.isArray(n.attributes) ? n.attributes : []).map((a) => ({
        id: a.id || uid(),
        key: String(a.key ?? ''),
        value: String(a.value ?? ''),
      })),
      data: (Array.isArray(n.data) ? n.data : []).map((d) => ({
        id: d.id || uid(),
        format: String(d.format || 'text'),
        content: String(d.content ?? ''),
        collapsed: !!d.collapsed,
      })),
    };
  }

  class OutlineStore {
    constructor(state) {
      this.rootId = state.rootId;
      this.nodes = state.nodes;
      this._reindex();
    }

    static create(rootText = 'Home') {
      const root = makeNode(rootText);
      root.id = 'root';
      return new OutlineStore({ rootId: 'root', nodes: { root } });
    }

    static fromJSON(json) {
      if (!json || typeof json !== 'object' || !json.nodes || !json.rootId || !json.nodes[json.rootId]) {
        throw new Error('Invalid outline data');
      }
      const nodes = {};
      for (const [id, raw] of Object.entries(json.nodes)) nodes[id] = normalizeNode(id, raw);
      // Drop dangling child references.
      for (const n of Object.values(nodes)) n.children = n.children.filter((c) => nodes[c] && c !== n.id);
      return new OutlineStore({ rootId: json.rootId, nodes });
    }

    toJSON() {
      return { version: 1, rootId: this.rootId, nodes: this.nodes };
    }

    _reindex() {
      this.parent = {};
      for (const n of Object.values(this.nodes)) {
        for (const c of n.children) this.parent[c] = n.id;
      }
    }

    // ---------- queries

    get(id) {
      return this.nodes[id];
    }

    parentOf(id) {
      return this.parent[id];
    }

    siblings(id) {
      const p = this.parent[id];
      return p ? this.nodes[p].children : [];
    }

    indexOf(id) {
      return this.siblings(id).indexOf(id);
    }

    /** Ancestors from the root down to (and including) id. */
    path(id) {
      const out = [];
      for (let cur = id; cur; cur = this.parent[cur]) out.unshift(cur);
      return out;
    }

    isAncestor(ancestorId, id) {
      for (let cur = this.parent[id]; cur; cur = this.parent[cur]) {
        if (cur === ancestorId) return true;
      }
      return false;
    }

    /** Depth-first list of node ids visible beneath viewId (respecting collapsed state). */
    visible(viewId) {
      const out = [];
      const walk = (id) => {
        for (const c of this.nodes[id].children) {
          out.push(c);
          if (!this.nodes[c].collapsed) walk(c);
        }
      };
      walk(viewId);
      return out;
    }

    // ---------- structure

    _insert(id, parentId, index) {
      const kids = this.nodes[parentId].children;
      if (index < 0 || index > kids.length) index = kids.length;
      kids.splice(index, 0, id);
      this.parent[id] = parentId;
    }

    _detach(id) {
      const p = this.parent[id];
      if (!p) return;
      const kids = this.nodes[p].children;
      kids.splice(kids.indexOf(id), 1);
      delete this.parent[id];
    }

    addChild(parentId, index = -1, text = '') {
      const n = makeNode(text);
      this.nodes[n.id] = n;
      this._insert(n.id, parentId, index);
      this.nodes[parentId].collapsed = false;
      return n;
    }

    addSiblingAfter(id, text = '') {
      const p = this.parent[id];
      return this.addChild(p, this.indexOf(id) + 1, text);
    }

    addSiblingBefore(id, text = '') {
      const p = this.parent[id];
      return this.addChild(p, this.indexOf(id), text);
    }

    setText(id, text) {
      this.nodes[id].text = text;
    }

    remove(id) {
      if (id === this.rootId) return false;
      this._detach(id);
      const drop = (nid) => {
        for (const c of this.nodes[nid].children) drop(c);
        delete this.nodes[nid];
        delete this.parent[nid];
      };
      drop(id);
      return true;
    }

    /** Make id the last child of its previous sibling. */
    indent(id) {
      const idx = this.indexOf(id);
      if (idx <= 0) return false;
      const prev = this.siblings(id)[idx - 1];
      this._detach(id);
      this._insert(id, prev, -1);
      this.nodes[prev].collapsed = false;
      return true;
    }

    /** Move id to just after its parent. Never moves above viewId (the zoomed node). */
    outdent(id, viewId = this.rootId) {
      const p = this.parent[id];
      if (!p || p === viewId) return false;
      const gp = this.parent[p];
      if (!gp) return false;
      this._detach(id);
      this._insert(id, gp, this.nodes[gp].children.indexOf(p) + 1);
      return true;
    }

    /** Swap with the previous (delta=-1) or next (delta=1) sibling. */
    move(id, delta) {
      const kids = this.siblings(id);
      const i = kids.indexOf(id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= kids.length) return false;
      [kids[i], kids[j]] = [kids[j], kids[i]];
      return true;
    }

    setCollapsed(id, collapsed) {
      const n = this.nodes[id];
      if (!n.children.length && collapsed) return false;
      if (n.collapsed === collapsed) return false;
      n.collapsed = collapsed;
      return true;
    }

    /** Append src's text, attributes, data and children to dst, then delete src. */
    mergeInto(srcId, dstId) {
      const src = this.nodes[srcId];
      const dst = this.nodes[dstId];
      dst.text += src.text;
      dst.attributes.push(...src.attributes);
      dst.data.push(...src.data);
      for (const c of src.children.slice()) {
        this._detach(c);
        this._insert(c, dstId, -1);
      }
      src.attributes = [];
      src.data = [];
      this.remove(srcId);
    }

    // ---------- attributes

    addAttribute(id, key = '', value = '') {
      const a = { id: uid(), key, value };
      this.nodes[id].attributes.push(a);
      return a;
    }

    updateAttribute(id, attrId, patch) {
      const a = this.nodes[id].attributes.find((x) => x.id === attrId);
      if (a) Object.assign(a, patch);
      return a;
    }

    removeAttribute(id, attrId) {
      const list = this.nodes[id].attributes;
      const i = list.findIndex((x) => x.id === attrId);
      if (i >= 0) list.splice(i, 1);
      return i >= 0;
    }

    // ---------- data

    addData(id, format = 'markdown', content = '') {
      const d = { id: uid(), format, content, collapsed: false };
      this.nodes[id].data.push(d);
      return d;
    }

    getData(id, dataId) {
      return this.nodes[id].data.find((x) => x.id === dataId);
    }

    updateData(id, dataId, patch) {
      const d = this.getData(id, dataId);
      if (d) Object.assign(d, patch);
      return d;
    }

    removeData(id, dataId) {
      const list = this.nodes[id].data;
      const i = list.findIndex((x) => x.id === dataId);
      if (i >= 0) list.splice(i, 1);
      return i >= 0;
    }
  }

  global.OutlineStore = OutlineStore;
  if (typeof module !== 'undefined' && module.exports) module.exports = { OutlineStore };
})(typeof window !== 'undefined' ? window : globalThis);
