/*
 * Moving rows in the Document view: a row is dragged by the grip shown beside
 * the line under the pointer, with the rows under it. Where it goes is decided
 * by the line under the pointer, as in the outline:
 *   upper half                        -> before that row
 *   lower half, rows shown under it   -> first of the rows under it
 *   lower half                        -> after that row; the pointer left of its text
 *                                        climbs out of last-row positions
 * Moving the pointer only updates an indicator; the outline changes on drop.
 */
import type { Controller } from './controller';
import { lineAt } from './doc';
import type { OutlineStore } from './model';

/** A row's line in the document: its text's top, bottom and left (page coordinates). */
export interface Line {
  id: string;
  top: number;
  bottom: number;
  left: number;
}

export interface DocDrop {
  parentId: string;
  beforeId: string | null;
  /** Where to draw the indicator. */
  left: number;
  top: number;
}

/** How far left of a row's text the pointer goes to climb out of it. */
const CLIMB = 12;
const START_DISTANCE = 5;
const SCROLL_EDGE = 60;

/** The rows' lines drawn in main, top to bottom (the one being typed in too; an embedded drawing's own left out). */
export function docLines(main: Element): (Line & { el: HTMLElement })[] {
  return [...main.querySelectorAll<HTMLElement>('.text-view[data-id], textarea[data-fk^="text:"]')]
    .filter((v) => !v.closest('.doc-embed'))
    .map((el) => {
      const rs = [...el.getClientRects()];
      const box = el.getBoundingClientRect();
      const id = el.dataset.id ?? el.dataset.fk!.slice('text:'.length);
      return { id, el, top: rs[0]?.top ?? box.top, bottom: rs.at(-1)?.bottom ?? box.bottom, left: rs[0]?.left ?? box.left };
    });
}

/** Where row src, dragged to x, y over lines, would go; null where it can't (on itself or the rows under it). */
export function docDrop(store: OutlineStore, zoomId: string, lines: Line[], src: string, x: number, y: number): DocDrop | null {
  const hit = lineAt(lines, x, y);
  if (!hit) return null;
  const i = lines.findIndex((l) => l.id === hit.id);
  const line = lines[i];
  if (line.id === src || store.isAncestor(src, line.id)) return null;
  if (y < (line.top + line.bottom) / 2) return { parentId: store.parentOf(line.id)!, beforeId: line.id, left: line.left, top: line.top };
  const next = lines[i + 1];
  if (next && store.isAncestor(line.id, next.id)) {
    return { parentId: line.id, beforeId: store.items(line.id)[0] ?? null, left: next.left, top: line.bottom };
  }
  // After it, or after a row it is the last row under, the pointer left of that one's text.
  const leftOf = (id: string) => lines.find((l) => l.id === id)?.left;
  let target = line.id;
  for (;;) {
    const p = store.parentOf(target)!;
    if (p === zoomId || store.items(p).at(-1) !== target || leftOf(p) === undefined || x >= leftOf(target)! - CLIMB) break;
    target = p;
  }
  const parentId = store.parentOf(target)!;
  const sibs = store.node(parentId).children;
  return { parentId, beforeId: sibs[sibs.indexOf(target) + 1] ?? null, left: leftOf(target)!, top: line.bottom };
}

/** Where the grip goes beside a line: left of its bullet, number or quotation bar, by its first line's middle. */
export function gripAt(line: Line & { el: HTMLElement }): { x: number; y: number } {
  const li = line.el.closest('li');
  const quote = line.el.closest('.doc-quote');
  const edge = li ? li.getBoundingClientRect().left - 22 : quote ? quote.getBoundingClientRect().left : line.left;
  const first = line.el.getClientRects()[0] ?? line.el.getBoundingClientRect();
  return { x: edge - 24, y: first.top + first.height / 2 };
}

/** Drag row id by its grip, from a press on it, over the document in main. */
export function startDocDrag(e: PointerEvent, id: string, ctl: Controller, main: Element) {
  if (e.button !== 0) return;
  e.preventDefault(); // not a text selection
  const startX = e.clientX;
  const startY = e.clientY;
  let active = false;
  let drop: DocDrop | null = null;
  const source = docLines(main).find((l) => l.id === id)?.el;
  const box = source?.closest('li, .doc-line') as HTMLElement | null;
  const indicator = document.createElement('div');
  indicator.className = 'drop-indicator';

  const move = (ev: PointerEvent) => {
    if (!active) {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < START_DISTANCE) return;
      active = true;
      box?.classList.add('drag-source');
      document.body.classList.add('dragging');
      document.body.append(indicator);
    }
    if (ev.clientY < SCROLL_EDGE) window.scrollBy(0, -12);
    else if (ev.clientY > window.innerHeight - SCROLL_EDGE) window.scrollBy(0, 12);
    drop = docDrop(ctl.store, ctl.zoomId, docLines(main), id, ev.clientX, ev.clientY);
    indicator.hidden = !drop;
    if (drop) {
      const right = main.getBoundingClientRect().right;
      indicator.style.left = drop.left + 'px';
      indicator.style.top = drop.top - 1 + 'px';
      indicator.style.width = Math.max(right - drop.left, 40) + 'px';
    }
  };
  const finish = (commit: boolean) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    window.removeEventListener('keydown', onKey, true);
    if (!active) return;
    box?.classList.remove('drag-source');
    document.body.classList.remove('dragging');
    indicator.remove();
    if (commit && drop) ctl.moveNodes([id], drop.parentId, drop.beforeId);
  };
  const onUp = () => finish(true);
  const onCancel = () => finish(false);
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key !== 'Escape') return;
    ev.preventDefault();
    ev.stopPropagation();
    finish(false);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
  window.addEventListener('keydown', onKey, true);
}
