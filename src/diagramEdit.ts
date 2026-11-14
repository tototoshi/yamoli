/*
 * Editing the outline from the diagram (DiagramView): a box's shape and
 * colour, arrows drawn and removed, and boxes moved into frames or lined up
 * in another place. Each is written to the rows and fields the diagram is
 * drawn from (diagram.ts), so the outline stays the one source.
 */
import type { Diagram, DiagramEdge, Layout, Shape } from './diagram';
import { addRef, refIds, removeRef } from './links';
import type { OutlineStore } from './model';

/** Make id a box of a shape (`box` takes the field away) or a frame. */
export function setShape(store: OutlineStore, id: string, shape: Shape | 'frame') {
  const f = store.field(id, 'shape');
  if (shape === 'box') {
    if (f) store.remove(f.id);
  } else store.setField(id, 'shape', shape);
}

/** Give id a colour, or none. */
export function setColor(store: OutlineStore, id: string, color: string | null) {
  const f = store.field(id, 'color');
  if (color) store.setField(id, 'color', color);
  else if (f) store.remove(f.id);
}

/** An arrow from one row to another: a link in the `to` field of the first, unless one is already there. */
export function connect(store: OutlineStore, from: string, to: string) {
  const f = store.field(from, 'to');
  if (f && store.fieldTexts(f.id).some((text) => refIds(text).includes(to))) return;
  addRef(store, from, 'to', to);
}

/** Take out the links an arrow is drawn from. */
export function disconnect(store: OutlineStore, edge: DiagramEdge) {
  for (const { field, ref } of edge.links) removeRef(store, field, ref);
}

type Pt = readonly [number, number];

/** The drawn rows holding id (frames, or rows in a mind map), nearest first. */
function holders(d: Diagram, id: string): string[] {
  const parent = new Map<string, string>();
  for (const n of d.nodes.values()) for (const c of n.children) parent.set(c, n.id);
  const out: string[] = [];
  for (let p = parent.get(id); p; p = parent.get(p)) out.push(p);
  return out;
}

/** The smallest box under a point (ok says which may count), or null. */
export function boxAt(L: Layout, [x, y]: Pt, ok: (id: string) => boolean = () => true): string | null {
  let best: string | null = null;
  let area = Infinity;
  for (const [id, b] of L.boxes) {
    if (!ok(id) || x < b.x || x > b.x + b.w || y < b.y || y > b.y + b.h || b.w * b.h >= area) continue;
    best = id;
    area = b.w * b.h;
  }
  return best;
}

/** Whether an arrow may join two boxes: not a box and a frame around it. */
export const canConnect = (d: Diagram, from: string, to: string) =>
  from !== to && !holders(d, from).includes(to) && !holders(d, to).includes(from);

export interface Drop {
  /** The row it goes under: a frame (a row of a mind map), or the zoomed item. */
  parent: string;
  /** The row it goes before, or null for after the last. */
  before: string | null;
}

/**
 * Where a box dragged to a point would go: into the frame (in a mind map, the
 * row) under the point, else the zoomed item (rootId), before the box it is
 * dropped on or where it falls in the frame's row, column or grid. Null when
 * it stays: dropped back on itself, on nothing in the frame it is in (laid
 * out along arrows, where the order hardly shows), or in a mind map's empty space.
 */
export function dropAt(d: Diagram, L: Layout, rootId: string, id: string, [x, y]: Pt): Drop | null {
  if (boxAt(L, [x, y], (n) => n === id)) return null;
  const inside = (n: string) => n === id || holders(d, n).includes(id);
  const holder = boxAt(L, [x, y], (n) => !inside(n) && (d.kind === 'tree' || d.nodes.get(n)!.isFrame));
  if (!holder && d.kind === 'tree') return null;
  const kids = (holder ? d.nodes.get(holder)!.children : d.top).filter((c) => c !== id);
  const arrange = holder ? d.nodes.get(holder)!.arrange : d.arrange;
  const box = (c: string) => L.boxes.get(c)!;
  const cx = (c: string) => box(c).x + box(c).w / 2;
  const cy = (c: string) => box(c).y + box(c).h / 2;
  // The first box the point comes before, along the way the boxes are lined up.
  const across = arrange?.kind === 'row' || (!arrange && d.kind === 'tree' && d.direction === 'TB');
  const down = arrange?.kind === 'column' || (!arrange && d.kind === 'tree' && d.direction === 'LR');
  let before: string | undefined;
  if (across) before = kids.find((c) => x < cx(c));
  else if (down) before = kids.find((c) => y < cy(c));
  else if (arrange?.kind === 'grid') before = kids.find((c) => y < box(c).y || (y <= box(c).y + box(c).h && x < cx(c)));
  // Laid out along the arrows: dropped on a box, before it; elsewhere, at the end of another frame.
  else {
    before = kids.find((c) => boxAt(L, [x, y], (n) => n === c) === c);
    if (!before && (holder ?? null) === (holders(d, id)[0] ?? null)) return null;
  }
  return { parent: holder ?? rootId, before: before ?? null };
}

/** Move id as a drop says; false when it would stay where it is. */
export const moveBox = (store: OutlineStore, id: string, drop: Drop) => store.moveTo(id, drop.parent, drop.before);
