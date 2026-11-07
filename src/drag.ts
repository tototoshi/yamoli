/*
 * Drag a row by its bullet to move it (with its subtree).
 *
 * Drop position is decided by the row under the pointer:
 *   upper half                          -> before that row
 *   lower half, children shown / x → →  -> first child of that row
 *   lower half                          -> after that row; moving x left of the
 *                                          bullet climbs out of last-child positions
 * Moving the pointer only updates an indicator element; the store changes on drop.
 */
import type { Controller } from './controller';

const INDENT = 28; // px per outline level (matches the CSS)
const START_DISTANCE = 5;
const SCROLL_EDGE = 60;

interface Drop {
  parentId: string;
  beforeId: string | null;
  left: number;
  top: number;
}

const rowOf = (li: Element) => li.querySelector<HTMLElement>(':scope > .row')!;
const bulletOf = (li: Element) => rowOf(li).querySelector('.bullet')!.getBoundingClientRect();
const liFor = (id: string) => document.querySelector<HTMLElement>(`li.node[data-id="${CSS.escape(id)}"]`);

/**
 * The deepest row whose box spans y. Only y matters, so the pointer can move
 * left of a nested row (to climb out) without leaving it.
 */
function rowAtY(y: number): HTMLElement | null {
  let found: HTMLElement | null = null;
  for (const li of document.querySelectorAll<HTMLElement>('.outline li.node')) {
    const r = li.getBoundingClientRect();
    if (y >= r.top && y < r.bottom) found = li; // document order: later = deeper
  }
  return found;
}

function computeDrop(ctl: Controller, source: HTMLElement, x: number, y: number): Drop | null {
  const li = rowAtY(y);
  if (!li || source.contains(li)) return null;
  const { store, zoomId } = ctl;
  const id = li.dataset.id!;
  const rowRect = rowOf(li).getBoundingClientRect();
  const bullet = bulletOf(li);

  if (y < rowRect.top + rowRect.height / 2) {
    return { parentId: store.parentOf(id)!, beforeId: id, left: bullet.left, top: rowRect.top };
  }

  const kidsShown = !!li.querySelector(':scope > ul.children');
  if (kidsShown || x > bullet.left + INDENT * 1.5) {
    return {
      parentId: id,
      beforeId: store.node(id).children[0] ?? null,
      left: bullet.left + INDENT,
      top: rowRect.bottom,
    };
  }

  // After this row, or after an ancestor when dragging left from a last child.
  let target = id;
  for (let levels = Math.floor((bullet.left - x) / INDENT); levels > 0; levels--) {
    const p = store.parentOf(target)!;
    const sibs = store.node(p).children;
    if (p === zoomId || sibs[sibs.length - 1] !== target) break;
    target = p;
  }
  const targetLi = liFor(target) ?? li;
  const parentId = store.parentOf(target)!;
  const sibs = store.node(parentId).children;
  return {
    parentId,
    beforeId: sibs[sibs.indexOf(target) + 1] ?? null,
    left: bulletOf(targetLi).left,
    top: targetLi.getBoundingClientRect().bottom,
  };
}

/** Swallow the click that follows a drag so the bullet doesn't zoom in. */
function suppressNextClick() {
  const stop = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
  };
  window.addEventListener('click', stop, { capture: true, once: true });
  setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 0);
}

export function startBulletDrag(e: PointerEvent, id: string, ctl: Controller) {
  if (e.button !== 0) return;
  const source = (e.currentTarget as Element).closest<HTMLElement>('li.node');
  if (!source) return;
  const startX = e.clientX;
  const startY = e.clientY;
  let active = false;
  let drop: Drop | null = null;
  const indicator = document.createElement('div');
  indicator.className = 'drop-indicator';

  const move = (ev: PointerEvent) => {
    if (!active) {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < START_DISTANCE) return;
      active = true;
      source.classList.add('drag-source');
      document.body.classList.add('dragging');
      document.body.append(indicator);
    }
    if (ev.clientY < SCROLL_EDGE) window.scrollBy(0, -12);
    else if (ev.clientY > window.innerHeight - SCROLL_EDGE) window.scrollBy(0, 12);

    drop = computeDrop(ctl, source, ev.clientX, ev.clientY);
    indicator.hidden = !drop;
    if (drop) {
      const right = document.querySelector('.outline')!.getBoundingClientRect().right;
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
    suppressNextClick();
    source.classList.remove('drag-source');
    document.body.classList.remove('dragging');
    indicator.remove();
    if (commit && drop) ctl.moveNode(id, drop.parentId, drop.beforeId);
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
