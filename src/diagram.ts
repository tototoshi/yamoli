/*
 * The zoomed item drawn as a diagram, from the outline as it is:
 *
 *   rows                 boxes, listing the rows under them (`• …`)
 *   shape: frame         a frame around the rows under it, drawn as boxes;
 *                        `frame solid` / `frame none` for its border
 *   [[links]] in fields  arrows, labelled with the words after the link
 *                        (`to: [[API]] gRPC`); `after` arrows run from the
 *                        dependency to the item waiting for it
 *   shape                box / actor / db / queue / external
 *   color                red, orange, yellow, green, blue, purple, gray (or #hex)
 *   icon                 server, database, cloud … (icons.ts) or an emoji
 *   note / description   wrapped text under the name, in a box or a frame
 *                        (also a `note` block); long text makes the box wider
 *   other fields         small `key: value` lines inside the box
 *
 * A line's look comes from the name of the field it is written in: `async`
 * is dashed, `both` has arrows at both ends, `link` none, anything else (`to`)
 * a plain arrow. `lines` on the zoomed item sets more, as fields under it:
 * `calls: dotted red`, `sync: both` (words: solid / dashed / dotted, arrow /
 * both / none, a colour).
 *
 * On the zoomed item: `direction: LR | TB`, and `diagram: flow | tree`. A
 * flow (the default when there are arrows or frames) puts each box after the ones its
 * arrows come from, frames laid out inside out; an arrow to or from a row
 * listed in a box is the box's. A tree (the default without arrows or
 * frames) draws the item and all its rows as a mind map.
 *
 * In a flow, `layout` on a frame (or the zoomed item) lines up the boxes in it
 * in outline order instead of along their arrows: `row` (横) across, `column`
 * (縦) down, `grid` (格子) in rows of a few, `grid 3` of three.
 */
import { DEP_KEY, dependencies } from './deps';
import { iconOf } from './icons';
import { nodeLabel, refIds, withLabels } from './links';
import type { OutlineStore } from './model';
import { VIEWS_KEY } from './views';

export type Shape = 'box' | 'actor' | 'db' | 'queue' | 'external';
const SHAPES: Shape[] = ['box', 'actor', 'db', 'queue', 'external'];
export type Direction = 'LR' | 'TB';

/** Fields that shape the drawing rather than being shown in the box. */
const DRAWING_KEYS = new Set([
  'shape',
  'color',
  'icon',
  'direction',
  'diagram',
  'lines',
  'layout',
  'embed',
  'completed',
  DEP_KEY,
  VIEWS_KEY,
]);

/** How the boxes in a frame are lined up: in a row, a column, or a grid of `columns` across (0: as square as it gets). */
export type Arrange = { kind: 'row' } | { kind: 'column' } | { kind: 'grid'; columns: number };

/** A `layout` value: `row` / `横`, `column` / `縦`, `grid` / `格子` with a number of columns or not; else undefined. */
export function arrangeOf(value: string | undefined): Arrange | undefined {
  const [word = '', n] = (value ?? '').trim().toLowerCase().split(/\s+/);
  if (word === 'row' || word === '横') return { kind: 'row' };
  if (word === 'column' || word === '縦') return { kind: 'column' };
  if (word === 'grid' || word === '格子') return { kind: 'grid', columns: Math.max(0, Math.floor(Number(n) || 0)) };
  return undefined;
}

/** A frame's border: `box` is a container, drawn like a box with boxes inside (`shape: container`). */
export type FrameStyle = 'dashed' | 'solid' | 'none' | 'box';
const FRAME_STYLES: FrameStyle[] = ['dashed', 'solid', 'none'];
/** The `shape` of a box with boxes inside. */
export const CONTAINER = 'container';

export interface LineStyle {
  dash: 'solid' | 'dashed' | 'dotted';
  ends: 'arrow' | 'both' | 'none';
  color?: string;
}

/** Field names with a look of their own, and no label of their name. */
export const LINE_KEYS: Record<string, string> = { to: '', async: 'dashed', both: 'both', link: 'none' };

/** A line's look from words like `dotted both red`, on top of base. */
export function lineStyle(words: string, base: LineStyle = { dash: 'solid', ends: 'arrow' }): LineStyle {
  const out = { ...base };
  for (const w of words
    .toLowerCase()
    .split(/[\s,]+/)
    .filter(Boolean)) {
    if (w === 'solid' || w === 'dashed' || w === 'dotted') out.dash = w;
    else if (w === 'arrow' || w === 'both' || w === 'none') out.ends = w;
    else if (colorValue(w)) out.color = colorValue(w);
  }
  return out;
}

export interface DiagramNode {
  id: string;
  label: string;
  shape: Shape;
  /** Marked `shape: frame`: drawn around the rows under it. */
  isFrame: boolean;
  /** How the frame's border is drawn. */
  frame: FrameStyle;
  color?: string;
  /** The `icon` value; icons.ts tells what it draws. */
  icon?: string;
  /** Text about it (`note`, `description`), on one line; wrapped when drawn. */
  desc?: string;
  /** `key: value` lines shown under the label. */
  props: string[];
  /** Rows drawn inside this one (a frame), in outline order. */
  children: string[];
  /** How the rows inside a frame are lined up, when `layout` says. */
  arrange?: Arrange;
  done: boolean;
}

export interface DiagramEdge {
  from: string;
  to: string;
  label: string;
  style: LineStyle;
  /** Where the arrow is written: the links (to ref) in these fields, which removing it takes out. */
  links: { field: string; ref: string }[];
}

export interface Diagram {
  nodes: Map<string, DiagramNode>;
  /** Top-level boxes, in outline order. */
  top: string[];
  edges: DiagramEdge[];
  direction: Direction;
  kind: 'flow' | 'tree';
  /** How the top-level boxes are lined up (the zoomed item's `layout`). */
  arrange?: Arrange;
}

const COLORS: Record<string, string> = {
  red: '#d9534f',
  orange: '#e8892c',
  yellow: '#c9a227',
  green: '#3a9a5b',
  blue: '#3b6fd8',
  purple: '#8a4fc8',
  gray: '#7d848e',
  grey: '#7d848e',
};

/** A colour word (`blue`) or `#hex` as the colour drawn; undefined for anything else. */
export const colorValue = (v: string | undefined) =>
  v ? (COLORS[v.toLowerCase()] ?? (/^#[0-9a-f]{3,8}$/i.test(v) ? v : undefined)) : undefined;

/** Fields whose text describes the row, shown as text rather than `key: value`. */
export const DESC_KEYS = new Set(['note', 'notes', 'description', 'desc', '説明', 'メモ']);

/** A field's text as one plain line: Markdown marks and line breaks dropped. */
const plain = (texts: string[]) =>
  texts
    .join('\n')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*(?:#+|[-*+]|\d+[.)])\s+/gm, '')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const PROP_MAX = 32;
const clip = (s: string) => (s.length > PROP_MAX ? s.slice(0, PROP_MAX - 1) + '…' : s);

export function buildDiagram(store: OutlineStore, rootId: string, { showCompleted = true } = {}): Diagram {
  const nodes = new Map<string, DiagramNode>();
  const rows = (id: string) => store.items(id).filter((c) => showCompleted || !store.node(c).completed);
  const add = (id: string, children = rows(id)) => {
    const props: string[] = [];
    let desc: string | undefined;
    for (const c of store.node(id).children) {
      const f = store.node(c);
      const key = f.key?.trim();
      if (key && DESC_KEYS.has(key.toLowerCase())) {
        desc ??= withLabels(store, plain(store.fieldTexts(c).filter((x) => x.trim()))) || undefined;
        continue;
      }
      if (!key || f.format !== null || DRAWING_KEYS.has(key.toLowerCase())) continue;
      if (store.fieldTexts(c).some((t) => refIds(t).length)) continue; // drawn as arrows
      props.push(clip(f.children.length ? `${key}: …` : `${key}: ${f.text.trim()}`));
    }
    // `frame`, `frame solid`; a border style alone (`solid`) also means a frame, and `container` a box holding boxes.
    const shape = (store.fieldValue(id, 'shape') ?? '').toLowerCase().split(/\s+/);
    const border = shape.includes(CONTAINER)
      ? 'box'
      : (shape.find((w) => FRAME_STYLES.includes(w as FrameStyle)) as FrameStyle | undefined);
    nodes.set(id, {
      id,
      label: nodeLabel(store, id),
      shape: SHAPES.includes(shape[0] as Shape) ? (shape[0] as Shape) : 'box',
      isFrame: shape.includes('frame') || !!border,
      frame: border ?? 'dashed',
      color: colorValue(store.fieldValue(id, 'color')),
      icon: iconOf(store.fieldValue(id, 'icon')) ? store.fieldValue(id, 'icon') : undefined,
      desc,
      props,
      children,
      arrange: arrangeOf(store.fieldValue(id, 'layout')),
      done: store.node(id).completed,
    });
    children.forEach((c) => add(c));
  };
  let top = rows(rootId);
  top.forEach((c) => add(c));

  // A link to a row not drawn (elsewhere, or a field) points at the drawn row holding it, if any.
  const drawn = (id: string): string | null => {
    for (let n: string | undefined = store.owner(id); n; n = store.parentOf(n)) if (nodes.has(n)) return n;
    return null;
  };
  // Looks of lines by field name: the built-in ones, then those set under `lines`.
  const looks = new Map(Object.entries(LINE_KEYS).map(([k, w]) => [k, lineStyle(w)]));
  const lines = store.field(rootId, 'lines');
  for (const c of lines?.children ?? []) {
    const k = store.node(c).key?.trim().toLowerCase();
    if (k) looks.set(k, lineStyle(store.node(c).text, looks.get(k)));
  }
  const look = (key: string) => looks.get(key) ?? lineStyle('');

  const edges: DiagramEdge[] = [];
  const seen = new Map<string, DiagramEdge>();
  const push = (from: string | null, to: string | null, label: string, style: LineStyle, link: { field: string; ref: string }) => {
    if (!from || !to || from === to) return;
    const k = `${from}>${to}>${label}`;
    const e = seen.get(k);
    if (e) return void e.links.push(link);
    seen.set(k, { from, to, label, style, links: [link] });
    edges.push(seen.get(k)!);
  };
  for (const id of nodes.keys()) {
    const after = store.field(id, DEP_KEY)?.id;
    for (const dep of dependencies(store, id)) push(drawn(dep), id, '', look(DEP_KEY), { field: after!, ref: dep });
    for (const c of store.node(id).children) {
      const key = store.node(c).key?.trim().toLowerCase();
      if (!key || key === DEP_KEY) continue;
      for (const text of store.fieldTexts(c)) {
        for (const part of text.split(',')) {
          const ref = refIds(part)[0];
          if (!ref || !store.get(ref)) continue;
          const words = part.replace(/\[\[[^\]]*\]\]/g, '').trim();
          push(id, drawn(ref), words || (key in LINE_KEYS ? '' : store.node(c).key!.trim()), look(key), { field: c, ref });
        }
      }
    }
  }

  const dir = store.fieldValue(rootId, 'direction')?.toUpperCase();
  const asked = store.fieldValue(rootId, 'diagram')?.toLowerCase();
  const arrange = arrangeOf(store.fieldValue(rootId, 'layout'));
  // Arrows, frames or a layout ask for a flow; without any, it is a mind map.
  const framed = [...nodes.values()].some((n) => n.isFrame);
  const kind = asked === 'tree' || asked === 'flow' ? asked : edges.length || framed || arrange ? 'flow' : 'tree';
  // A mind map grows from the zoomed item itself.
  if (kind === 'tree' && rootId !== store.rootId) {
    add(rootId, top);
    top = [rootId];
  }
  if (kind === 'flow') return { nodes, top, edges: listInBoxes(nodes, top, edges), direction: dir === 'TB' ? 'TB' : 'LR', kind, arrange };
  return { nodes, top, edges, direction: dir === 'TB' ? 'TB' : 'LR', kind };
}

const LISTED_MAX = 6;

/**
 * For a flow: only frames hold boxes. Under any other row, the rows are
 * listed in its box instead (and taken out of the drawing), and their arrows
 * become the box's. Returns the arrows that are left.
 */
function listInBoxes(nodes: Map<string, DiagramNode>, top: string[], edges: DiagramEdge[]): DiagramEdge[] {
  const parent = new Map<string, string>();
  for (const n of nodes.values()) for (const c of n.children) parent.set(c, n.id);
  const drop = (id: string) => {
    nodes.get(id)!.children.forEach(drop);
    nodes.delete(id);
  };
  const fold = (id: string) => {
    const n = nodes.get(id)!;
    if (n.isFrame) return n.children.forEach(fold);
    if (!n.children.length) return;
    const listed = n.children.map((c) => clip('• ' + nodes.get(c)!.label));
    n.props.push(...(listed.length > LISTED_MAX ? [...listed.slice(0, LISTED_MAX - 1), `… +${listed.length - LISTED_MAX + 1}`] : listed));
    n.children.forEach(drop);
    n.children = [];
  };
  top.forEach(fold);

  const box = (id: string) => {
    let n = id;
    while (!nodes.has(n)) n = parent.get(n)!;
    return n;
  };
  // Lines that now join the same boxes and look alike become one, with their labels together.
  const merged = new Map<string, DiagramEdge>();
  for (const e of edges) {
    const [from, to] = [box(e.from), box(e.to)];
    if (from === to) continue;
    const k = `${from}>${to}>${JSON.stringify(e.style)}`;
    const m = merged.get(k);
    if (!m) {
      merged.set(k, { ...e, from, to, links: [...e.links] });
      continue;
    }
    m.links.push(...e.links);
    if (e.label && !m.label.split(', ').includes(e.label)) m.label = m.label ? `${m.label}, ${e.label}` : e.label;
  }
  return [...merged.values()];
}

// ================================================================ layout

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Drawn as a frame around other boxes. */
  frame: boolean;
}

export interface Layout {
  boxes: Map<string, Box>;
  width: number;
  height: number;
  /** Tree only: parent -> child lines. */
  branches: [string, string][];
}

/** Width of text in px at a font size; the view measures, tests estimate. */
export type Measure = (text: string, size: number) => number;

export const estimate: Measure = (text, size) => {
  let w = 0;
  for (const ch of text) w += /[ᄀ-￿]/.test(ch) ? size : size * 0.6;
  return w;
};

export const LABEL_SIZE = 13;
export const PROP_SIZE = 11;
export const PAD = 10;
const LINE = 16;
const PROP_LINE = 14;
const FRAME_HEAD = 24;
const FRAME_PAD = 14;
const RANK_GAP = 56;
const ORDER_GAP = 18;
/** Between boxes lined up by `layout`, with room for arrows between them. */
const ARRANGE_GAP = 40;
const ACTOR = 30;
/** Room inside a frame with nothing in it yet. */
const EMPTY = { rs: 80, os: 24 };

/** Room an icon takes before a label. */
export const ICON_SPACE = 20;

/** Width of a box's label or a frame's title, with its icon. */
export const titleWidth = (n: DiagramNode, measure: Measure) =>
  measure(n.label, LABEL_SIZE) + (n.icon && n.shape !== 'actor' ? ICON_SPACE : 0);

/** How wide a description runs before it wraps: wider steps for longer text, so a box doesn't grow too tall. */
const DESC_WIDTHS = [140, 200, 260];
const DESC_LINES = 4;

const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('ja', { granularity: 'word' }) : undefined;
/** Marks that may not begin a line, and ones that may not end it. */
const NO_START = /^[、。，．,.:;:!?！？）」』】〕・ー…ぁぃぅぇぉっゃゅょァィゥェォッャュョ]/;
const NO_END = /[（「『【〔(]$/;

/**
 * The pieces a line may break between: words, with the particles and
 * punctuation after them (送信や / 集計など、), roughly as Japanese is broken
 * by phrase. Spaces are pieces of their own.
 */
function phrases(text: string): string[] {
  const words = segmenter
    ? [...segmenter.segment(text)].map((s) => s.segment)
    : (text.match(/[\u3000-\u9fff\uff00-\uffef]|[^\s\u3000-\u9fff\uff00-\uffef]+|\s+/g) ?? []);
  const out: string[] = [];
  for (const w of words) {
    const prev = out[out.length - 1];
    const trails = NO_START.test(w) || /^[\u3040-\u309f]+$/.test(w);
    // A particle after a word and a space (REST と) still goes with the word.
    if (trails && prev && /^\s+$/.test(prev) && out.length > 1) out[out.length - 2] += out.pop()! + w;
    else if (prev && !/\s$/.test(prev) && !/^\s/.test(w) && (trails || NO_END.test(prev))) out[out.length - 1] += w;
    else out.push(w);
  }
  return out;
}

/**
 * Text broken into lines no wider than width, between phrases (a phrase
 * wider than a line is broken where it must). Past maxLines (if given) the
 * rest is cut, with an ellipsis.
 */
export function wrap(text: string, width: number, size: number, measure: Measure, maxLines = Infinity): string[] {
  const out: string[] = [];
  let line = '';
  const fits = (t: string) => measure(t.trimEnd(), size) <= width;
  for (const tok of phrases(text)) {
    if (!line.trim() || fits(line + tok)) line += tok;
    else {
      out.push(line.trim());
      line = tok.trimStart();
    }
    // A phrase longer than a whole line goes on a character at a time.
    while (!fits(line) && [...line.trim()].length > 1) {
      const chars = [...line.trim()];
      let n = chars.length - 1;
      while (n > 1 && !fits(chars.slice(0, n).join(''))) n--;
      out.push(chars.slice(0, n).join(''));
      line = chars.slice(n).join('');
    }
  }
  if (line.trim()) out.push(line.trim());
  if (out.length > maxLines) {
    out.length = maxLines;
    out[maxLines - 1] = out[maxLines - 1].slice(0, -1) + '…';
  }
  return out;
}

/**
 * text wrapped within width, then narrowed as far as it goes in as many
 * lines, so they come out about even (no word left alone on the last).
 */
function evenWrap(text: string, width: number, measure: Measure): string[] {
  const lines = wrap(text, width, PROP_SIZE, measure);
  if (lines.length < 2) return lines;
  let lo = width / 2;
  let hi = width;
  while (hi - lo > 2) {
    const mid = (lo + hi) / 2;
    if (wrap(text, mid, PROP_SIZE, measure).length <= lines.length) hi = mid;
    else lo = mid;
  }
  return wrap(text, hi, PROP_SIZE, measure);
}

/** The description's lines as drawn in the box: all of it, at the narrowest width that keeps it to a few lines. */
export function descLines(n: DiagramNode, measure: Measure): string[] {
  if (!n.desc) return [];
  const width = DESC_WIDTHS.find((w) => wrap(n.desc!, w, PROP_SIZE, measure).length <= DESC_LINES) ?? DESC_WIDTHS[DESC_WIDTHS.length - 1];
  return evenWrap(n.desc, width, measure);
}

/** A frame's description, run across the frame (of width w) rather than kept narrow like a box's. */
export const frameDesc = (n: DiagramNode, w: number, measure: Measure) => (n.desc ? evenWrap(n.desc, w - 2 * FRAME_PAD, measure) : []);

/** The height of a frame's head: its title, and its description under it. */
export const frameHead = (n: DiagramNode, w: number, measure: Measure) => FRAME_HEAD + frameDesc(n, w, measure).length * PROP_LINE;

/** Size of a box (not a frame) by its contents. */
export function boxSize(n: DiagramNode, measure: Measure): { w: number; h: number } {
  const desc = descLines(n, measure);
  const text = Math.max(titleWidth(n, measure), ...[...desc, ...n.props].map((p) => measure(p, PROP_SIZE)));
  const lines = LINE + (desc.length + n.props.length) * PROP_LINE;
  if (n.shape === 'actor') return { w: Math.max(text + 8, 44), h: ACTOR + 6 + lines };
  const w = Math.max(Math.ceil(text) + 2 * PAD, 64);
  const h = lines + 2 * PAD + (n.shape === 'db' ? 12 : 0);
  return { w: n.shape === 'queue' ? w + 16 : w, h };
}

/** Coordinates along the arrows (rank) and across them (order), turned into x/y by the direction. */
interface Placed {
  r: number;
  o: number;
  rs: number;
  os: number;
}

export function layout(d: Diagram, measure: Measure = estimate): Layout {
  return d.kind === 'tree' ? treeLayout(d, measure) : flowLayout(d, measure);
}

function toXY(placed: Map<string, Placed>, frames: Set<string>, dir: Direction, branches: [string, string][] = []): Layout {
  const boxes = new Map<string, Box>();
  let width = 0;
  let height = 0;
  for (const [id, p] of placed) {
    const b = dir === 'LR' ? { x: p.r, y: p.o, w: p.rs, h: p.os } : { x: p.o, y: p.r, w: p.os, h: p.rs };
    boxes.set(id, { ...b, frame: frames.has(id) });
    width = Math.max(width, b.x + b.w);
    height = Math.max(height, b.y + b.h);
  }
  return { boxes, width, height, branches };
}

/** Rank and order extents of a box for the direction. */
const extents = (size: { w: number; h: number }, dir: Direction) =>
  dir === 'LR' ? { rs: size.w, os: size.h } : { rs: size.h, os: size.w };

/**
 * Flow: inside each frame (and at the top), boxes go in ranks along the
 * arrows between them: an arrow into a frame counts for the frame. Within a
 * rank, boxes are ordered next to the boxes they connect to.
 */
function flowLayout(d: Diagram, measure: Measure): Layout {
  const { nodes, direction: dir } = d;
  const parent = new Map<string, string>();
  for (const n of nodes.values()) for (const c of n.children) parent.set(c, n.id);
  const frames = new Set([...nodes.values()].filter((n) => n.isFrame).map((n) => n.id));

  // Each unit laid out relative to its frame's corner; sizes come from inside out.
  const local = new Map<string, Placed>();
  const size = new Map<string, { rs: number; os: number }>();

  /** The unit among `units` that is id or holds it. */
  const liftTo = (id: string, units: Set<string>): string | null => {
    for (let n: string | undefined = id; n; n = parent.get(n)) if (units.has(n)) return n;
    return null;
  };

  const place = (units: string[], arrange?: Arrange): { rs: number; os: number } => {
    for (const u of units) {
      const n = nodes.get(u)!;
      if (n.isFrame) size.set(u, framed(n.children.length ? place(n.children, n.arrange) : EMPTY, n));
      else size.set(u, extents(boxSize(n, measure), dir));
    }
    if (arrange) return lineUp(units, arrange);
    const set = new Set(units);
    const succ = new Map(units.map((u) => [u, [] as string[]]));
    const pred = new Map(units.map((u) => [u, [] as string[]]));
    /** Widest label on the arrows leaving each unit, to leave room for it after the unit's rank. */
    const labelAfter = new Map<string, number>();
    for (const e of d.edges) {
      const a = liftTo(e.from, set);
      const b = liftTo(e.to, set);
      if (!a || !b || a === b) continue;
      if (e.label) labelAfter.set(a, Math.max(labelAfter.get(a) ?? 0, measure(e.label, PROP_SIZE)));
      if (!succ.get(a)!.includes(b)) {
        succ.get(a)!.push(b);
        pred.get(b)!.push(a);
      }
    }
    const rank = ranks(units, succ, pred);
    const layers: string[][] = [];
    for (const u of units) (layers[rank.get(u)!] ??= []).push(u);
    const filled = layers.filter(Boolean);
    orderLayers(filled, succ, pred);

    // Ranks one after another; each layer centred across.
    const rankStart: number[] = [];
    let r = 0;
    for (const layer of filled) {
      rankStart.push(r);
      // Room for the arrows' labels, when they run along the ranks (left to right).
      const label = dir === 'LR' ? Math.max(0, ...layer.map((u) => labelAfter.get(u) ?? 0)) : 0;
      r += Math.max(...layer.map((u) => size.get(u)!.rs)) + Math.max(RANK_GAP, label + 40);
    }
    const across = filled.map((layer) => layer.reduce((s, u) => s + size.get(u)!.os, 0) + ORDER_GAP * (layer.length - 1));
    const widest = Math.max(...across);
    filled.forEach((layer, i) => {
      let o = (widest - across[i]) / 2;
      for (const u of layer) {
        const s = size.get(u)!;
        local.set(u, { r: rankStart[i], o, ...s });
        o += s.os + ORDER_GAP;
      }
    });
    return { rs: Math.max(...filled.map((layer, i) => rankStart[i] + Math.max(...layer.map((u) => size.get(u)!.rs)))), os: widest };
  };

  /**
   * Units in outline order in a row, a column or a grid (rows of `columns`,
   * each in a cell as wide as its column's widest and as high as its row's
   * highest, centred there), whatever the direction of the arrows.
   */
  const lineUp = (units: string[], arrange: Arrange): { rs: number; os: number } => {
    const wh = (u: string) => {
      const s = size.get(u)!;
      return dir === 'LR' ? { w: s.rs, h: s.os } : { w: s.os, h: s.rs };
    };
    const n = units.length;
    const cols = arrange.kind === 'row' ? n : arrange.kind === 'column' ? 1 : Math.min(n, arrange.columns || Math.ceil(Math.sqrt(n)));
    const colW: number[] = [];
    const rowH: number[] = [];
    units.forEach((u, i) => {
      const { w, h } = wh(u);
      colW[i % cols] = Math.max(colW[i % cols] ?? 0, w);
      rowH[Math.floor(i / cols)] = Math.max(rowH[Math.floor(i / cols)] ?? 0, h);
    });
    const starts = (sizes: number[]) => sizes.map((_, i) => sizes.slice(0, i).reduce((s, x) => s + x + ARRANGE_GAP, 0));
    const [colX, rowY] = [starts(colW), starts(rowH)];
    units.forEach((u, i) => {
      const [c, r] = [i % cols, Math.floor(i / cols)];
      const { w, h } = wh(u);
      const x = colX[c] + (colW[c] - w) / 2;
      const y = rowY[r] + (rowH[r] - h) / 2;
      local.set(u, { ...size.get(u)!, ...(dir === 'LR' ? { r: x, o: y } : { r: y, o: x }) });
    });
    const total = (sizes: number[]) => sizes.reduce((s, x) => s + x, 0) + ARRANGE_GAP * Math.max(0, sizes.length - 1);
    const [w, h] = [total(colW), total(rowH)];
    return dir === 'LR' ? { rs: w, os: h } : { rs: h, os: w };
  };

  /** A frame's size around its contents (the title and description sit on top, whatever the direction). */
  const framed = (inner: { rs: number; os: number }, n: DiagramNode) => {
    // At least as wide as the description would be in a box; wider contents give it more room.
    const head = Math.max(titleWidth(n, measure), ...descLines(n, measure).map((l) => measure(l, PROP_SIZE)));
    const w = Math.max((dir === 'LR' ? inner.rs : inner.os) + 2 * FRAME_PAD, head + 2 * FRAME_PAD);
    const h = (dir === 'LR' ? inner.os : inner.rs) + 2 * FRAME_PAD + frameHead(n, w, measure);
    return extents({ w, h }, dir);
  };

  place(d.top, d.arrange);

  // Local -> absolute, from the top down. Contents of a frame start below its title.
  const placed = new Map<string, Placed>();
  const settle = (units: string[], r0: number, o0: number) => {
    for (const u of units) {
      const p = local.get(u)!;
      const abs = { ...p, r: p.r + r0, o: p.o + o0 };
      placed.set(u, abs);
      const n = nodes.get(u)!;
      if (!n.isFrame || !n.children.length) continue;
      // The contents are centred in the frame (which may be wider for its title).
      const inner = contentExtent(n.children);
      const x0 = dir === 'LR' ? abs.r : abs.o;
      const y0 = dir === 'LR' ? abs.o : abs.r;
      const w = dir === 'LR' ? abs.rs : abs.os;
      const innerW = dir === 'LR' ? inner.rs : inner.os;
      const cx = x0 + (w - innerW) / 2;
      const cy = y0 + frameHead(n, w, measure) + FRAME_PAD;
      if (dir === 'LR') settle(n.children, cx, cy);
      else settle(n.children, cy, cx);
    }
  };
  const contentExtent = (units: string[]) => {
    let rs = 0;
    let os = 0;
    for (const u of units) {
      const p = local.get(u)!;
      rs = Math.max(rs, p.r + p.rs);
      os = Math.max(os, p.o + p.os);
    }
    return { rs, os };
  };
  settle(d.top, 0, 0);
  return toXY(placed, frames, dir);
}

/**
 * Rank of each unit: one more than the highest of those with arrows into it.
 * Arrows closing a loop (found going through the units in outline order) are
 * left out.
 */
function ranks(units: string[], succ: Map<string, string[]>, pred: Map<string, string[]>): Map<string, number> {
  const state = new Map<string, 1 | 2>(); // 1 on the path, 2 done
  const back = new Set<string>();
  const visit = (u: string) => {
    state.set(u, 1);
    for (const v of succ.get(u)!) {
      if (state.get(v) === 1) back.add(`${u}>${v}`);
      else if (!state.has(v)) visit(v);
    }
    state.set(u, 2);
  };
  units.forEach((u) => !state.has(u) && visit(u));
  const rank = new Map<string, number>();
  const of = (u: string): number => {
    if (rank.has(u)) return rank.get(u)!;
    rank.set(u, 0); // guards against loops while working it out
    const r = Math.max(
      0,
      ...pred
        .get(u)!
        .filter((p) => !back.has(`${p}>${u}`))
        .map((p) => of(p) + 1)
    );
    rank.set(u, r);
    return r;
  };
  units.forEach(of);
  return rank;
}

/** Order each layer by where its neighbours are (barycentres), sweeping down and up a few times. */
function orderLayers(layers: string[][], succ: Map<string, string[]>, pred: Map<string, string[]>) {
  const pos = new Map<string, number>();
  const index = () => layers.forEach((l) => l.forEach((u, i) => pos.set(u, i)));
  index();
  const sweep = (layer: string[], near: Map<string, string[]>) => {
    const key = new Map(
      layer.map((u) => {
        const ns = near.get(u)!.filter((v) => pos.has(v));
        return [u, ns.length ? ns.reduce((s, v) => s + pos.get(v)!, 0) / ns.length : pos.get(u)!];
      })
    );
    layer.sort((a, b) => key.get(a)! - key.get(b)! || pos.get(a)! - pos.get(b)!);
    layer.forEach((u, i) => pos.set(u, i));
  };
  for (let i = 0; i < 4; i++) {
    for (let l = 1; l < layers.length; l++) sweep(layers[l], pred);
    for (let l = layers.length - 2; l >= 0; l--) sweep(layers[l], succ);
  }
  index();
}

/** Tree: the zoomed item's rows as a mind map, each row beside (or below) the one it is under. */
function treeLayout(d: Diagram, measure: Measure): Layout {
  const { nodes, direction: dir } = d;
  const ext = new Map<string, { rs: number; os: number }>();
  for (const n of nodes.values()) ext.set(n.id, extents(boxSize(n, measure), dir));
  // Each depth gets one column (row, for TB) as wide as its widest box.
  const depthSize: number[] = [];
  const span = new Map<string, number>();
  const measureTree = (id: string, depth: number): number => {
    const e = ext.get(id)!;
    depthSize[depth] = Math.max(depthSize[depth] ?? 0, e.rs);
    const kids = nodes.get(id)!.children;
    const inner = kids.reduce((s, c) => s + measureTree(c, depth + 1), 0) + ORDER_GAP * Math.max(0, kids.length - 1);
    const s = Math.max(e.os, inner);
    span.set(id, s);
    return s;
  };
  d.top.forEach((id) => measureTree(id, 0));
  const depthStart: number[] = [];
  depthSize.reduce((r, s, i) => ((depthStart[i] = r), r + s + RANK_GAP), 0);

  const placed = new Map<string, Placed>();
  const branches: [string, string][] = [];
  const put = (id: string, depth: number, o0: number) => {
    const e = ext.get(id)!;
    const s = span.get(id)!;
    placed.set(id, { r: depthStart[depth], o: o0 + (s - e.os) / 2, ...e });
    const kids = nodes.get(id)!.children;
    const inner = kids.reduce((t, c) => t + span.get(c)!, 0) + ORDER_GAP * Math.max(0, kids.length - 1);
    let o = o0 + (s - inner) / 2;
    for (const c of kids) {
      branches.push([id, c]);
      put(c, depth + 1, o);
      o += span.get(c)! + ORDER_GAP;
    }
  };
  let o = 0;
  for (const id of d.top) {
    put(id, 0, o);
    o += span.get(id)! + ORDER_GAP * 2;
  }
  return toXY(placed, new Set(), dir, branches);
}
