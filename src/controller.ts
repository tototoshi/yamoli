/*
 * Editing logic shared by all components. The store is mutated in place;
 * commit() saves and asks the App to re-render, optionally moving focus.
 */
import { formatDate, today } from './calendar';
import { DEP_KEY, findCycles } from './deps';
import { computeSchedule, scheduleInputs, type ScheduleResult } from './schedule';
import { addDiagramSample, addGuideSlides, addScheduleSample } from './sample';
import { UndoHistory, type Entry } from './history';
import { browserLang, setLang, t, type Lang } from './i18n';
import { keyCandidates, linkCandidates, pickerQueryAt, valueCandidates } from './links';
import { FIELD_TYPED, parseOutlineText, type TextRow } from './fields';
import { OutlineStore } from './model';
import { toMarkdownRows } from './serialize';
import { parseQuery, searchTree, wantsCompleted, type SearchResult, type Term } from './search';
import { flush, load, loadPrefs, onExternalChange, onSaveState, resolveConflict, save, savePrefs, type FieldsMode } from './storage';

export type View = 'outline' | 'gantt' | 'diagram' | 'slides' | 'text' | 'yaml' | 'json';
const VIEWS: View[] = ['outline', 'gantt', 'diagram', 'slides', 'text', 'yaml', 'json'];

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

/** The field that records when an item was completed. */
const DONE_KEY = 'completed';

const isMod = (e: KeyboardEvent) => e.metaKey || e.ctrlKey;
export const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);

/** macOS's Emacs keys (Ctrl+P / N / B / F) as the arrow they stand for. */
const EMACS: Record<string, string> = { KeyP: 'ArrowUp', KeyN: 'ArrowDown', KeyB: 'ArrowLeft', KeyF: 'ArrowRight' };
export const arrowOf = (e: KeyboardEvent) =>
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

/**
 * Completion of a field's name from the names in use, or of its value from the
 * values that name already has. Nothing is picked until ↓ / ↑, so typing on
 * and Enter work as without it.
 */
export interface Suggest {
  /** Focus key of the field (fkey:… for the name, text:… for the value). */
  key: string;
  words: string[];
  /** Index of the highlighted word, -1 for none. */
  selected: number;
}

/** Fields whose values are not worth offering again: dates, and links (which have the `[[` picker). */
const NO_VALUE_SUGGEST = new Set([DEP_KEY, 'start', 'end', 'due', DONE_KEY]);


/** A row as it was copied, with the rows under it. */
interface Copied {
  text: string;
  key: string | null;
  format: string | null;
  completed: boolean;
  task: boolean;
  collapsed: boolean;
  children: Copied[];
}

const copyOf = (store: OutlineStore, id: string): Copied => {
  const { text, key, format, completed, task, collapsed, children } = store.node(id);
  return { text, key, format, completed, task, collapsed, children: children.map((c) => copyOf(store, c)) };
};
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
  /** Rows selected as a whole (Shift+↑↓ past a row's ends, Shift+click, dragging across rows): from anchor to head. */
  selection: { anchor: string; head: string } | null = null;
  /** The rows last copied here, whole, for pasting them back as they were (not as the text written out). */
  private copied: { text: string; rows: Copied[] } | null = null;
  /** The selected rows, worked out at each render. */
  selected = new Set<string>();
  /** With only tasks shown: the tasks under the zoomed item and the rows they sit under; null otherwise. Worked out at each render. */
  taskRows: Set<string> | null = null;
  /** The usage guide is open (#/docs) instead of an item. */
  docs = false;
  /** Rows whose folded fields were opened by hand (fold mode). */
  openFields = new Set<string>();
  picker: LinkPicker | null = null;
  suggest: Suggest | null = null;
  /** The jump-to-item box (⌘P) is open. */
  jumping = false;
  menu: ItemMenu | null = null;
  toast: Toast | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | undefined;
  /** How the zoomed item's contents are shown. */
  view: View = 'outline';
  /** The slide on screen in the slides view (clamped by the view). */
  slide = 0;
  /** Items on a dependency cycle (refreshSchedule). */
  cycles = new Set<string>();
  /** Computed dates (refreshSchedule). */
  schedule: ScheduleResult = { byId: new Map(), unscheduled: new Set(), invalid: new Map(), needsJp: false };
  /** Japanese public holidays (ISO date -> name), loaded on first use. */
  jpDays: ReadonlyMap<string, string> | null = null;
  /** What the schedule and cycles were last worked out from. */
  private scheduledFrom: { inputs: string; jpDays: ReadonlyMap<string, string> | null } | null = null;
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
    this.suggest = null;
    this.rerender();
  }

  private setPendingFocus(f: Focus | null) {
    this.pendingFocus = f;
    if (this.picker && this.picker.key !== f?.key) this.picker = null;
    if (this.suggest && this.suggest.key !== f?.key) this.suggest = null;
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

  // ================================================================ suggestions

  /** Offer the names in use for field id's name, as typed so far. */
  private suggestKeys(id: string) {
    const words = keyCandidates(this.store, this.store.node(id).key ?? '');
    this.suggest = words.length ? { key: 'fkey:' + id, words, selected: -1 } : null;
  }

  /** Offer the values field id's name already has elsewhere, matching its value as typed so far. */
  private suggestValues(id: string) {
    const n = this.store.node(id);
    const name = n.key?.trim().toLowerCase();
    const words =
      name && !NO_VALUE_SUGGEST.has(name) && !this.picker && !n.text.includes('\n')
        ? valueCandidates(this.store, name, n.text).filter((v) => !/^\d{4}-\d\d-\d\d/.test(v))
        : [];
    this.suggest = words.length ? { key: 'text:' + id, words, selected: -1 } : null;
  }

  /** Keyboard handling while suggestions are shown. Returns true if the key was consumed. */
  private suggestKeydown(e: KeyboardEvent, el: HTMLTextAreaElement | HTMLInputElement): boolean {
    const s = this.suggest;
    if (!s || s.key !== el.dataset.fk) return false;
    const n = s.words.length;
    const key = arrowOf(e);
    if (key === 'ArrowDown' || key === 'ArrowUp') {
      e.preventDefault();
      s.selected = key === 'ArrowDown' ? (s.selected + 1) % n : s.selected <= 0 ? n - 1 : s.selected - 1;
      this.rerender();
      return true;
    }
    if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey && !e.metaKey && !e.ctrlKey && s.selected >= 0) {
      e.preventDefault();
      this.acceptSuggestion(s.words[s.selected]);
      return true;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      this.suggest = null;
      this.rerender();
      return true;
    }
    return false;
  }

  /** Put the word in the field: a name moves on to the value (offering its values), a value ends there. */
  acceptSuggestion(word: string) {
    const s = this.suggest;
    if (!s) return;
    const id = s.key.slice(s.key.indexOf(':') + 1);
    this.suggest = null;
    if (s.key.startsWith('fkey:')) {
      this.store.setKey(id, word);
      this.commit(fText(id, 'end'));
      if (!this.store.node(id).text) this.suggestValues(id);
    } else {
      this.store.setText(id, word);
      this.commit(fText(id, 'end'));
    }
    this.rerender();
  }

  // ================================================================ jump

  /** Open or close the jump-to-item box. */
  setJumping(on: boolean) {
    this.jumping = on;
    this.rerender();
  }

  /** Items for the jump box, nearest to where one is first. */
  jumpCandidates(query: string): string[] {
    return linkCandidates(this.store, query, this.zoomId, { limit: 12 });
  }

  /** Zoom into id from the jump box. */
  jumpTo(id: string) {
    this.jumping = false;
    this.zoomTo(id);
    this.rerender();
  }

  /** The outline for the undo history: each node serialized on its own (under its id), the root under ''. */
  private snapshot(): Map<string, string> {
    const state = new Map([['', this.store.rootId]]);
    for (const [id, n] of Object.entries(this.store.nodes)) state.set(id, JSON.stringify(n));
    return state;
  }

  undo() {
    this.restore(this.history.undo(captureFocus()));
  }

  redo() {
    this.restore(this.history.redo(captureFocus()));
  }

  private restore(entry: Entry<Focus | null> | null) {
    if (!entry) return;
    const nodes: Record<string, unknown> = {};
    for (const [id, json] of entry.state) if (id) nodes[id] = JSON.parse(json);
    this.store = OutlineStore.fromJSON({ version: 1, rootId: entry.state.get(''), nodes });
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
    const hideFields = !this.fieldsShown(id);
    const tasks = this.taskRows;
    // With only tasks shown, fields stay with tasks (and inside other fields).
    const keepFields = !tasks || store.isData(id) || store.isTask(id);
    return store.node(id).children.filter((c) => {
      const n = store.node(c);
      if (search && !search.shown.has(c)) return false;
      if (hideDone && n.completed) return false;
      if (tasks && (n.key === null ? !tasks.has(c) : !keepFields)) return false;
      return !(hideFields && n.key !== null && n.format === null); // blocks are content, kept
    });
  }

  /** Whether id's displayed children are rendered: always while searching, and for the rows leading to tasks with only tasks shown. */
  isExpanded(id: string): boolean {
    if (this.search || this.isContextRow(id)) return this.shownChildren(id).length > 0;
    return !this.store.node(id).collapsed;
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

  // ================================================================ selecting rows

  /** The selected rows, top to bottom (empty when the selection no longer fits what is shown). */
  selectedRows(): string[] {
    if (!this.selection) return [];
    const vis = this.visibleRows();
    const a = vis.indexOf(this.selection.anchor);
    const h = vis.indexOf(this.selection.head);
    if (a < 0 || h < 0) return [];
    return vis.slice(Math.min(a, h), Math.max(a, h) + 1);
  }

  /** The selected rows not inside another selected row: what moving or deleting acts on. */
  selectionRoots(): string[] {
    const rows = this.selectedRows();
    const set = new Set(rows);
    return rows.filter((r) => !set.has(this.store.parentOf(r)!));
  }

  /** Select whole rows from anchor to head, leaving any text editor. */
  selectRows(anchor: string, head: string) {
    this.selection = { anchor, head };
    this.activeField = null;
    this.picker = null;
    this.pendingFocus = null;
    (document.activeElement as HTMLElement | null)?.blur?.();
    this.rerender();
  }

  /** Drop the selection, editing focusId if given. */
  clearSelection(focusId?: string) {
    if (!this.selection) return;
    this.selection = null;
    if (focusId) this.focus(fText(focusId));
    else this.rerender();
  }

  /** Keys while rows are selected. Returns true if the key was handled. */
  selectionKeydown(e: KeyboardEvent): boolean {
    const sel = this.selection;
    if (!sel || e.defaultPrevented) return false; // e.g. the Shift+↓ in a row that just started the selection
    const { store } = this;
    const vis = this.visibleRows();
    const rows = this.selectedRows();
    if (!rows.length) {
      this.selection = null;
      return false;
    }
    const key = arrowOf(e);
    const plain = !e.altKey && !isMod(e);
    if (e.key === 'Escape') {
      e.preventDefault();
      this.clearSelection(sel.head);
    } else if ((key === 'ArrowUp' || key === 'ArrowDown') && (key !== e.key || plain)) {
      e.preventDefault();
      if (!e.shiftKey) return this.clearSelection(key === 'ArrowUp' ? rows[0] : rows[rows.length - 1]), true;
      const head = vis[vis.indexOf(sel.head) + (key === 'ArrowDown' ? 1 : -1)];
      if (head) {
        this.selection = { ...sel, head };
        this.rerender();
      }
    } else if (e.key === 'Tab' && plain) {
      e.preventDefault();
      const roots = this.selectionRoots();
      let changed = false;
      if (e.shiftKey) {
        // Bottom up: each goes right after its parent, so the order holds.
        for (const r of [...roots].reverse()) changed = store.outdent(r, this.zoomId) || changed;
      } else {
        const set = new Set(roots);
        for (const r of roots) {
          const sibs = this.shownChildren(store.parentOf(r)!);
          if (set.has(sibs[sibs.indexOf(r) - 1])) continue; // would go into the selection itself
          changed = this.indentShown(r) || changed;
        }
      }
      if (changed) this.commit(null);
    } else if ((e.key === 'Backspace' || e.key === 'Delete') && plain) {
      e.preventDefault();
      const before = vis[vis.indexOf(rows[0]) - 1];
      for (const r of this.selectionRoots()) store.remove(r);
      this.selection = null;
      this.commit(before ? fText(before) : this.zoomId !== store.rootId ? fText(this.zoomId) : null);
    } else if (isMod(e) && !e.altKey && (e.code === 'KeyC' || e.code === 'KeyX')) {
      e.preventDefault();
      const roots = this.selectionRoots();
      void this.copyRows(roots, (id) => this.shownChildren(id));
      if (e.code === 'KeyX') {
        const before = vis[vis.indexOf(rows[0]) - 1];
        for (const r of roots) store.remove(r);
        this.selection = null;
        this.commit(before ? fText(before) : null);
      }
    } else if (e.key === 'Enter' && isMod(e) && e.shiftKey) {
      e.preventDefault();
      this.toggleCompleteAll(this.selectionRoots());
    } else if (isMod(e) && !e.altKey && !e.shiftKey && e.code === 'KeyL') {
      e.preventDefault();
      this.toggleTask(this.selectionRoots());
    } else {
      return false;
    }
    return true;
  }

  /**
   * Work out dependency cycles and the schedule again, if anything they read
   * has changed since last time (typing in an ordinary row doesn't).
   */
  refreshSchedule() {
    const inputs = scheduleInputs(this.store);
    const last = this.scheduledFrom;
    if (last && last.inputs === inputs && last.jpDays === this.jpDays) return;
    this.cycles = findCycles(this.store);
    this.schedule = computeSchedule(this.store, this.cycles, this.jpDays);
    this.scheduledFrom = { inputs, jpDays: this.jpDays };
  }

  /** Switch the UI language (null: follow the browser). */
  setLanguage(l: Lang | null) {
    const { lang: _, ...rest } = this.prefs;
    this.prefs = l ? { ...rest, lang: l } : rest;
    savePrefs(this.prefs);
    setLang(l ?? browserLang());
    this.rerender();
  }

  setFieldsMode(fields: FieldsMode) {
    this.prefs = { ...this.prefs, fields };
    this.openFields.clear();
    savePrefs(this.prefs);
    this.rerender();
  }

  /** Whether id's field rows are on screen: always, never, or when folded, if opened, zoomed into or being edited. */
  fieldsShown(id: string): boolean {
    const mode = this.prefs.fields;
    if (mode !== 'fold') return mode === 'show';
    if (id === this.zoomId || this.openFields.has(id)) return true; // zoomed in: its own fields are the point
    const editing = this.activeField?.replace(/^\w+:/, '');
    return !!editing && editing !== id && !!this.store.get(editing) && this.store.owner(editing) === id;
  }

  /** Open or close one row's folded fields. */
  toggleFieldsOpen(id: string) {
    if (this.openFields.delete(id)) return this.rerender();
    this.openFields.add(id);
    // A collapsed row shows no children at all, fields included.
    if (this.store.setCollapsed(id, false)) this.commit();
    else this.rerender();
  }

  /** Before adding a field: make sure it will be seen (hidden fields become folded, and this one is edited). */
  private revealFields() {
    if (this.prefs.fields === 'hide') this.setFieldsMode('fold');
  }

  /** The tasks under the zoomed item and the rows leading to them, for showing only tasks. */
  findTaskRows(): Set<string> {
    const { store } = this;
    const out = new Set<string>();
    const walk = (id: string): boolean => {
      let any = false;
      for (const c of store.items(id)) if (walk(c)) any = true;
      if (any || store.isTask(id)) out.add(id);
      return any || store.isTask(id);
    };
    walk(this.zoomId);
    return out;
  }

  /** A row shown only because tasks sit under it (with only tasks shown). */
  isContextRow(id: string): boolean {
    return !!this.taskRows && this.store.node(id).key === null && !this.store.isTask(id);
  }

  toggleTasksOnly() {
    this.prefs = { ...this.prefs, tasksOnly: !this.prefs.tasksOnly };
    savePrefs(this.prefs);
    this.rerender();
  }

  /** Make rows tasks, or (when they all are) plain rows again; a row no longer a task is not completed either. */
  toggleTask(ids: string[]) {
    const { store } = this;
    const items = ids.filter((id) => store.node(id).key === null && id !== store.rootId);
    if (!items.length) return;
    const on = !items.every((id) => store.isTask(id));
    for (const id of items) {
      if (!on) this.setDone(id, false);
      store.setTask(id, on);
    }
    this.commit();
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
  /**
   * Put rows on the clipboard as a Markdown list (with what children picks
   * under them), and keep them whole for pasting back here as they were.
   */
  private copyRows(ids: string[], children: (id: string) => string[]): Promise<void> {
    const text = toMarkdownRows(this.store, ids, children);
    this.copied = { text, rows: ids.map((r) => copyOf(this.store, r)) };
    return navigator.clipboard.writeText(text);
  }

  /** Copy an item with everything under it, hidden and folded rows too. */
  copyTree(id: string) {
    const count = 1 + this.store.descendantCount(id);
    this.copyRows([id], (c) => this.store.node(c).children).then(
      () =>
        this.showToast(
          t(`${count} 行をコピーしました。行に貼り付けると、そのままの形で入ります`, `Copied ${count} rows. Paste into a row to put them back as they are`)
        ),
      () => this.showToast(t('クリップボードにコピーできませんでした', 'Couldn’t copy to the clipboard'))
    );
  }

  copyLink(id: string) {
    navigator.clipboard.writeText(`[[${id}]]`).then(
      () =>
        this.showToast(
          t('リンクをコピーしました。本文や属性の値に貼り付けると参照になります', 'Link copied. Paste it into a row or a field value to refer to this item')
        ),
      () => this.showToast(t('クリップボードにコピーできませんでした', 'Couldn’t copy to the clipboard'))
    );
  }

  /** Complete or reopen an item; completing records the day in a `completed` field, reopening removes it. */
  toggleComplete(id: string) {
    const vis = this.visibleRows();
    const idx = vis.indexOf(id);
    const n = this.store.node(id);
    this.setDone(id, !n.completed);
    let focus: Focus | null | undefined; // undefined keeps focus where it is
    if (n.completed && !this.prefs.showCompleted) {
      // Skip the row's own (now hidden) subtree when choosing the next row.
      const next = vis.slice(idx + 1).find((r) => !this.store.isAncestor(id, r));
      focus = next ? fText(next, 0) : vis[idx - 1] ? fText(vis[idx - 1]) : null;
    }
    this.commit(focus);
  }

  /** Complete or reopen several items as one step: all completed, unless they all are already. */
  toggleCompleteAll(ids: string[]) {
    const items = ids.filter((id) => this.store.node(id).key === null);
    if (!items.length) return;
    const done = !items.every((id) => this.store.node(id).completed);
    for (const id of items) this.setDone(id, done);
    this.commit();
  }

  private setDone(id: string, done: boolean) {
    const { store } = this;
    if (store.node(id).completed === done) return;
    store.setCompleted(id, done);
    if (store.node(id).key !== null) return;
    store.setTask(id, true); // what was completed was something to do
    const f = store.field(id, DONE_KEY);
    if (done && !f) store.addField(id, DONE_KEY, formatDate(today()));
    else if (done && f && !f.text.trim()) store.setText(f.id, formatDate(today()));
    else if (!done && f && !f.children.length) store.remove(f.id);
  }

  // ================================================================ zoom

  /**
   * Take the zoomed item and view from the URL (#/id?view=gantt). Without a
   * view, an item opens the way it was last viewed.
   */
  private readHash() {
    // The usage guide: the outline stays as it was underneath.
    this.docs = /^#\/docs(?:\?|$)/.test(location.hash);
    if (this.docs) {
      this.zoomId ??= this.store.rootId; // opened straight onto the guide: home is underneath
      return;
    }
    const m = location.hash.match(/^#\/([^?]*)(?:\?(.*))?$/);
    const raw = m?.[1] ? decodeURIComponent(m[1]) : this.store.rootId;
    // A field or block can't be zoomed into: its item is shown instead.
    this.zoomId = this.store.get(raw) ? this.store.owner(raw) : this.store.rootId;
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
    if (this.store.get(id)) id = this.store.owner(id); // fields and blocks open their item
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

  /** Where the caret goes once the outline is shown again (from openRow). */
  private focusAfterHash: Focus | null = null;

  /** From another view (the diagram): edit id's row in the outline, opening the rows it is under. */
  openRow(id: string) {
    const { store } = this;
    let opened = false;
    for (let p = store.parentOf(id); p && p !== this.zoomId; p = store.parentOf(p)) opened = store.setCollapsed(p, false) || opened;
    if (opened) this.commit();
    this.focusAfterHash = fText(id);
    this.setView('outline');
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
    if (this.docs) {
      window.scrollTo(0, 0);
      return this.rerender();
    }
    if (this.zoomId === prev && this.view !== prevView) {
      // Only the view changed: keep scroll, focus the item's first row.
      const first = this.view === 'outline' ? this.visibleRows()[0] : undefined;
      this.focus(this.view === 'outline' && this.focusAfterHash ? this.focusAfterHash : first ? fText(first) : null);
      this.focusAfterHash = null;
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
    this.revealFields();
    const f = this.store.addField(id, '');
    this.commit(fKey(f.id));
    this.suggestKeys(f.id);
    this.rerender();
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
      this.suggestValues(id);
      return this.rerender();
    }
    store.setText(id, value);
    this.updatePicker(ta, id);
    if (n.key !== null) this.suggestValues(id);
    this.commit(undefined, 'text:' + id);
  }

  onKeyInput(id: string, input: HTMLInputElement) {
    const v = input.value;
    // Typing the colon (YAML habit) moves on to the value.
    if (v.endsWith(':')) {
      this.store.setKey(id, v.slice(0, -1));
      this.commit(fText(id, 0));
      if (!this.store.node(id).text) this.suggestValues(id);
      return this.rerender();
    }
    this.store.setKey(id, v);
    this.suggestKeys(id);
    this.commit(undefined, 'fkey:' + id);
  }

  onKeyKeydown(e: KeyboardEvent, input: HTMLInputElement) {
    if (this.suggestKeydown(e, input)) return;
    const id = input.dataset.id!;
    const key = arrowOf(e);
    const caret = input.selectionStart === input.selectionEnd ? input.selectionStart : null;
    if (e.key === 'Enter' || e.key === 'Tab' || e.key === 'Escape') {
      e.preventDefault();
      this.focus(fText(id, e.key === 'Escape' ? 'end' : 0));
      if (e.key !== 'Escape' && !this.store.node(id).text) {
        this.suggestValues(id);
        this.rerender();
      }
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

  /** Replace a row's text from a tool (link editing) and put the caret at caret. */
  replaceText(id: string, text: string, caret: number) {
    this.store.setText(id, text);
    this.commit(fText(id, caret));
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
    this.revealFields();
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
    this.revealFields();
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

  /** Move rows (with their subtrees, in this order) under parentId, before beforeId or at the end. */
  moveNodes(ids: string[], parentId: string, beforeId: string | null) {
    const kids = this.store.node(parentId).children;
    while (beforeId && ids.includes(beforeId)) beforeId = kids[kids.indexOf(beforeId) + 1] ?? null;
    let changed = false;
    for (const id of ids) changed = this.store.moveTo(id, parentId, beforeId) || changed;
    if (changed) this.commit();
  }

  /** Append the scheduling sample at the end of the top level and zoom into it. */
  addSample() {
    const id = addScheduleSample(this.store, this.store.rootId);
    this.commit(null);
    this.zoomTo(id);
  }

  /** Append the architecture sample at the end of the top level and open it as a diagram. */
  addDiagramSample() {
    const id = addDiagramSample(this.store, this.store.rootId);
    this.commit(null);
    location.hash = this.hashFor(id, 'diagram');
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
    if (this.pickerKeydown(e, ta) || this.suggestKeydown(e, ta)) return;
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
      // The new row goes first among the sub-items, after the fields; with fields only, it's the next sibling.
      const firstItem = this.shownChildren(id).find((c) => !store.isField(c));
      const next =
        firstItem && this.isExpanded(id)
          ? store.addChild(id, store.indexOf(firstItem), after)
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
      // Only into a row of the same kind: an item into an item, a list element into a list element.
      const pn = prev ? store.node(prev) : null;
      if (pn && pn.key === null && pn.format === null && store.isData(prev) === store.isData(id)) {
        e.preventDefault();
        const pos = pn.text.length;
        store.mergeInto(id, prev);
        return this.commit(fText(prev, pos));
      }
      return;
    }
    // Delete (or macOS Ctrl+D, or Ctrl+K with nothing left to delete) at the end pulls the next row up
    // into this one. Before the end, macOS's Ctrl+K deletes to the end of the line itself.
    const emacs = IS_MAC && e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;
    const forwardDelete = e.key === 'Delete' || (emacs && (e.code === 'KeyD' || e.code === 'KeyK'));
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

    // ---- Shift+↑↓ with the text selected to its end selects whole rows
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && e.shiftKey && !e.altKey && !isMod(e) && !isTitle) {
      const down = e.key === 'ArrowDown';
      if (down ? end === ta.value.length : start === 0) {
        e.preventDefault();
        this.selectRows(id, vis[idx + (down ? 1 : -1)] ?? id);
        return;
      }
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
    if (e.key === 'Enter' && isMod(e) && !e.altKey) {
      e.preventDefault();
      if (e.shiftKey) {
        if (!isTitle) this.toggleComplete(id);
        return;
      }
      // A new row right below this one and the rows under it, wherever the caret is.
      if (isTitle) return this.commit(fText(store.addChild(id, 0).id, 0));
      return this.commit(fText(store.addSiblingAfter(id).id, 0));
    }
    if (isMod(e) && !e.altKey && !e.shiftKey && e.code === 'KeyL') {
      e.preventDefault();
      this.toggleTask([id]);
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
    // A field with a value is a leaf: `owner: [[x]]` can't also hold children; nor can a block, even empty.
    const pn = prev && this.store.node(prev);
    if (!pn || (pn.key !== null && (pn.text.trim() || pn.format !== null))) return false;
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


  /**
   * Paste indented text (YAML, a nested list): the rows go after the current
   * one, keeping their nesting; `key: value` lines become fields.
   */
  private pasteTree(e: ClipboardEvent, ta: HTMLTextAreaElement, tree: TextRow[]) {
    const { store } = this;
    const add = (parent: string, index: number, r: TextRow): string => {
      const n = store.addChild(parent, index, r.text);
      n.key = r.key;
      n.format = r.key !== null ? (r.format ?? null) : null;
      // A checklist line (`- [ ]`, `- [x]`) comes in as a task.
      if (r.task) n.task = true;
      if (r.task === 'done') this.setDone(n.id, true);
      r.children.forEach((c) => add(n.id, -1, c));
      return n.id;
    };
    this.pasteRows(e, ta, tree, add);
  }

  /** Paste rows copied here: copies of them as they were, fields, blocks and all. */
  private pasteCopied(e: ClipboardEvent, ta: HTMLTextAreaElement, rows: Copied[]) {
    const { store } = this;
    const add = (parent: string, index: number, r: Copied): string => {
      const n = store.addChild(parent, index, r.text);
      r.children.forEach((c) => add(n.id, -1, c));
      // After the children, as adding one opens its parent.
      Object.assign(n, { key: r.key, format: r.format, completed: r.completed, task: r.task, collapsed: r.collapsed });
      return n.id;
    };
    this.pasteRows(e, ta, rows, add);
  }

  /** Put rows after the row being edited (or into it, when it is empty), each made by add. */
  private pasteRows<T>(e: ClipboardEvent, ta: HTMLTextAreaElement, tree: T[], add: (parent: string, index: number, r: T) => string) {
    e.preventDefault();
    const { store } = this;
    const id = ta.dataset.id!;
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

  /** Pasting multiple lines into a row creates one sibling per line (or rows, for indented text). */
  onTextPaste(e: ClipboardEvent, ta: HTMLTextAreaElement) {
    const text = e.clipboardData?.getData('text') ?? '';
    const lf = (t: string) => t.replace(/\r\n?/g, '\n').trimEnd();
    if (this.copied && lf(text) === lf(this.copied.text)) return this.pasteCopied(e, ta, this.copied.rows);
    if (!text.includes('\n')) return;
    const tree = parseOutlineText(text);
    if (tree.some((r) => r.key !== null || r.children.length || r.task)) return this.pasteTree(e, ta, tree);
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
