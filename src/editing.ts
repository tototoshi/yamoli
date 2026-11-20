/*
 * Editing operations on top of ViewState: typing into rows and fields, the
 * `[[` link picker and completions, the jump box, the item menu and toasts,
 * tasks and completion, fields, blocks, dependencies and the samples.
 */
import { formatDate, parseDate, parseDateInput, shortDate, today, weekday } from './calendar';
import { DEP_KEY } from './deps';
import { addDfdSample, addDiagramSample, addGuideSlides, addMindMapSample, addScheduleSample } from './sample';
import { headingOf } from './doc';
import { t } from './i18n';
import { dateQueryAt, keyCandidates, linkCandidates, nodeLabel, pickerQueryAt, valueCandidates } from './links';
import { FIELD_TYPED } from './fields';
import { CODE_FENCE, codeFormat } from './formats';
import { fKey, fText, type Focus } from './focus';
import { arrowOf } from './keys';
import { ViewState } from './viewState';
import { VIEWS_KEY, type DrawnView } from './views';
import { isImageRef, uploadFile } from './files';
import { canAddFiles } from './storage';
import { addImage } from './slides';

/** The field that records when an item was completed. */
const DONE_KEY = 'completed';

/** Fields whose values are not worth offering again: dates, and links (which have the `[[` picker). */
const NO_VALUE_SUGGEST = new Set([DEP_KEY, 'start', 'end', 'due', DONE_KEY]);

/** `[ ] ` (or `[x] ` done, `[] `, full-width too) typed at the start of a row. */
const CHECKBOX_TYPED = /^[[［]([ 　xX]?)[\]］][ 　]/;

/**
 * What `//` offers: today and the days around it, or the date typed after it
 * (`11/25`, `2026-12-01`, `+3` for days from today); last, a calendar.
 */
export function dateChoices(query: string, now: number): { label: string; day: number | null }[] {
  const q = query.trim().toLowerCase();
  const week = t('日 月 火 水 木 金 土', 'Sun Mon Tue Wed Thu Fri Sat').split(' ');
  const named = (label: string, day: number) => ({ label: `${label}  ${shortDate(day, now)} (${week[weekday(day)]})`, day });
  const nextMonday = now + ((8 - weekday(now)) % 7 || 7);
  const words: [string[], number][] = [
    [[t('今日', 'Today'), 'today', 'きょう'], now],
    [[t('明日', 'Tomorrow'), 'tomorrow', 'あした'], now + 1],
    [[t('昨日', 'Yesterday'), 'yesterday', 'きのう'], now - 1],
    [[t('来週の月曜', 'Next Monday'), 'monday', 'らいしゅう'], nextMonday],
  ];
  const plus = q.match(/^\+(\d{1,3})$/);
  const typed = plus ? now + Number(plus[1]) : q ? parseDateInput(q, now) : null;
  const choices =
    typed !== null
      ? [named(plus ? `+${plus[1]}` : formatDate(typed), typed)]
      : words.filter(([names]) => !q || names.some((w) => w.toLowerCase().startsWith(q))).map(([names, day]) => named(names[0], day));
  return [...choices, { label: t('カレンダーで選ぶ…', 'Pick from a calendar…'), day: null }];
}

export class Editing extends ViewState {
  private toastTimer: ReturnType<typeof setTimeout> | undefined;

  // ================================================================ link picker

  /** Open, update or close the picker after the field's value or caret changed (`[[` for a link, `//` for a date). */
  /**
   * text (```, or ```ts with its language) on row id: the row becomes a code block where it is, being written
   * in, as its own undo step. Not a row holding rows (a block holds none), the title or a field. Whether it did.
   */
  makeCode(id: string, text: string): boolean {
    const { store } = this;
    const m = text.match(CODE_FENCE);
    const n = store.node(id);
    if (!m || n.key !== null || id === this.zoomId || store.items(id).length) return false;
    store.setKey(id, store.freeKey(store.parentOf(id)!, 'code'));
    store.setFormat(id, codeFormat(m[1]));
    store.setText(id, '');
    this.revealFields();
    this.commit(fText(id, 0));
    return true;
  }

  updatePicker(el: HTMLTextAreaElement | HTMLInputElement, selfId: string) {
    const caret = el.selectionStart ?? 0;
    const key = el.dataset.fk!;
    const q = pickerQueryAt(el.value, caret);
    if (q) {
      const candidates = linkCandidates(this.store, q.query, selfId, { deps: this.inDependencies(selfId) });
      this.picker = { key, from: q.from, to: caret, candidates, selected: 0 };
      return;
    }
    const d = key.startsWith('text:') ? dateQueryAt(el.value, caret) : null;
    this.picker = d ? { key, from: d.from, to: caret, candidates: [], dates: dateChoices(d.query, today()), selected: 0 } : null;
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
    const n = p.dates?.length ?? p.candidates.length;
    const key = arrowOf(e);
    if ((key === 'ArrowDown' || key === 'ArrowUp') && n) {
      e.preventDefault();
      p.selected = (p.selected + (key === 'ArrowDown' ? 1 : -1) + n) % n;
      this.rerender();
      return true;
    }
    if ((e.key === 'Enter' || e.key === 'Tab') && n) {
      e.preventDefault();
      if (p.dates) this.insertDate(p.dates[p.selected].day);
      else this.insertLink(p.candidates[p.selected]);
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

  /** Replace the `//query` before the caret with day (null: one picked from a calendar, first). */
  insertDate(day: number | null) {
    const p = this.picker;
    if (!p?.dates) return;
    const id = p.key.slice('text:'.length);
    if (day === null) return this.pickFromCalendar(p.key, (d) => this.writeDate(id, p.from, p.to, d));
    this.writeDate(id, p.from, p.to, day);
  }

  private writeDate(id: string, from: number, to: number, day: number) {
    const text = this.store.node(id).text;
    const date = formatDate(day);
    this.store.setText(id, text.slice(0, from) + date + text.slice(to));
    this.picker = null;
    this.commit(fText(id, from + date.length));
  }

  /** The browser's own calendar, opened under the field with focus key; picked calls back with the day. */
  private pickFromCalendar(key: string, picked: (day: number) => void) {
    const field = document.querySelector(`[data-fk="${CSS.escape(key)}"]`);
    const r = field?.getBoundingClientRect();
    const input = Object.assign(document.createElement('input'), { type: 'date', value: formatDate(today()) });
    Object.assign(input.style, { position: 'fixed', left: `${r?.left ?? 0}px`, top: `${r?.bottom ?? 0}px`, opacity: '0', width: '1px' });
    document.body.append(input);
    input.addEventListener('change', () => {
      const d = parseDate(input.value);
      input.remove();
      if (d !== null) picked(d);
    });
    input.addEventListener('blur', () => setTimeout(() => input.remove(), 0));
    try {
      input.showPicker();
    } catch {
      input.focus();
    }
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
    // Bookmarks whose name has the query come first (all of them, with nothing typed), then the rest.
    const q = query.trim().normalize('NFKC').toLowerCase();
    const marked = this.store.bookmarks().filter((id) => nodeLabel(this.store, id).normalize('NFKC').toLowerCase().includes(q));
    const rest = linkCandidates(this.store, query, this.zoomId, { limit: 12 }).filter((id) => !marked.includes(id));
    return [...marked, ...rest].slice(0, Math.max(12, marked.length));
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

  /**
   * Commit a field just added, the caret going to focus: in the outline,
   * switched to from another view (the diagram …), which draws no fields to type in.
   */
  private commitField(focus: Focus) {
    if (this.view === 'outline') return this.commit(focus);
    this.commit();
    this.focusAfterHash = focus;
    this.setView('outline');
  }

  /** Bookmark rows, or (when they all are) take them out of the bookmarks. */
  toggleBookmark(ids: string[]) {
    const { store } = this;
    // On a field, the item it is of.
    const items = [...new Set(ids.map((id) => store.owner(id)))].filter((id) => id !== store.rootId);
    if (!items.length) return;
    const on = !items.every((id) => store.node(id).bookmarked);
    for (const id of items) store.node(id).bookmarked = on;
    this.commit();
    this.showToast(
      on
        ? t('ブックマークしました（上部の栞のボタンから開けます）', 'Bookmarked (open it from the bookmark button at the top)')
        : t('ブックマークから外しました', 'Taken out of the bookmarks')
    );
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
    this.commitField(fKey(f.id));
    this.suggestKeys(f.id);
    this.rerender();
  }

  // ================================================================ fields

  /**
   * Text typed into a row. Typing `name: ` at the start of an ordinary row
   * turns it into a field (Backspace at the start of the value turns it back);
   * `[ ] ` makes it a task (`[x] ` a completed one), Backspace at its start a
   * plain row again; ``` on an empty row makes it a code block.
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
    const box = n.key === null && id !== this.zoomId ? value.match(CHECKBOX_TYPED) : null;
    if (box && ta.selectionStart === box[0].length && !n.text.startsWith(box[0])) {
      store.setText(id, value.slice(box[0].length));
      store.setTask(id, true);
      if (box[1].trim()) this.setDone(id, true);
      this.commit(fText(id, 0)); // its own undo step, so ⌘Z turns it back
      return this.rerender();
    }
    // ``` and a space (```ts and a space for its language) on a row makes it a code block.
    const fence = value.match(/^(```[\w+#.-]*) $/);
    if (fence && this.makeCode(id, fence[1])) return;
    // `- ` typed at the start of a paragraph makes it a list item again.
    const bullet = n.paragraph && n.key === null ? value.match(/^[-*・][ \u3000]/) : null;
    if (bullet && ta.selectionStart === 2 && !n.text.startsWith(bullet[0])) {
      store.setText(id, value.slice(2));
      n.paragraph = false;
      return this.commit(fText(id, 0)); // its own undo step, so ⌘Z turns it back
    }
    // `# ` typed (or taken away): in the document the line is drawn anew, as a heading or in a list, the caret kept in it.
    const redrawn = n.key === null && headingOf(n.text)?.level !== headingOf(value)?.level;
    store.setText(id, value);
    this.updatePicker(ta, id);
    if (n.key !== null) this.suggestValues(id);
    if (redrawn) return this.commit(fText(id, ta.selectionStart, ta.selectionEnd), 'text:' + id);
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
  replaceText(id: string, text: string, caret: number, end?: number) {
    this.store.setText(id, text);
    this.commit(fText(id, caret, end));
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

  /** Keep images beside the outline file and add them to the pictures of item id (its `image` field, a slide's). */
  addImages(id: string, files: File[]) {
    if (!canAddFiles()) {
      return this.showToast(
        t(
          '画像は、ファイルに保存しているとき（npm run dev / preview）だけ追加できます',
          'Pictures can only be added when the outline is saved to a file (npm run dev / preview)'
        )
      );
    }
    this.showToast(t('画像を保存しています…', 'Saving the picture…'));
    Promise.all(files.map(uploadFile)).then(
      (kept) => {
        const { store } = this; // the outline may have been replaced (undo) while uploading
        this.hideToast();
        if (!store.get(id)) return;
        for (const { ref } of kept) addImage(store, id, ref);
        this.commit(null);
      },
      (e: Error) => this.showToast(t('保存できませんでした: ', 'Couldn’t save it: ') + e.message)
    );
  }

  /** Add a block (multi-line field, Markdown by default) and start writing in it. */
  addBlock(id: string, format = 'markdown') {
    this.revealFields();
    const f = this.store.addBlock(id, this.store.freeKey(id, 'note'), format);
    this.commitField(fText(f.id, 0));
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
    this.commitField({ key, start: 'end' });
    const candidates = linkCandidates(this.store, '', id, { deps: true });
    this.picker = { key, from: f.text.length - 2, to: f.text.length, candidates, selected: 0 };
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
