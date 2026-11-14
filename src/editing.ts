/*
 * Editing operations on top of ViewState: typing into rows and fields, the
 * `[[` link picker and completions, the jump box, the item menu and toasts,
 * tasks and completion, fields, blocks, dependencies and the samples.
 */
import { formatDate, today } from './calendar';
import { DEP_KEY } from './deps';
import { addDfdSample, addDiagramSample, addGuideSlides, addMindMapSample, addScheduleSample } from './sample';
import { t } from './i18n';
import { keyCandidates, linkCandidates, pickerQueryAt, valueCandidates } from './links';
import { FIELD_TYPED } from './fields';
import { fKey, fText, type Focus } from './focus';
import { arrowOf } from './keys';
import { ViewState } from './viewState';
import { VIEWS_KEY, type DrawnView } from './views';
import { isImageRef, uploadFile } from './files';
import { canAddFiles } from './storage';

/** The field that records when an item was completed. */
const DONE_KEY = 'completed';

/** Fields whose values are not worth offering again: dates, and links (which have the `[[` picker). */
const NO_VALUE_SUGGEST = new Set([DEP_KEY, 'start', 'end', 'due', DONE_KEY]);

export class Editing extends ViewState {
  private toastTimer: ReturnType<typeof setTimeout> | undefined;

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
  protected pickerKeydown(e: KeyboardEvent, el: HTMLTextAreaElement | HTMLInputElement): boolean {
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
  protected suggestValues(id: string) {
    const n = this.store.node(id);
    const name = n.key?.trim().toLowerCase();
    const words =
      name && !NO_VALUE_SUGGEST.has(name) && !this.picker && !n.text.includes('\n')
        ? valueCandidates(this.store, name, n.text).filter((v) => !/^\d{4}-\d\d-\d\d/.test(v))
        : [];
    this.suggest = words.length ? { key: 'text:' + id, words, selected: -1 } : null;
  }

  /** Keyboard handling while suggestions are shown. Returns true if the key was consumed. */
  protected suggestKeydown(e: KeyboardEvent, el: HTMLTextAreaElement | HTMLInputElement): boolean {
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

  /** Before adding a field: make sure it will be seen (hidden fields become folded, and this one is edited). */
  private revealFields() {
    if (this.prefs.fields === 'hide') this.setFieldsMode('fold');
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

  protected setDone(id: string, done: boolean) {
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
    this.commit(undefined, 'text:' + id, this.rowsShowing(id));
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

  /** The row the caret goes to before this one: the one shown above, else the zoomed item's title. */
  protected rowBefore(id: string): string | null {
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
  protected unfield(id: string, caret?: number) {
    const n = this.store.node(id);
    const prefix = n.key ? `${n.key}: ` : '';
    this.store.setKey(id, null);
    this.store.setFormat(id, null);
    this.store.setText(id, prefix + n.text);
    this.commit(fText(id, caret ?? prefix.length));
  }

  /** Turn a view on for the zoomed item and everything under it (in its `views` field), and show it. */
  enableView(view: DrawnView) {
    const f = this.store.field(this.zoomId, VIEWS_KEY);
    const v = f?.text.trim();
    if (f) this.store.setText(f.id, v ? `${v}, ${view}` : view);
    else this.store.addField(this.zoomId, VIEWS_KEY, view);
    this.commit(null);
    this.setView(view);
  }

  /**
   * Keep files (pasted or dropped on row id) beside the outline file, and add
   * each to the row's item as a block: an image shown, anything else a file to
   * download (its reference, name and size, one per line).
   */
  addFiles(id: string, files: File[]) {
    if (!canAddFiles()) {
      return this.showToast(
        t(
          '画像やファイルは、ファイルに保存しているとき（npm run dev / preview）だけ追加できます',
          'Images and files can only be added when the outline is saved to a file (npm run dev / preview)'
        )
      );
    }
    const owner = this.store.owner(id);
    this.showToast(t('ファイルを保存しています…', 'Saving…'));
    Promise.all(files.map(uploadFile)).then(
      (kept) => {
        const { store } = this; // the outline may have been replaced (undo) while uploading
        if (!store.get(owner)) return this.hideToast();
        kept.forEach(({ ref, size }, i) => {
          if (isImageRef(ref)) store.addBlock(owner, store.freeKey(owner, 'image'), 'image', ref);
          else store.addBlock(owner, store.freeKey(owner, 'file'), 'file', `${ref}\n${files[i].name}\n${size}`);
        });
        store.setCollapsed(owner, false);
        this.hideToast();
        this.commit();
      },
      (e: Error) => this.showToast(t('保存できませんでした: ', 'Couldn’t save it: ') + e.message)
    );
  }

  /** Add a block (multi-line field, Markdown by default) and start writing in it. */
  addBlock(id: string, format = 'markdown') {
    this.revealFields();
    const f = this.store.addBlock(id, this.store.freeKey(id, 'note'), format);
    this.commit(fText(f.id, 0));
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

  /** Add the sample data flow diagram and open it in the Diagram view. */
  addDfdSample() {
    const id = addDfdSample(this.store, this.store.rootId);
    this.commit(null);
    location.hash = this.hashFor(id, 'diagram');
  }

  /** Add the sample mind map and open it in the Mind map view. */
  addMindMapSample() {
    const id = addMindMapSample(this.store, this.store.rootId);
    this.commit(null);
    location.hash = this.hashFor(id, 'mindmap');
  }

  /** Add the usage guide deck and open it as slides. */
  addGuide() {
    const id = addGuideSlides(this.store, this.store.rootId);
    this.commit(null);
    this.slide = 0;
    location.hash = this.hashFor(id, 'slides');
  }
}
