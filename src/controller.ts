/*
 * The controller the UI talks to: ViewState and Editing (the state and the
 * editing operations), plus the keys in rows, fields, blocks and selected
 * rows, and copying and pasting rows.
 */
import { t } from './i18n';
import { parseOutlineText, type TextRow } from './fields';
import { OutlineStore } from './model';
import { toMarkdownRows } from './serialize';
import { fKey, fText } from './focus';
import { arrowOf, IS_MAC, isMod } from './keys';
import { Editing } from './editing';

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

export class Controller extends Editing {
  // ================================================================ copying

  /** The rows last copied here, whole, for pasting them back as they were (not as the text written out). */
  private copied: { text: string; rows: Copied[] } | null = null;

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
          t(
            `${count} 行をコピーしました。行に貼り付けると、そのままの形で入ります`,
            `Copied ${count} rows. Paste into a row to put them back as they are`
          )
        ),
      () => this.showToast(t('クリップボードにコピーできませんでした', 'Couldn’t copy to the clipboard'))
    );
  }

  /** Put a [[link]] to id on the clipboard, to paste into text or an `after`. */
  copyLink(id: string) {
    navigator.clipboard.writeText(`[[${id}]]`).then(
      () =>
        this.showToast(
          t(
            'リンクをコピーしました。本文や属性の値に貼り付けると参照になります',
            'Link copied. Paste it into a row or a field value to refer to this item'
          )
        ),
      () => this.showToast(t('クリップボードにコピーできませんでした', 'Couldn’t copy to the clipboard'))
    );
  }

  // ================================================================ selected rows

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
      if (!e.shiftKey) return (this.clearSelection(key === 'ArrowUp' ? rows[0] : rows[rows.length - 1]), true);
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

  // ================================================================ keyboard

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
        firstItem && this.isExpanded(id) ? store.addChild(id, store.indexOf(firstItem), after) : store.addSiblingAfter(id, after);
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

  // ================================================================ pasting

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
