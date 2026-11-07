/*
 * Editing logic shared by all components. The store is mutated in place;
 * commit() saves and asks the App to re-render, optionally moving focus.
 */
import { DEP_KEY } from './deps';
import type { ScheduleResult } from './schedule';
import { addScheduleSample } from './sample';
import { UndoHistory } from './history';
import { linkCandidates, pickerQueryAt } from './links';
import { OutlineStore } from './model';
import { parseQuery, searchTree, wantsCompleted, type SearchResult, type Term } from './search';
import { flush, load, loadPrefs, save, savePrefs } from './storage';

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

/** State of the `[[` link picker attached to one editable field. */
export interface LinkPicker {
  /** Focus key of the field (text:… or value:…). */
  key: string;
  /** Index of the `[[` being completed. */
  from: number;
  candidates: string[];
  selected: number;
}

export class Controller {
  store: OutlineStore = load();
  zoomId: string;
  /** ids of data blocks currently showing their editor */
  editing = new Set<string>();
  pendingFocus: Focus | null = null;
  history = new UndoHistory<Focus | null>(this.snapshot());
  query = '';
  terms: Term[] = [];
  /** Active search result for the zoomed view, or null when not searching. */
  search: SearchResult | null = null;
  prefs = loadPrefs();
  /**
   * Focus key of the one row text (text:id) or attribute value (value:node:attr)
   * rendered as an editor; all others show formatted text.
   */
  activeField: string | null = null;
  picker: LinkPicker | null = null;
  /** Items on a dependency cycle; recomputed by the App on every render. */
  cycles = new Set<string>();
  /** Computed dates; recomputed by the App on every render. */
  schedule: ScheduleResult = { byId: new Map(), unscheduled: new Set(), invalid: new Map(), needsJp: false };
  /** Japanese public holidays (ISO date -> name), loaded on first use. */
  jpDays: ReadonlyMap<string, string> | null = null;
  private jpLoading = false;
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
    if (focus !== undefined) this.setPendingFocus(focus);
    if (this.search) this.extendSearch(focus);
    this.rerender();
  }

  /** Move focus (switching a row into edit mode if needed) and re-render. */
  focus(f: Focus | null) {
    this.setPendingFocus(f);
    this.rerender();
  }

  /** Called when a field editor loses focus to something other than itself. */
  deactivate(key: string) {
    if (this.activeField !== key) return;
    this.activeField = null;
    this.picker = null;
    this.rerender();
  }

  private setPendingFocus(f: Focus | null) {
    this.pendingFocus = f;
    if (this.picker && this.picker.key !== f?.key) this.picker = null;
    if (f && /^(text|value):/.test(f.key)) this.activeField = f.key;
  }

  // ================================================================ link picker

  /** Open, update or close the picker after the field's value or caret changed. */
  updatePicker(el: HTMLTextAreaElement | HTMLInputElement, selfId: string) {
    const q = pickerQueryAt(el.value, el.selectionStart ?? 0);
    this.picker = q
      ? { key: el.dataset.fk!, from: q.from, candidates: linkCandidates(this.store, q.query, selfId), selected: 0 }
      : null;
  }

  /** Keyboard handling while the picker is open. Returns true if the key was consumed. */
  private pickerKeydown(e: KeyboardEvent, el: HTMLTextAreaElement | HTMLInputElement): boolean {
    const p = this.picker;
    if (!p || p.key !== el.dataset.fk) return false;
    const n = p.candidates.length;
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && n) {
      e.preventDefault();
      p.selected = (p.selected + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
      this.rerender();
      return true;
    }
    if ((e.key === 'Enter' || e.key === 'Tab') && n) {
      e.preventDefault();
      this.insertLink(p.candidates[p.selected]);
      return true;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      this.picker = null;
      this.rerender();
      return true;
    }
    return false;
  }

  /** Replace the `[[query` before the caret with a link to targetId. */
  insertLink(targetId: string) {
    const p = this.picker;
    if (!p) return;
    const el = document.querySelector<HTMLTextAreaElement | HTMLInputElement>(`[data-fk="${CSS.escape(p.key)}"]`);
    if (!el) return;
    const link = `[[${targetId}]]`;
    const next = el.value.slice(0, p.from) + link + el.value.slice(el.selectionStart ?? el.value.length);
    const [kind, nodeId, attrId] = p.key.split(':');
    if (kind === 'text') this.store.setText(nodeId, next);
    else this.store.updateAttribute(nodeId, attrId, { value: next });
    this.picker = null;
    this.commit({ key: p.key, start: p.from + link.length });
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
    this.setPendingFocus(entry.meta);
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
    this.terms = parseQuery(this.query);
    return this.terms.length ? searchTree(this.store, this.zoomId, this.terms, this.jpDays) : null;
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

  // ================================================================ what is on screen

  /** Children of id that are displayed (search and hidden-completed filters applied). */
  shownChildren(id: string): string[] {
    const { search, store } = this;
    const hideDone = !this.prefs.showCompleted && !wantsCompleted(this.terms);
    return store
      .node(id)
      .children.filter((c) => (!search || search.shown.has(c)) && !(hideDone && store.node(c).completed));
  }

  /** Whether id's displayed children are rendered: always while searching. */
  isExpanded(id: string): boolean {
    return this.search ? this.shownChildren(id).length > 0 : !this.store.node(id).collapsed;
  }

  /** Rows on screen in order. */
  visibleRows(): string[] {
    const out: string[] = [];
    const walk = (id: string) => {
      for (const c of this.shownChildren(id)) {
        out.push(c);
        if (this.isExpanded(c)) walk(c);
      }
    };
    walk(this.zoomId);
    return out;
  }

  toggleShowCompleted() {
    this.prefs = { ...this.prefs, showCompleted: !this.prefs.showCompleted };
    savePrefs(this.prefs);
    this.rerender();
  }

  /** Toggle completion; if completed rows are hidden, focus moves to a neighbour. */
  toggleComplete(id: string) {
    const vis = this.visibleRows();
    const idx = vis.indexOf(id);
    const n = this.store.node(id);
    this.store.setCompleted(id, !n.completed);
    let focus: Focus | null | undefined; // undefined keeps focus where it is
    if (n.completed && !this.prefs.showCompleted) {
      // Skip the row's own (now hidden) subtree when choosing the next row.
      const next = vis.slice(idx + 1).find((r) => !this.store.isAncestor(id, r));
      focus = next ? fText(next, 0) : vis[idx - 1] ? fText(vis[idx - 1]) : null;
    }
    this.commit(focus);
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
    this.focus(focus);
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

  /** Load the Japanese holiday table (a separate chunk) the first time a calendar needs it. */
  loadJpHolidays() {
    if (this.jpDays || this.jpLoading) return;
    this.jpLoading = true;
    import('@holiday-jp/holiday_jp')
      .then((m) => {
        const table = (m.default ?? m).holidays as Record<string, { date: string; name: string }>;
        this.jpDays = new Map(Object.values(table).map((h) => [h.date, h.name]));
        this.search = this.runSearch();
        this.rerender();
      })
      .catch((e) => {
        console.error('Failed to load Japanese holidays', e);
        this.jpLoading = false;
      });
  }

  /** Start adding a dependency: focus the `after` value with the link picker open. */
  addDependency(id: string) {
    const n = this.store.node(id);
    let a = n.attributes.find((x) => x.key.trim().toLowerCase() === DEP_KEY);
    if (a) {
      const v = a.value.trimEnd();
      this.store.updateAttribute(id, a.id, { value: v + (!v || v.endsWith(',') ? ' ' : ', ') + '[[' });
    } else {
      a = this.store.addAttribute(id, DEP_KEY, '[[');
    }
    const key = `value:${id}:${a.id}`;
    this.commit({ key, start: 'end' });
    this.picker = { key, from: a.value.length - 2, candidates: linkCandidates(this.store, '', id), selected: 0 };
    this.rerender();
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

  moveNode(id: string, parentId: string, beforeId: string | null) {
    if (this.store.moveTo(id, parentId, beforeId)) this.commit();
  }

  /** Append the scheduling sample at the end of the top level and zoom into it. */
  addSample() {
    const id = addScheduleSample(this.store, this.store.rootId);
    this.commit(null);
    this.zoomTo(id);
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
    if (this.pickerKeydown(e, ta)) return;
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
      const kids = this.shownChildren(id);
      const next =
        kids.length && this.isExpanded(id)
          ? store.addChild(id, store.indexOf(kids[0]), after)
          : store.addSiblingAfter(id, after);
      return this.commit(fText(next.id, 0));
    }
    if (e.key === 'Tab' && !isMod(e) && !e.altKey) {
      e.preventDefault();
      if (isTitle) return;
      const ok = e.shiftKey ? store.outdent(id, zoomId) : this.indentShown(id);
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
      if (!isTitle && this.moveShown(id, e.key === 'ArrowUp' ? -1 : 1)) this.commit(fText(id, start, end));
      return;
    }
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && isMod(e) && !e.altKey) {
      e.preventDefault();
      if (!isTitle && store.setCollapsed(id, e.key === 'ArrowUp')) this.commit(fText(id, start, end));
      return;
    }
    if (e.key === 'Enter' && isMod(e)) {
      e.preventDefault();
      if (!isTitle) this.toggleComplete(id);
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
        this.focus(fText(target, start));
      }
      return;
    }
    if (e.key === 'ArrowDown' && !e.shiftKey && !e.altKey && !isMod(e)) {
      if (ta.value.indexOf('\n', end) !== -1) return;
      const target = isTitle ? vis[0] : vis[idx + 1];
      if (target) {
        e.preventDefault();
        this.focus(fText(target, start));
      }
    }
  }

  /** Like store.indent, but under the previous *displayed* sibling. */
  private indentShown(id: string): boolean {
    const p = this.store.parentOf(id);
    if (!p) return false;
    const sibs = this.shownChildren(p);
    const prev = sibs[sibs.indexOf(id) - 1];
    return prev ? this.store.moveTo(id, prev, null) : false;
  }

  /** Swap places with the previous/next *displayed* sibling. */
  private moveShown(id: string, delta: -1 | 1): boolean {
    const p = this.store.parentOf(id);
    if (!p) return false;
    const shown = this.shownChildren(p);
    const other = shown[shown.indexOf(id) + delta];
    if (!other) return false;
    if (delta < 0) return this.store.moveTo(id, p, other);
    const all = this.store.node(p).children;
    return this.store.moveTo(id, p, all[all.indexOf(other) + 1] ?? null);
  }

  onAttrKeydown(e: KeyboardEvent, input: HTMLInputElement) {
    if (this.pickerKeydown(e, input)) return;
    const id = input.dataset.id!;
    const attrId = input.dataset.attr!;
    const field = input.dataset.field;
    if (e.key === 'Enter') {
      e.preventDefault();
      if (field === 'key') this.focus({ key: `value:${id}:${attrId}`, start: 'end' });
      else this.focus(fText(id));
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.focus(fText(id));
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
