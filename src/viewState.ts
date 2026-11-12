/*
 * The outline being edited and how it is shown: the store, zoom and view,
 * preferences, undo, search, the rows on screen and the selection of rows,
 * the schedule, and rendering (commit() saves and asks the App to re-render,
 * optionally moving focus). Editing (editing.ts) and the keys (controller.ts)
 * build on it.
 */
import { findCycles } from './deps';
import { computeSchedule, scheduleInputs, type ScheduleResult } from './schedule';
import { UndoHistory, type Entry } from './history';
import { browserLang, setLang, type Lang } from './i18n';
import { OutlineStore } from './model';
import { parseQuery, searchTree, wantsCompleted, type SearchResult, type Term } from './search';
import { flush, load, loadPrefs, onExternalChange, onSaveState, resolveConflict, save, savePrefs, type FieldsMode } from './storage';
import { captureFocus, fText, type Focus } from './focus';
import { enabledViews, isDrawn, VIEWS, type View } from './views';

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

/** State of the `[[` link picker attached to one editable field. */
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

export class ViewState {
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

  private renderApp: () => void = () => {};

  /**
   * Rows that may look different since the last render (with the rows above
   * them); null: any row may. Typing in a row only redraws the rows that show it.
   */
  private changedRows: Set<string> | null = null;

  constructor() {
    this.readHash();
    onSaveState(() => this.rerenderRows([]));
    onExternalChange((next) => this.applyExternal(next));
  }

  bind(render: () => void) {
    this.renderApp = render;
  }

  /** Render again, every row included. */
  protected rerender() {
    this.changedRows = null;
    this.renderApp();
  }

  /** Render again, redrawing only these rows (and those above them) of the outline. */
  private rerenderRows(ids: Iterable<string>) {
    if (this.changedRows) for (const id of ids) for (let n: string | undefined = id; n; n = this.store.parentOf(n)) this.changedRows.add(n);
    this.renderApp();
  }

  /** For the render under way: the rows to draw again (null: all). */
  takeChangedRows(): ReadonlySet<string> | null {
    const rows = this.changedRows;
    this.changedRows = new Set();
    return rows;
  }

  /**
   * The rows that show id's text: id itself, and rows linking to it ([[id]]),
   * whose labels include its text, up to the depth nodeLabel follows links.
   */
  protected rowsShowing(id: string): string[] {
    const out = [id];
    const nodes = Object.values(this.store.toJSON().nodes);
    for (let i = 0, depth = 0; depth < 3 && i < out.length; depth++) {
      const end = out.length;
      for (; i < end; i++) {
        const ref = '[[' + out[i] + ']]';
        for (const n of nodes) if (n.text.includes(ref) && !out.includes(n.id)) out.push(n.id);
      }
    }
    return out;
  }

  /**
   * Record an undo step, save and re-render. focus=undefined leaves focus where it is.
   * Commits sharing a `coalesce` key (e.g. typing in one field) merge into one undo step.
   * `rows`: the only rows the change shows in, when known (else all are redrawn).
   */
  commit(focus?: Focus | null, coalesce?: string, rows?: Iterable<string>) {
    this.history.record(this.snapshot(), captureFocus(), coalesce ?? null);
    save(this.store);
    if (focus !== undefined) this.setPendingFocus(focus);
    if (this.search) this.extendSearch(focus);
    if (rows && !this.search) this.rerenderRows(rows);
    else this.rerender();
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

  /**
   * Work out dependency cycles and the schedule again (returning true), if anything they read
   * has changed since last time (typing in an ordinary row doesn't).
   */
  refreshSchedule(): boolean {
    const inputs = scheduleInputs(this.store);
    const last = this.scheduledFrom;
    if (last && last.inputs === inputs && last.jpDays === this.jpDays) return false;
    this.cycles = findCycles(this.store);
    this.schedule = computeSchedule(this.store, this.cycles, this.jpDays);
    this.scheduledFrom = { inputs, jpDays: this.jpDays };
    return true;
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

  toggleShowCompleted() {
    this.prefs = { ...this.prefs, showCompleted: !this.prefs.showCompleted };
    savePrefs(this.prefs);
    this.rerender();
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
    if (asked && VIEWS.includes(asked) && this.canShow(asked)) {
      this.view = asked;
      this.rememberView();
    } else {
      const remembered = this.prefs.views[this.zoomId];
      this.view = remembered && this.canShow(remembered) ? remembered : 'outline';
      if (this.view !== 'outline' || asked)
        window.history.replaceState(null, '', this.hashFor(this.zoomId, this.view === 'outline' ? undefined : this.view));
    }
  }

  /** Whether the zoomed item can be shown as view: the Gantt chart, diagram and slides only where a `views` field turns them on. */
  canShow(view: View): boolean {
    return !isDrawn(view) || enabledViews(this.store, this.zoomId).has(view);
  }

  /** Back to the outline when the view on screen is no longer turned on (its `views` field changed, or was undone). */
  keepViewShowable() {
    if (this.docs || this.canShow(this.view)) return;
    this.view = 'outline';
    window.history.replaceState(null, '', this.hashFor(this.zoomId));
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

  setGanttDates(show: boolean) {
    this.prefs = { ...this.prefs, ganttDates: show };
    savePrefs(this.prefs);
    this.rerender();
  }

  setGanttZoom(zoom: number) {
    this.prefs = { ...this.prefs, ganttZoom: zoom };
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
}
