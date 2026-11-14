/*
 * Editing the outline from the diagram (DiagramView): a box's shape and
 * colour, arrows drawn and removed, and boxes moved into frames or lined up
 * in another place. Each is written to the rows and fields the diagram is
 * drawn from (diagram.ts), so the outline stays the one source.
 */
import { CONTAINER, DESC_KEYS, LINE_KEYS, type Diagram, type DiagramEdge, type Layout, type Shape } from './diagram';
import { DEP_KEY, wouldCycle } from './deps';
import { addPart, addRef, refIds, removeRef } from './links';
import type { OutlineStore } from './model';

/**
 * In a mind map, the row an arrow key leads to from id: back to the row it
 * grows from, out to its first row, or to the row before or after it. Null
 * when there is none.
 */
export function neighbour(d: Diagram, id: string, key: string): string | null {
  const parent = new Map<string, string>();
  for (const n of d.nodes.values()) for (const c of n.children) parent.set(c, n.id);
  const [back, out, prev, next] =
    d.direction === 'TB' ? ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'] : ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
  const p = parent.get(id);
  const kids = p ? d.nodes.get(p)!.children : [];
  const i = kids.indexOf(id);
  if (key === back) return p ?? null;
  if (key === out) return d.nodes.get(id)?.children[0] ?? null;
  if (key === prev) return kids[i - 1] ?? null;
  if (key === next) return kids[i + 1] ?? null;
  return null;
}

/** Make id a box of a shape (`box` takes the field away), a frame or a container. */
export function setShape(store: OutlineStore, id: string, shape: Shape | 'frame' | typeof CONTAINER) {
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

/** The field a box's description is read from (`note`, `description`, …), if it has one. */
const descField = (store: OutlineStore, id: string) =>
  store
    .node(id)
    .children.map((c) => store.node(c))
    .find((f) => f.key && DESC_KEYS.has(f.key.trim().toLowerCase()));

/** A box's description as text to edit: a block's text, or a field's lines. */
export function descOf(store: OutlineStore, id: string): string {
  const f = descField(store, id);
  if (!f) return '';
  return f.format !== null
    ? f.text
    : store
        .fieldTexts(f.id)
        .filter((x) => x.trim())
        .join('\n');
}

/**
 * Write a box's description into the field it is read from, else a new
 * `note`: one line as its value, more as a text block. Empty takes it away.
 */
export function setDesc(store: OutlineStore, id: string, text: string) {
  const value = text.trim();
  const f = descField(store, id);
  if (!value) {
    if (f) store.remove(f.id);
    return;
  }
  const lines = value.includes('\n');
  if (!f) {
    if (lines) store.addBlock(id, 'note', 'text', value);
    else store.addField(id, 'note', value);
    return;
  }
  for (const c of [...f.children]) store.remove(c);
  store.setText(f.id, value);
  if (lines && f.format === null) store.setFormat(f.id, 'text');
}

/** An arrow from one row to another: a link in the `to` field of the first, unless one is already there. */
export function connect(store: OutlineStore, from: string, to: string) {
  const f = store.field(from, 'to');
  if (f && store.fieldTexts(f.id).some((text) => refIds(text).includes(to))) return;
  addRef(store, from, 'to', to);
}

const LINK_RE = /\[\[[^\]]*\]\]/g;

/** The parts of a field (its text and its list's rows split at commas) holding a link to ref, with where they are. */
function* linkParts(store: OutlineStore, field: string, ref: string) {
  for (const n of [field, ...store.node(field).children]) {
    const parts = store.node(n).text.split(',');
    for (let i = 0; i < parts.length; i++) if (refIds(parts[i]).includes(ref)) yield { n, parts, i };
  }
}

/** An arrow's label as written: the words beside its link (with none, a field's own name shows instead). */
export function labelOf(store: OutlineStore, edge: DiagramEdge): string {
  for (const { field, ref } of edge.links) {
    if (!store.get(field)) continue;
    for (const { parts, i } of linkParts(store, field, ref)) return parts[i].replace(LINK_RE, '').trim();
  }
  return '';
}

/**
 * Write an arrow's label: the words beside each of its links. A comma, which
 * would split the field, becomes 、. A dependency has no label to write.
 */
export function setLabel(store: OutlineStore, edge: DiagramEdge, text: string): boolean {
  const words = text
    .replace(/\s*,\s*/g, '、')
    .replace(/\s+/g, ' ')
    .trim();
  let changed = false;
  for (const { field, ref } of edge.links) {
    if (!store.get(field) || store.node(field).key?.trim().toLowerCase() === DEP_KEY) continue;
    for (const { n, parts, i } of [...linkParts(store, field, ref)]) {
      const lead = parts[i].match(/^\s*/)![0];
      parts[i] = lead + parts[i].match(LINK_RE)!.join(' ') + (words ? ' ' + words : '');
      const next = parts.join(',');
      if (next === store.node(n).text) continue;
      store.setText(n, next);
      changed = true;
    }
  }
  return changed;
}

/** Take out the links an arrow is drawn from. */
export function disconnect(store: OutlineStore, edge: DiagramEdge) {
  for (const { field, ref } of edge.links) removeRef(store, field, ref);
}

/**
 * Move one end of an arrow to another box. Where that end is the row the link
 * is written on, the link (with any words beside it) moves to the same field
 * of the new box; where it is the row linked to, the link points to the new
 * box instead. False when nothing changes, or a dependency would go round.
 */
export function reconnect(store: OutlineStore, d: Diagram, edge: DiagramEdge, end: 'from' | 'to', target: string): boolean {
  if (edge[end] === target) return false;
  const drawnAs = (row: string) => {
    for (let n: string | undefined = row; n; n = store.parentOf(n)) if (d.nodes.has(n)) return n;
    return null;
  };
  const moves = edge.links
    .filter(({ field }) => store.get(field))
    .map(({ field, ref }) => {
      const owner = store.owner(field);
      const key = store.node(field).key!;
      return { field, ref, key, onOwner: drawnAs(owner) === edge[end], owner };
    });
  for (const m of moves) {
    if (m.key !== DEP_KEY) continue;
    const [id, dep] = m.onOwner ? [target, m.ref] : [m.owner, target];
    if (id === dep || wouldCycle(store, id, dep)) return false;
  }
  // A link already there isn't written twice: the old one just goes.
  const links = (field: string | undefined, to: string) => !!field && store.fieldTexts(field).some((text) => refIds(text).includes(to));
  for (const { field, ref, key, onOwner } of moves) {
    if (onOwner) {
      const parts = removeRef(store, field, ref);
      if (!links(store.field(target, key)?.id, ref)) parts.forEach((part) => addPart(store, target, key, part));
    } else if (links(field, target)) removeRef(store, field, ref);
    else
      for (const n of [field, ...store.node(field).children])
        store.setText(n, store.node(n).text.replaceAll(`[[${ref}]]`, `[[${target}]]`));
  }
  return moves.length > 0;
}

/** The kinds of line an arrow can be: the built-in field names, then those the zoomed item's `lines` sets. */
export function lineKinds(store: OutlineStore, rootId: string): string[] {
  const set = (store.field(rootId, 'lines')?.children ?? []).map((c) => store.node(c).key?.trim().toLowerCase());
  return [...new Set([...Object.keys(LINE_KEYS), ...set.filter((k): k is string => !!k)])];
}

/** The field name an arrow is written in (its kind), from its first link. */
export const lineKindOf = (store: OutlineStore, edge: DiagramEdge) =>
  edge.links.map(({ field }) => store.get(field)?.key?.trim().toLowerCase()).find(Boolean);

/**
 * Make an arrow another kind of line: its links (with any words beside them)
 * move to the field of that name on the same row. Dependencies stay.
 */
export function setLineKind(store: OutlineStore, edge: DiagramEdge, key: string): boolean {
  let changed = false;
  for (const { field, ref } of edge.links) {
    const f = store.get(field);
    const now = f?.key?.trim().toLowerCase();
    if (!f || now === key || now === DEP_KEY) continue;
    const owner = store.owner(field);
    const parts = removeRef(store, field, ref);
    const there = store.field(owner, key);
    if (!there || !store.fieldTexts(there.id).some((text) => refIds(text).includes(ref)))
      parts.forEach((part) => addPart(store, owner, key, part));
    changed = true;
  }
  return changed;
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
  /** Dropped on a plain box, which becomes a container to hold it. */
  nest?: boolean;
}

/** How far into a box a drop counts as into it rather than beside it, from each side. */
const EDGE = 0.25;

/**
 * Where a box dragged to a point would go: into the middle of a plain box,
 * inside it (it becomes a container); into the frame (in a mind map, the
 * row) under the point, else the zoomed item (rootId), before the box it is
 * dropped on the edge of or where it falls in the frame's row, column or grid.
 * Null when it stays: dropped back on itself, on nothing in the frame it is
 * in (laid out along arrows, where the order hardly shows), or in a mind map's empty space.
 */
export function dropAt(d: Diagram, L: Layout, rootId: string, id: string, [x, y]: Pt): Drop | null {
  if (boxAt(L, [x, y], (n) => n === id)) return null;
  const inside = (n: string) => n === id || holders(d, n).includes(id);
  if (d.kind === 'flow') {
    const into = boxAt(L, [x, y], (n) => {
      const node = d.nodes.get(n)!;
      if (inside(n) || node.isFrame || node.shape !== 'box') return false;
      const b = L.boxes.get(n)!;
      return Math.abs(x - b.x - b.w / 2) < b.w * (0.5 - EDGE) && Math.abs(y - b.y - b.h / 2) < b.h * (0.5 - EDGE);
    });
    if (into) return { parent: into, before: null, nest: true };
  }
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

/** Move id as a drop says; false when it would stay where it is. A container left empty is a box again. */
export function moveBox(store: OutlineStore, id: string, drop: Drop): boolean {
  const from = store.parentOf(id);
  if (!store.moveTo(id, drop.parent, drop.before)) return false;
  if (drop.nest) store.setField(drop.parent, 'shape', CONTAINER);
  if (from && store.fieldValue(from, 'shape')?.trim().toLowerCase() === CONTAINER && !store.items(from).length)
    setShape(store, from, 'box');
  return true;
}
