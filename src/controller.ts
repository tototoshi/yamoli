/*
 * Editing logic shared by all components. The store is mutated in place;
 * commit() saves and asks the App to re-render, optionally moving focus.
 */
import { DEP_KEY } from './deps';
import type { ScheduleResult } from './schedule';
import { addGuideSlides, addScheduleSample } from './sample';
import { UndoHistory } from './history';
import { browserLang, setLang, t, type Lang } from './i18n';
import { linkCandidates, pickerQueryAt } from './links';
import { FIELD_TYPED, parseOutlineText, type TextRow } from './fields';
import { OutlineStore } from './model';
import { parseQuery, searchTree, wantsCompleted, type SearchResult, type Term } from './search';
import { flush, load, loadPrefs, onExternalChange, onSaveState, resolveConflict, save, savePrefs } from './storage';

export type View = 'outline' | 'gantt' | 'slides' | 'text' | 'yaml' | 'json';
const VIEWS: View[] = ['outline', 'gantt', 'slides', 'text', 'yaml', 'json'];

/** Focus is addressed by a stable data-fk key so it survives re-rendering. */
export interface Focus {
  key: string;
  start?: number | 'end';
  end?: number | 'end';
}

export const fKey = (id: string): Focus => ({ key: 'fkey:' + id, start: 'end' });

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
export const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);

/** macOS's Emacs keys (Ctrl+P / N / B / F) as the arrow they stand for. */
const EMACS: Record<string, string> = { KeyP: 'ArrowUp', KeyN: 'ArrowDown', KeyB: 'ArrowLeft', KeyF: 'ArrowRight' };
const arrowOf = (e: KeyboardEvent) =>
  (IS_MAC && e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && EMACS[e.code]) || e.key;

/** State of the `[[` link picker attached to one editable field. */
/** The menu opened by right-clicking an item's bullet. */
export interface ItemMenu {
  id: string;
  x: number;
  y: number;
}

/** A short message at the bottom of the screen, optionally offering undo. */
export interface Toast {
  message: string;
  undo: boolean;
}

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
  zoomId!: string; // set from the URL in the constructor
  /** ids of data blocks currently showing their editor */
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
  menu: ItemMenu | null = null;
  toast: Toast | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | undefined;
  /** How the zoomed item's contents are shown. */
  view: View = 'outline';
  /** The slide on screen in the slides view (clamped by the view). */
  slide = 0;
  /** Items on a dependency cycle; recomputed by the App on every render. */
  cycles = new Set<string>();
  /** Computed dates; recomputed by the App on every render. */
  schedule: ScheduleResult = { byId: new Map(), unscheduled: new Set(), invalid: new Map(), needsJp: false };
  /** Japanese public holidays (ISO date -> name), loaded on first use. */
  jpDays: ReadonlyMap<string, string> | null = null;
  private jpLoading = false;
  private rerender: () => void = () => {};

  constructor() {
    this.readHash();
    onSaveState(() => this.rerender());
    onExternalChange((next) => this.applyExternal(next));
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
    if (f && /^(text|fkey):/.test(f.key)) this.activeField = f.key;
  }

  // ================================================================ link picker

  /** Open, update or close the picker after the field's value or caret changed. */
  updatePicker(el: HTMLTextAreaElement | HTMLInputElement, selfId: string) {
    const q = pickerQueryAt(el.value, el.selectionStart ?? 0);
    const deps = this.inDependencies(selfId);
    this.picker = q
      ? { key: el.dataset.fk!, from: q.from, candidates: linkCandidates(this.store, q.query, selfId, { deps }), selected: 0 }
      : null;
  }

  /** Whether id is (or is inside) its item's `after` field. */
  private inDependencies(id: string): boolean {
    const { store } = this;
    const owner = store.owner(id);
    let n = id;
    while (store.parentOf(n) && store.parentOf(n) !== owner) n = store.parentOf(n)!;
    return n !== owner && store.node(n).key?.trim().toLowerCase() === DEP_KEY;
  }

  /** Keyboard handling while the picker is open. Returns true if the key was consumed. */
  private pickerKeydown(e: KeyboardEvent, el: HTMLTextAreaElement | HTMLInputElement): boolean {
    const p = this.picker;
    if (!p || p.key !== el.dataset.fk) return false;
    const n = p.candidates.length;
    const key = arrowOf(e);
    if ((key === 'ArrowDown' || key === 'ArrowUp') && n) {
      e.preventDefault();
      p.selected = (p.selected + (key === 'ArrowDown' ? 1 : -1) + n) % n;
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
    this.store.setText(p.key.slice('text:'.length), next);
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
    if (!this.store.get(this.zoomId)) {
      this.zoomId = this.store.rootId;
      window.history.replaceState(null, '', this.hashFor(this.zoomId, this.view));
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

  /** Children of id that are displayed (search, hidden-completed and hidden-field filters applied). */
  shownChildren(id: string): string[] {
    const { search, store } = this;
    const hideDone = !this.prefs.showCompleted && !wantsCompleted(this.terms);
    const hideFields = !this.prefs.showFields;
    return store.node(id).children.filter((c) => {
      const n = store.node(c);
      if (search && !search.shown.has(c)) return false;
      if (hideDone && n.completed) return false;
      return !(hideFields && n.key !== null && n.format === null); // blocks are content, kept
    });
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

  /** Switch the UI language (null: follow the browser). */
  setLanguage(l: Lang | null) {
    const { lang: _, ...rest } = this.prefs;
    this.prefs = l ? { ...rest, lang: l } : rest;
    savePrefs(this.prefs);
    setLang(l ?? browserLang());
    this.rerender();
  }

  toggleShowFields() {
    this.prefs = { ...this.prefs, showFields: !this.prefs.showFields };
    savePrefs(this.prefs);
    this.rerender();
  }

  toggleShowCompleted() {
    this.prefs = { ...this.prefs, showCompleted: !this.prefs.showCompleted };
    savePrefs(this.prefs);
    this.rerender();
  }

  /** Toggle completion; if completed rows are hidden, focus moves to a neighbour. */
  // ================================================================ item menu

  openMenu(id: string, x: number, y: number) {
    this.menu = { id, x, y };
    this.rerender();
  }

  closeMenu() {
    if (!this.menu) return;
    this.menu = null;
    this.rerender();
  }

  showToast(message: string, undo = false) {
    this.toast = { message, undo };
    this.holdToast(false);
    this.rerender();
  }

  /** Keep the toast up while the pointer is on it; otherwise it fades after a while. */
  holdToast(hold: boolean) {
    clearTimeout(this.toastTimer);
    if (hold || !this.toast) return;
    this.toastTimer = setTimeout(() => {
      this.toast = null;
      this.rerender();
    }, 10000);
  }

  hideToast() {
    clearTimeout(this.toastTimer);
    this.toast = null;
    this.rerender();
  }

  /** Delete id and everything under it (undoable), focusing a neighbouring row. */
  deleteItem(id: string) {
    const { store } = this;
    if (id === store.rootId || id === this.zoomId) return;
    const vis = this.visibleRows();
    const idx = vis.indexOf(id);
    const next = vis.slice(idx + 1).find((r) => !store.isAncestor(id, r)) ?? vis[idx - 1];
    const label = store.node(id).text.split('\n')[0].trim() || t('無題', 'Untitled');
    const below = store.descendantCount(id);
    store.remove(id);
    this.commit(this.view === 'outline' && next ? fText(next) : null);
    const short = label.length > 20 ? label.slice(0, 20) + '…' : label;
    this.showToast(
      t(`「${short}」を削除しました${below ? `（中の ${below} 件も）` : ''}`, `Deleted “${short}”${below ? ` and ${below} below it` : ''}`),
      true
    );
  }

  duplicateItem(id: string) {
    const copy = this.store.duplicate(id);
    if (copy) this.commit(this.view === 'outline' ? fText(copy.id) : null);
  }

  /** Put a [[link]] to id on the clipboard, to paste into text or an `after`. */
  copyLink(id: string) {
    navigator.clipboard.writeText(`[[${id}]]`).then(
      () =>
        this.showToast(
          t('リンクをコピーしました。本文や属性の値に貼り付けると参照になります', 'Link copied. Paste it into a row or a field value to refer to this item')
        ),
      () => this.showToast(t('クリップボードにコピーできませんでした', 'Couldn’t copy to the clipboard'))
    );
  }

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

  /**
   * Take the zoomed item and view from the URL (#/id?view=gantt). Without a
   * view, an item opens the way it was last viewed.
   */
  private readHash() {
    const m = location.hash.match(/^#\/([^?]*)(?:\?(.*))?$/);
    const raw = m?.[1] ? decodeURIComponent(m[1]) : this.store.rootId;
    this.zoomId = this.store.get(raw) ? raw : this.store.rootId;
    const asked = new URLSearchParams(m?.[2] ?? '').get('view') as View | null;
    if (asked && VIEWS.includes(asked)) {
      this.view = asked;
      this.rememberView();
    } else {
      const remembered = this.prefs.views[this.zoomId];
      this.view = remembered ?? 'outline';
      if (remembered) window.history.replaceState(null, '', this.hashFor(this.zoomId, remembered));
    }
  }

  private rememberView() {
    const current = this.prefs.views[this.zoomId] ?? 'outline';
    if (current === this.view) return;
    const views = Object.fromEntries(Object.entries(this.prefs.views).filter(([id]) => this.store.get(id)));
    if (this.view === 'outline') delete views[this.zoomId];
    else views[this.zoomId] = this.view;
    this.prefs = { ...this.prefs, views };
    savePrefs(this.prefs);
  }

  hashFor(id: string, view?: View) {
    const base = id === this.store.rootId ? '#/' : '#/' + encodeURIComponent(id);
    return view ? `${base}?view=${view}` : base;
  }

  /** Switch how the zoomed item is shown (remembered for next time). */
  setView(view: View) {
    location.hash = this.hashFor(this.zoomId, view);
  }

  setSlide(index: number) {
    this.slide = Math.max(0, index);
    this.rerender();
  }

  setGanttScale(scale: number) {
    this.prefs = { ...this.prefs, ganttScale: scale };
    savePrefs(this.prefs);
    this.rerender();
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
    const prevView = this.view;
    this.readHash();
    if (this.zoomId === prev && this.view !== prevView) {
      // Only the view changed: keep scroll, focus the item's first row.
      const first = this.view === 'outline' ? this.visibleRows()[0] : undefined;
      this.focus(first ? fText(first) : null);
      return;
    }
    this.slide = 0;
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
    this.focus(this.view === 'outline' ? focus : null);
    window.scrollTo(0, 0);
  }

  // ================================================================ actions

  /** Add an empty field to id and edit its name. */
  addAttribute(id: string) {
    if (!this.prefs.showFields) this.prefs = { ...this.prefs, showFields: true };
    const f = this.store.addField(id, '');
    this.commit(fKey(f.id));
  }

  // ================================================================ fields

  /**
   * Text typed into a row. Typing `name: ` at the start of an ordinary row
   * turns it into a field (Backspace at the start of the value turns it back).
   */
  onTextInput(id: string, ta: HTMLTextAreaElement) {
    const { store } = this;
    const n = store.node(id);
    const value = ta.value;
    const m = n.key === null && id !== this.zoomId ? value.match(FIELD_TYPED) : null;
    if (m && ta.selectionStart === m[1].length + 2 && n.text !== value) {
      store.setKey(id, m[1]);
      store.setText(id, value.slice(m[1].length + 2));
      this.commit(fText(id, 0)); // its own undo step, so ⌘Z turns it back
      return;
    }
    store.setText(id, value);
    this.updatePicker(ta, id);
    this.commit(undefined, 'text:' + id);
  }

  onKeyInput(id: string, input: HTMLInputElement) {
    const v = input.value;
    // Typing the colon (YAML habit) moves on to the value.
    if (v.endsWith(':')) {
      this.store.setKey(id, v.slice(0, -1));
      return this.commit(fText(id, 0));
    }
    this.store.setKey(id, v);
    this.commit(undefined, 'fkey:' + id);
  }

  onKeyKeydown(e: KeyboardEvent, input: HTMLInputElement) {
    const id = input.dataset.id!;
    const key = arrowOf(e);
    const caret = input.selectionStart === input.selectionEnd ? input.selectionStart : null;
    if (e.key === 'Enter' || e.key === 'Tab' || e.key === 'Escape') {
      e.preventDefault();
      this.focus(fText(id, e.key === 'Escape' ? 'end' : 0));
    } else if (e.key === 'Backspace' && !input.value) {
      e.preventDefault();
      this.unfield(id, 0);
    } else if (key === 'ArrowDown' || key === 'ArrowUp') {
      e.preventDefault();
      const vis = this.visibleRows();
      const other = vis[vis.indexOf(id) + (key === 'ArrowDown' ? 1 : -1)];
      if (other) this.focus(fText(other));
    } else if (key === 'ArrowRight' && caret === input.value.length) {
      e.preventDefault();
      this.focus(fText(id, 0));
    } else if (key === 'ArrowLeft' && caret === 0) {
      const prev = this.rowBefore(id);
      if (prev) {
        e.preventDefault();
        this.focus(fText(prev));
      }
    }
  }

  /** The row the caret goes to before this one: the one shown above, else the zoomed item's title. */
  private rowBefore(id: string): string | null {
    const vis = this.visibleRows();
    const idx = vis.indexOf(id);
    if (idx > 0) return vis[idx - 1];
    return id !== this.zoomId && this.zoomId !== this.store.rootId ? this.zoomId : null;
  }

  /** Leaving a field's name empty turns it back into an ordinary row (or drops it if empty). */
  onKeyBlur(id: string) {
    const n = this.store.get(id);
    this.deactivate('fkey:' + id);
    if (!n || n.key === null || n.key.trim()) return;
    if (!n.text && !n.children.length) this.store.remove(id);
    else this.unfield(id);
    this.commit();
  }

  /** Menu action: `name: value` row <-> field. */
  toggleField(id: string) {
    const n = this.store.node(id);
    if (n.key !== null) return this.unfield(id);
    const m = n.text.match(/^([^\s:][^\s:]{0,39}):\s*([\s\S]*)$/);
    this.store.setKey(id, m ? m[1] : n.text.trim());
    this.store.setText(id, m ? m[2] : '');
    this.commit(this.view === 'outline' ? fText(id) : null);
  }

  /** Set a field's value from outside its editor (the date picker). */
  setFieldText(id: string, text: string) {
    this.store.setText(id, text);
    this.commit();
  }

  /** Turn a field back into the ordinary row `name: value`. */
  private unfield(id: string, caret?: number) {
    const n = this.store.node(id);
    const prefix = n.key ? `${n.key}: ` : '';
    this.store.setKey(id, null);
    this.store.setFormat(id, null);
    this.store.setText(id, prefix + n.text);
    this.commit(fText(id, caret ?? prefix.length));
  }

  /** Add a block (multi-line field, Markdown by default) and start writing in it. */
  addBlock(id: string, format = 'markdown') {
    if (!this.prefs.showFields) this.prefs = { ...this.prefs, showFields: true };
    const f = this.store.addBlock(id, this.store.freeKey(id, 'note'), format);
    this.commit(fText(f.id, 0));
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
    if (!this.prefs.showFields) this.prefs = { ...this.prefs, showFields: true };
    let f = this.store.field(id, DEP_KEY);
    if (f) {
      const v = f.text.trimEnd();
      this.store.setText(f.id, v + (!v || v.endsWith(',') ? '' : ', ') + '[[');
    } else {
      f = this.store.addField(id, DEP_KEY, '[[');
    }
    const key = 'text:' + f.id;
    this.commit({ key, start: 'end' });
    this.picker = { key, from: f.text.length - 2, candidates: linkCandidates(this.store, '', id, { deps: true }), selected: 0 };
    this.rerender();
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

  /** Add the usage guide deck and open it as slides. */
  addGuide() {
    const id = addGuideSlides(this.store, this.store.rootId);
    this.commit(null);
    this.slide = 0;
    location.hash = this.hashFor(id, 'slides');
  }

  /** Show an outline someone else saved (undoable, not saved back). */
  private applyExternal(next: OutlineStore) {
    this.store = next;
    if (!next.get(this.zoomId)) {
      this.zoomId = next.rootId;
      window.history.replaceState(null, '', this.hashFor(this.zoomId, this.view));
    }
    this.history.record(this.snapshot(), captureFocus(), null);
    this.search = this.runSearch();
    this.rerender();
  }

  resolveConflict(keep: 'file' | 'mine') {
    flush();
    void resolveConflict(keep, this.store);
  }

  replaceStore(next: OutlineStore) {
    this.store = next;
    if (!next.get(this.zoomId)) {
      this.zoomId = next.rootId;
      window.history.replaceState(null, '', this.hashFor(this.zoomId, this.view));
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
    if (n.format !== null && !isTitle && this.blockKeydown(e, ta, n.id)) return;

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
    if (e.key === 'Backspace' && start === 0 && end === 0 && n.key !== null) {
      e.preventDefault();
      return this.unfield(id);
    }
    if (e.key === 'Backspace' && start === 0 && end === 0 && !isTitle && !n.children.length) {
      const prev = vis[idx - 1];
      if (!ta.value) {
        e.preventDefault();
        store.remove(id);
        return this.commit(prev ? fText(prev) : zoomFocus);
      }
      if (prev && store.node(prev).format === null) {
        e.preventDefault();
        const pos = store.node(prev).text.length;
        store.mergeInto(id, prev);
        return this.commit(fText(prev, pos));
      }
      return;
    }
    // Delete (or macOS Ctrl+D) at the end pulls the next row up into this one.
    const forwardDelete =
      e.key === 'Delete' || (IS_MAC && e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && e.code === 'KeyD');
    if (forwardDelete && start === ta.value.length && end === start && !isTitle && n.key === null) {
      e.preventDefault();
      const next = vis[idx + 1];
      if (!next || store.isData(next)) return;
      if (!ta.value && !n.children.length) {
        // An empty row just goes away, so the next row keeps its id (and links to it).
        store.remove(id);
        return this.commit(fText(next, 0));
      }
      const m = store.node(next);
      const adopt = !n.children.length && store.parentOf(next) === store.parentOf(id); // its children become ours
      if (m.children.length && !adopt) return;
      store.mergeInto(next, id);
      return this.commit(fText(id, start));
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
      return this.addBlock(id);
    }

    // ---- cursor movement between rows (also Ctrl+P / N / B / F on macOS)
    const key = arrowOf(e);
    const plain = key !== e.key || (!e.shiftKey && !e.altKey && !isMod(e));
    if (key === 'ArrowUp' && plain) {
      if (ta.value.lastIndexOf('\n', start - 1) !== -1) return; // still lines above in this row
      const target = isTitle ? null : this.rowBefore(id);
      if (target) {
        e.preventDefault();
        this.focus(fText(target, start));
      }
      return;
    }
    if (key === 'ArrowDown' && plain) {
      if (ta.value.indexOf('\n', end) !== -1) return;
      const target = isTitle ? vis[0] : vis[idx + 1];
      if (target) {
        e.preventDefault();
        this.focus(fText(target, start));
      }
      return;
    }
    // ← at the start of a row goes to the end of the one before (or a field's name), → the other way.
    if (key === 'ArrowLeft' && plain && start === 0 && end === 0) {
      const target = n.key !== null && !isTitle ? fKey(id) : !isTitle && this.rowBefore(id);
      if (target) {
        e.preventDefault();
        this.focus(typeof target === 'string' ? fText(target) : target);
      }
      return;
    }
    if (key === 'ArrowRight' && plain && start === ta.value.length && end === start) {
      const next = isTitle ? vis[0] : vis[idx + 1];
      if (next) {
        e.preventDefault();
        this.focus(store.node(next).key !== null ? { ...fKey(next), start: 0 } : fText(next, 0));
      }
    }
  }

  /** Like store.indent, but under the previous *displayed* sibling. */
  private indentShown(id: string): boolean {
    const p = this.store.parentOf(id);
    if (!p) return false;
    const sibs = this.shownChildren(p);
    const prev = sibs[sibs.indexOf(id) - 1];
    // A field with a value is a leaf: `owner: [[x]]` can't also hold children.
    const pn = prev && this.store.node(prev);
    if (!pn || (pn.key !== null && pn.text.trim())) return false;
    return this.store.moveTo(id, prev, null);
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

  /**
   * Keys inside a block, which is multi-line text: Enter and Tab type, Esc
   * (or ⌘/Ctrl+Enter) leaves it, Backspace in an empty block removes it.
   * Returns false to let the usual row keys (moving, ↑ ↓ past the ends …) run.
   */
  private blockKeydown(e: KeyboardEvent, ta: HTMLTextAreaElement, id: string): boolean {
    if (e.key === 'Escape' || (e.key === 'Enter' && isMod(e))) {
      e.preventDefault();
      this.focus(fText(this.store.parentOf(id)!));
      return true;
    }
    if (e.key === 'Enter' && !e.altKey) return true; // a newline
    if (e.key === 'Tab' && !isMod(e) && !e.altKey) {
      e.preventDefault();
      if (!e.shiftKey && !document.execCommand('insertText', false, '  ')) {
        ta.setRangeText('  ', ta.selectionStart, ta.selectionEnd, 'end');
        ta.dispatchEvent(new Event('input', { bubbles: true }));
      }
      return true;
    }
    if (e.key === 'Backspace' && !isMod(e) && ta.selectionStart === 0 && ta.selectionEnd === 0) {
      e.preventDefault();
      if (ta.value) return true;
      const vis = this.visibleRows();
      const prev = vis[vis.indexOf(id) - 1];
      this.store.remove(id);
      this.commit(prev ? fText(prev) : null);
      return true;
    }
    return false;
  }


  /** Pasting multiple lines into a row creates one sibling per line. */
  /**
   * Paste indented text (YAML, a nested list): the rows go after the current
   * one, keeping their nesting; `key: value` lines become fields.
   */
  private pasteTree(e: ClipboardEvent, ta: HTMLTextAreaElement, tree: TextRow[]) {
    e.preventDefault();
    const { store } = this;
    const id = ta.dataset.id!;
    const add = (parent: string, index: number, r: TextRow): string => {
      const n = store.addChild(parent, index, r.text);
      n.key = r.key;
      n.format = r.key !== null ? (r.format ?? null) : null;
      r.children.forEach((c) => add(n.id, -1, c));
      return n.id;
    };
    // Into an empty row: it becomes the first pasted row. Under the zoomed item: as its first children.
    let parent: string;
    let index: number;
    if (id === this.zoomId) [parent, index] = [id, 0];
    else [parent, index] = [store.parentOf(id)!, store.indexOf(id) + 1];
    const empty = id !== this.zoomId && !ta.value && !store.node(id).children.length;
    let last = id;
    tree.forEach((r, i) => (last = add(parent, index + i, r)));
    if (empty) store.remove(id);
    this.commit(fText(last));
  }

  onTextPaste(e: ClipboardEvent, ta: HTMLTextAreaElement) {
    const text = e.clipboardData?.getData('text') ?? '';
    if (!text.includes('\n')) return;
    const tree = parseOutlineText(text);
    if (tree.some((r) => r.key !== null || r.children.length)) return this.pasteTree(e, ta, tree);
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
