/*
 * Editing logic shared by all components. The store is mutated in place;
 * commit() saves and asks the App to re-render, optionally moving focus.
 */
import { UndoHistory } from './history';
import { OutlineStore } from './model';
import { parseQuery, searchTree, type SearchResult } from './search';
import { flush, load, save } from './storage';

/** Focus is addressed by a stable data-fk key so it survives re-rendering. */
export interface Focus {
  key: string;
  start?: number | 'end';
  end?: number | 'end';
}

export const fText = (id: string, start: number | 'end' = 'end', end?: number | 'end'): Focus => ({
  key: 'text:' + id,
  start,
  end,
});

export function captureFocus(): Focus | null {
  const a = document.activeElement as HTMLTextAreaElement | HTMLInputElement | null;
  if (!a?.dataset?.fk) return null;
  return { key: a.dataset.fk, start: a.selectionStart ?? undefined, end: a.selectionEnd ?? undefined };
}

export function applyFocus(f: Focus | null | undefined) {
  if (!f) return;
  const el = document.querySelector<HTMLTextAreaElement | HTMLInputElement>(`[data-fk="${CSS.escape(f.key)}"]`);
  if (!el) return;
  el.focus();
  if (f.start == null || typeof el.setSelectionRange !== 'function') return;
  const len = el.value.length;
  const pos = (p: number | 'end') => (p === 'end' ? len : Math.min(p, len));
  const s = pos(f.start);
  el.setSelectionRange(s, f.end == null ? s : pos(f.end));
}

const isMod = (e: KeyboardEvent) => e.metaKey || e.ctrlKey;

export class Controller {
  store: OutlineStore = load();
  zoomId: string;
  /** ids of data blocks currently showing their editor */
  editing = new Set<string>();
  pendingFocus: Focus | null = null;
  history = new UndoHistory<Focus | null>(this.snapshot());
  query = '';
  /** Active search result for the zoomed view, or null when not searching. */
  search: SearchResult | null = null;
  private rerender: () => void = () => {};

  constructor() {
    this.zoomId = this.idFromHash();
  }

  bind(rerender: () => void) {
    this.rerender = rerender;
  }

  /**
   * Record an undo step, save and re-render. focus=undefined leaves focus where it is.
   * Commits sharing a `coalesce` key (e.g. typing in one field) merge into one undo step.
   */
  commit(focus?: Focus | null, coalesce?: string) {
    this.history.record(this.snapshot(), captureFocus(), coalesce ?? null);
    save(this.store);
    if (focus !== undefined) this.pendingFocus = focus;
    if (this.search) this.extendSearch(focus);
    this.rerender();
  }

  private snapshot() {
    return JSON.stringify(this.store.toJSON());
  }

  undo() {
    this.restore(this.history.undo(captureFocus()));
  }

  redo() {
    this.restore(this.history.redo(captureFocus()));
  }

  private restore(entry: { state: string; meta: Focus | null } | null) {
    if (!entry) return;
    this.store = OutlineStore.fromJSON(JSON.parse(entry.state));
    this.editing.clear();
    if (!this.store.get(this.zoomId)) {
      this.zoomId = this.store.rootId;
      window.history.replaceState(null, '', this.hashFor(this.zoomId));
    }
    save(this.store);
    this.pendingFocus = entry.meta;
    this.search = this.runSearch();
    this.rerender();
  }

  // ================================================================ search

  setQuery(q: string) {
    this.query = q;
    this.search = this.runSearch();
    this.rerender();
  }

  private runSearch(): SearchResult | null {
    const terms = parseQuery(this.query);
    return terms.length ? searchTree(this.store, this.zoomId, terms) : null;
  }

  /**
   * Results only grow while searching, so a row being edited (or just added)
   * doesn't vanish when it stops matching.
   */
  private extendSearch(focus: Focus | null | undefined) {
    const search = this.search!;
    const fresh = this.runSearch();
    fresh?.matches.forEach((id) => search.matches.add(id));
    fresh?.shown.forEach((id) => search.shown.add(id));
    const id = focus?.key.startsWith('text:') ? focus.key.slice(5) : null;
    if (id && this.store.isAncestor(this.zoomId, id)) {
      const path = this.store.path(id);
      path.slice(path.indexOf(this.zoomId) + 1).forEach((a) => search.shown.add(a));
    }
  }

  /** Rows on screen in order: filtered (and fully expanded) while searching. */
  visibleRows(): string[] {
    const { search, store } = this;
    if (!search) return store.visible(this.zoomId);
    const out: string[] = [];
    const walk = (id: string) => {
      for (const c of store.node(id).children) {
        if (!search.shown.has(c)) continue;
        out.push(c);
        walk(c);
      }
    };
    walk(this.zoomId);
    return out;
  }

  // ================================================================ zoom

  idFromHash(): string {
    const m = location.hash.match(/^#\/(.+)$/);
    const id = m ? decodeURIComponent(m[1]) : this.store.rootId;
    return this.store.get(id) ? id : this.store.rootId;
  }

  hashFor(id: string) {
    return id === this.store.rootId ? '#/' : '#/' + encodeURIComponent(id);
  }

  zoomTo(id: string) {
    location.hash = this.hashFor(id);
  }

  zoomOut() {
    const p = this.store.parentOf(this.zoomId);
    if (p) this.zoomTo(p);
  }

  onHashChange() {
    const { store } = this;
    const prev = this.zoomId;
    this.zoomId = this.idFromHash();
    this.editing.clear();
    this.search = this.runSearch();
    const zoom = store.node(this.zoomId);
    let focus: Focus | null = null;
    if (store.visible(this.zoomId).includes(prev)) {
      focus = fText(prev); // zoomed out: land on the node we came from
    } else if (this.zoomId !== store.rootId) {
      focus = fText(this.zoomId);
    } else if (zoom.children.length) {
      focus = fText(zoom.children[0]);
    }
    this.pendingFocus = focus;
    this.rerender();
    window.scrollTo(0, 0);
  }

  // ================================================================ actions

  addAttribute(id: string) {
    const a = this.store.addAttribute(id);
    this.commit({ key: `key:${id}:${a.id}`, start: 0 });
  }

  addData(id: string, format = 'markdown') {
    const d = this.store.addData(id, format);
    this.editing.add(d.id);
    this.commit({ key: 'data:' + d.id, start: 0 });
  }

  startEditing(nodeId: string, dataId: string) {
    this.store.updateData(nodeId, dataId, { collapsed: false });
    this.editing.add(dataId);
    this.commit({ key: 'data:' + dataId, start: 'end' });
  }

  stopEditing(nodeId: string, dataId: string, refocusNode: boolean) {
    if (!this.editing.delete(dataId)) return;
    this.commit(refocusNode ? fText(nodeId) : undefined);
  }

  replaceStore(next: OutlineStore) {
    this.store = next;
    this.editing.clear();
    if (!next.get(this.zoomId)) {
      this.zoomId = next.rootId;
      window.history.replaceState(null, '', this.hashFor(this.zoomId));
    }
    this.search = this.runSearch();
    this.commit(null);
    flush();
  }

  // ================================================================ keyboard

  onTextKeydown(e: KeyboardEvent, ta: HTMLTextAreaElement) {
    const { store, zoomId } = this;
    const id = ta.dataset.id!;
    const n = store.node(id);
    const isTitle = id === zoomId;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const vis = this.visibleRows();
    const idx = vis.indexOf(id);
    const zoomFocus = zoomId !== store.rootId ? fText(zoomId) : null;

    // ---- structure
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !isMod(e)) {
      e.preventDefault();
      if (isTitle) return this.commit(fText(store.addChild(id, 0).id, 0));
      const before = ta.value.slice(0, start);
      const after = ta.value.slice(end);
      if (start === 0 && end === 0 && after) {
        store.addSiblingBefore(id);
        return this.commit(fText(id, 0));
      }
      store.setText(id, before);
      const next = n.children.length && !n.collapsed ? store.addChild(id, 0, after) : store.addSiblingAfter(id, after);
      return this.commit(fText(next.id, 0));
    }
    if (e.key === 'Tab' && !isMod(e) && !e.altKey) {
      e.preventDefault();
      if (isTitle) return;
      const ok = e.shiftKey ? store.outdent(id, zoomId) : store.indent(id);
      if (ok) this.commit(fText(id, start, end));
      return;
    }
    if (e.key === 'Backspace' && isMod(e) && e.shiftKey) {
      e.preventDefault();
      if (isTitle) return;
      store.remove(id);
      return this.commit(vis[idx - 1] ? fText(vis[idx - 1]) : zoomFocus);
    }
    if (e.key === 'Backspace' && start === 0 && end === 0 && !isTitle && !n.children.length) {
      const prev = vis[idx - 1];
      const hasMeta = n.attributes.length || n.data.length;
      if (!ta.value && !hasMeta) {
        e.preventDefault();
        store.remove(id);
        return this.commit(prev ? fText(prev) : zoomFocus);
      }
      if (prev && !hasMeta) {
        e.preventDefault();
        const pos = store.node(prev).text.length;
        store.mergeInto(id, prev);
        return this.commit(fText(prev, pos));
      }
      return;
    }

    // ---- move / collapse
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && e.shiftKey && (e.altKey || isMod(e))) {
      e.preventDefault();
      if (!isTitle && store.move(id, e.key === 'ArrowUp' ? -1 : 1)) this.commit(fText(id, start, end));
      return;
    }
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && isMod(e) && !e.altKey) {
      e.preventDefault();
      if (!isTitle && store.setCollapsed(id, e.key === 'ArrowUp')) this.commit(fText(id, start, end));
      return;
    }
    if (e.key === 'Enter' && isMod(e)) {
      e.preventDefault();
      if (!isTitle && store.setCollapsed(id, !n.collapsed)) this.commit(fText(id, start, end));
      return;
    }

    // ---- zoom
    if ((e.key === 'ArrowRight' && e.altKey) || (e.key === '.' && isMod(e))) {
      e.preventDefault();
      if (!isTitle) this.zoomTo(id);
      return;
    }
    if ((e.key === 'ArrowLeft' && e.altKey) || (e.key === ',' && isMod(e))) {
      e.preventDefault();
      this.zoomOut();
      return;
    }

    // ---- attributes / data (e.code so macOS Option doesn't remap the key)
    if (e.altKey && !isMod(e) && e.code === 'KeyA') {
      e.preventDefault();
      return this.addAttribute(id);
    }
    if (e.altKey && !isMod(e) && e.code === 'KeyD') {
      e.preventDefault();
      return this.addData(id);
    }

    // ---- cursor movement between rows
    if (e.key === 'ArrowUp' && !e.shiftKey && !e.altKey && !isMod(e)) {
      if (ta.value.lastIndexOf('\n', start - 1) !== -1) return; // still lines above in this row
      const target = idx > 0 ? vis[idx - 1] : !isTitle && zoomId !== store.rootId ? zoomId : null;
      if (target) {
        e.preventDefault();
        applyFocus(fText(target, start));
      }
      return;
    }
    if (e.key === 'ArrowDown' && !e.shiftKey && !e.altKey && !isMod(e)) {
      if (ta.value.indexOf('\n', end) !== -1) return;
      const target = isTitle ? vis[0] : vis[idx + 1];
      if (target) {
        e.preventDefault();
        applyFocus(fText(target, start));
      }
    }
  }

  onAttrKeydown(e: KeyboardEvent, input: HTMLInputElement) {
    const id = input.dataset.id!;
    const attrId = input.dataset.attr!;
    const field = input.dataset.field;
    if (e.key === 'Enter') {
      e.preventDefault();
      if (field === 'key') applyFocus({ key: `value:${id}:${attrId}`, start: 'end' });
      else applyFocus(fText(id));
    } else if (e.key === 'Escape') {
      e.preventDefault();
      applyFocus(fText(id));
    } else if (e.key === 'Backspace' && field === 'key' && !input.value) {
      const a = this.store.node(id).attributes.find((x) => x.id === attrId);
      if (a && !a.value) {
        e.preventDefault();
        this.store.removeAttribute(id, attrId);
        this.commit(fText(id));
      }
    }
  }

  onDataKeydown(e: KeyboardEvent, ta: HTMLTextAreaElement) {
    if (e.key === 'Escape' || (e.key === 'Enter' && isMod(e))) {
      e.preventDefault();
      this.stopEditing(ta.dataset.id!, ta.dataset.data!, true);
    } else if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      if (!document.execCommand('insertText', false, '  ')) {
        ta.setRangeText('  ', ta.selectionStart, ta.selectionEnd, 'end');
        ta.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
  }

  /** Pasting multiple lines into a row creates one sibling per line. */
  onTextPaste(e: ClipboardEvent, ta: HTMLTextAreaElement) {
    const text = e.clipboardData?.getData('text') ?? '';
    if (!text.includes('\n')) return;
    const lines = text
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((l) => l.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '').trim())
      .filter(Boolean);
    if (lines.length < 2) return;
    e.preventDefault();
    const { store } = this;
    const id = ta.dataset.id!;
    const after = ta.value.slice(ta.selectionEnd);
    store.setText(id, ta.value.slice(0, ta.selectionStart) + lines[0]);
    let last = id;
    lines.slice(1).forEach((l, i) => {
      last = id === this.zoomId ? store.addChild(id, i, l).id : store.addSiblingAfter(last, l).id;
    });
    const lastNode = store.node(last);
    const caret = lastNode.text.length;
    lastNode.text += after;
    this.commit(fText(last, caret));
  }
}
