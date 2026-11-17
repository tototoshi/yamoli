/*
 * The zoomed item drawn as a diagram (see diagram.ts for how rows, fields and
 * links become boxes, frames and arrows), and edited there: boxes renamed,
 * given a shape and colour, added, moved into frames or along a row, column
 * or grid, and arrows drawn and removed (diagramEdit.ts writes the outline).
 */
import type { ComponentChildren, RefObject } from 'preact';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { CellInput } from './CellInput';
import { COLOR_CHOICES } from './colors';
import { useCtl } from './context';
import {
  buildDiagram,
  descLines,
  NOTE_FOLD,
  NOTE_LINE,
  NOTE_SIZE,
  noteLines,
  diagramDesc,
  DIAGRAM_DESC_SIZE,
  edgeLabelWidth,
  estimate,
  frameDesc,
  frameHead,
  ICON_SPACE,
  layout,
  LABEL_SIZE,
  PAD,
  PROCESS_PAD,
  PROP_SIZE,
  BORDER_KEYS,
  BORDER_WORDS,
  borderOf,
  FONT_KEYS,
  markedLines,
  type Run,
  type Border,
  colorValue,
  CONTAINER,
  type Box,
  type Diagram,
  type DiagramEdge,
  type DiagramNode,
  type Direction,
  type Side,
  type Layout,
  type Measure,
  arrangeOf,
} from './diagram';
import {
  boxAt,
  canConnect,
  connect,
  descOf,
  disconnect,
  dropAt,
  labelOf,
  lineKindOf,
  lineKinds,
  moveBox,
  neighbour,
  reconnect,
  setColor,
  setFontColor,
  setLineColor,
  lineColorOf,
  toggleBorder,
  setDesc,
  setLabel,
  setLineKind,
  setShape,
  setSide,
  group,
  outermost,
  ungroup,
  type ShapeChoice,
  type Drop,
} from './diagramEdit';
import { DEP_KEY } from './deps';
import { standaloneSvg } from './exportImage';
import { ExportTools, type Drawing } from './ExportTools';
import { reselect, useMarkKeys } from './MarkKeys';
import { iconOf } from './icons';
import { lang, t } from './i18n';
import { nodeLabel } from './links';
import { imeActive } from './RowEditor';

const M = 16; // margin around the drawing
/** Line height of the description above the drawing, and room under it. */
const DESC_LINE = 17;
const DESC_GAP = 14;

/** The font of code in a name or label, as the stylesheet draws it (.dg-code). */
const CODE_FONT = 'ui-monospace, SFMono-Regular, Menlo, monospace';
let ctx: CanvasRenderingContext2D | null | undefined;
let family = '';
/** Text width as the browser will draw it. */
const measure: Measure = (text, size, kinds = []) => {
  if (ctx === undefined) {
    ctx = document.createElement('canvas').getContext('2d');
    family = getComputedStyle(document.body).fontFamily;
  }
  if (!ctx) return estimate(text, size);
  const weight = kinds.includes('strong') ? 700 : size === LABEL_SIZE ? 600 : 400;
  ctx.font = `${kinds.includes('em') ? 'italic ' : ''}${weight} ${size}px ${kinds.includes('code') ? CODE_FONT : family}`;
  return ctx.measureText(text).width;
};

type Pt = [number, number];

/** The sides of boxes a and b facing each other: along the diagram's direction when they are apart that way. */
function facing(a: Box, b: Box, dir: Direction): [Side, Side] {
  const apartX = b.x >= a.x + a.w ? 1 : b.x + b.w <= a.x ? -1 : 0;
  const apartY = b.y >= a.y + a.h ? 1 : b.y + b.h <= a.y ? -1 : 0;
  const horizontal = !!apartX && (dir === 'LR' || !apartY);
  const ahead = horizontal ? apartX > 0 : apartY ? apartY > 0 : b.y + b.h / 2 >= a.y + a.h / 2;
  return horizontal ? (ahead ? ['right', 'left'] : ['left', 'right']) : ahead ? ['bottom', 'top'] : ['top', 'bottom'];
}

/** The side of a box nearest a point. */
function nearestSide(r: Box, [x, y]: Pt): Side {
  const away: [Side, number][] = [
    ['top', Math.abs(y - r.y)],
    ['bottom', Math.abs(y - (r.y + r.h))],
    ['left', Math.abs(x - r.x)],
    ['right', Math.abs(x - (r.x + r.w))],
  ];
  return away.sort((p, q) => p[1] - q[1])[0][0];
}

/** A point on a side of a box, at t (0 to 1) along it, and the way out of the box there. */
function onSide(r: Box, side: Side, t: number): { p: Pt; out: Pt } {
  if (side === 'top') return { p: [r.x + r.w * t, r.y], out: [0, -1] };
  if (side === 'bottom') return { p: [r.x + r.w * t, r.y + r.h], out: [0, 1] };
  if (side === 'left') return { p: [r.x, r.y + r.h * t], out: [-1, 0] };
  return { p: [r.x + r.w, r.y + r.h * t], out: [1, 0] };
}

/**
 * An arrow from box a to box b: out of the side facing b, in through the side
 * facing a, along the diagram's direction when the boxes are apart that way;
 * along says how far along those sides (half way: the middle). A
 * curve that would cross another box goes around it instead, in a lane above
 * or below (left or right of) the boxes in the way. Pinned to other sides, it
 * curves straight out of one and into the other.
 */
export function route(
  a: Box,
  b: Box,
  dir: Direction,
  others: Box[],
  labelWidth = 0,
  sides: [Side, Side] = facing(a, b, dir),
  along: [number, number] = [0.5, 0.5],
  taken = new Taken()
): Route {
  const natural = facing(a, b, dir);
  if (sides[0] !== natural[0] || sides[1] !== natural[1]) {
    const [s, e] = [onSide(a, sides[0], along[0]), onSide(b, sides[1], along[1])];
    const k = Math.max(32, Math.hypot(e.p[0] - s.p[0], e.p[1] - s.p[1]) / 2);
    const c1: Pt = [s.p[0] + s.out[0] * k, s.p[1] + s.out[1] * k];
    const c2: Pt = [e.p[0] + e.out[0] * k, e.p[1] + e.out[1] * k];
    const curve = (t: number) => {
      const u = 1 - t;
      return [0, 1].map((i) => u * u * u * s.p[i] + 3 * u * u * t * c1[i] + 3 * u * t * t * c2[i] + t * t * t * e.p[i]) as Pt;
    };
    // The curve, unless it would cross a box (its own two too, away from its ends): then around them.
    const solid = others.filter((r) => !r.frame && r !== a && r !== b);
    const near = (r: Box, [x, y]: Pt) => x > r.x - 4 && x < r.x + r.w + 4 && y > r.y - 4 && y < r.y + r.h + 4;
    const samples = Array.from({ length: 24 }, (_, i) => (i + 1) / 25);
    const crosses = samples.some(
      (t) => solid.some((r) => near(r, curve(t))) || (t > 0.15 && t < 0.85 && [a, b].some((r) => near(r, curve(t))))
    );
    const around = crosses && aroundBoxes(s, e, [...solid, a, b], taken);
    if (around) return (taken.add(around.pts), around);
    const trace = [0, ...samples, 1].map(curve);
    taken.add(trace);
    return { d: `M${s.p} C${c1} ${c2} ${e.p}`, mid: curve(0.5), pts: [], ends: [s.p, e.p], trace };
  }
  const apartX = b.x >= a.x + a.w ? 1 : b.x + b.w <= a.x ? -1 : 0;
  const apartY = b.y >= a.y + a.h ? 1 : b.y + b.h <= a.y ? -1 : 0;
  const horizontal = !!apartX && (dir === 'LR' || !apartY);
  // Work along x; a vertical arrow is the same with x and y swapped.
  const sw = (p: Pt): Pt => (horizontal ? p : [p[1], p[0]]);
  const swb = (r: Box): Box => (horizontal ? r : { x: r.y, y: r.x, w: r.h, h: r.w, frame: r.frame });
  const [A, B] = [swb(a), swb(b)];
  const ahead = horizontal ? apartX > 0 : apartY ? apartY > 0 : b.y + b.h / 2 >= a.y + a.h / 2;
  const s = ahead ? 1 : -1;
  const p0: Pt = [ahead ? A.x + A.w : A.x, A.y + A.h * along[0]];
  const p3: Pt = [ahead ? B.x : B.x + B.w, B.y + B.h * along[1]];
  const k = Math.max(24, Math.abs(p3[0] - p0[0]) / 2);
  const c1: Pt = [p0[0] + s * k, p0[1]];
  const c2: Pt = [p3[0] - s * k, p3[1]];
  const at = (t: number): Pt => {
    const u = 1 - t;
    return [0, 1].map((i) => u * u * u * p0[i] + 3 * u * u * t * c1[i] + 3 * u * t * t * c2[i] + t * t * t * p3[i]) as Pt;
  };
  const boxes = others.filter((r) => r !== a && r !== b && !r.frame).map(swb);
  const hits = (r: Box, [x, y]: Pt) => x > r.x - 4 && x < r.x + r.w + 4 && y > r.y - 4 && y < r.y + r.h + 4;
  const samples = Array.from({ length: 24 }, (_, i) => at((i + 1) / 25));
  const inWay = boxes.filter((r) => samples.some((p) => hits(r, p)));
  if (!inWay.length) {
    const trace = [p0, ...samples, p3].map(sw);
    taken.add(trace);
    return { d: `M${sw(p0)} C${sw(c1)} ${sw(c2)} ${sw(p3)}`, mid: sw(at(0.5)), pts: [], ends: [sw(p0), sw(p3)], trace };
  }

  // A lane clear of every box between the ends, nearest to the straight line.
  const [lo, hi] = [Math.min(p0[0], p3[0]) + 16, Math.max(p0[0], p3[0]) - 16];
  const between = boxes.filter((r) => r.x < hi && r.x + r.w > lo);
  const clear = (y: number) => between.every((r) => y <= r.y - 8 || y >= r.y + r.h + 8);
  const wanted = (p0[1] + p3[1]) / 2;
  // Far enough out for the label too, which sits across a lane that runs down the page.
  const gap = horizontal ? 14 : Math.max(14, labelWidth / 2 + 6);
  const lanes = [...between.map((r) => r.y - gap), ...between.map((r) => r.y + r.h + gap)].filter(clear);
  const nearest = lanes.sort((m, n) => Math.abs(m - wanted) - Math.abs(n - wanted));
  // Off the lines already drawn: a lane, and the stretches down to it, a little aside when another runs there.
  const free = (p: Pt, q: Pt) => taken.free(sw(p), sw(q));
  const aside = [0, 1, -1, 2, -2, 3, -3].map((k) => k * SPACING);
  const [x1s, x2s] = [p0[0] + s * 16, p3[0] - s * 16];
  // The lane and where to turn into it and out of it, together: clear of boxes and of lines running there,
  // crossing the fewest lines drawn, then going least out of the way.
  const lanesNear = nearest
    .flatMap((y) => aside.map((d) => y + d))
    .filter(clear)
    .slice(0, 14);
  const turns = (from: number, sign: number) => [0, 1, 2, 3, 4, 5].map((k) => from + sign * k * SPACING);
  // A stretch down to the lane, not through a box.
  const open = (x: number, y1: number, y2: number) =>
    boxes.every((r) => x <= r.x - 4 || x >= r.x + r.w + 4 || Math.max(y1, y2) <= r.y - 4 || Math.min(y1, y2) >= r.y + r.h + 4);
  // Every way clear of boxes, least out of the way first: only those that could still beat the best so far have their crossings counted.
  const ways: { y: number; x1: number; x2: number; out: number }[] = [];
  for (const y of lanesNear) {
    const ones = turns(x1s, s).filter((x1) => open(x1, p0[1], y) && free([x1, p0[1]], [x1, y]));
    const twos = turns(x2s, -s).filter((x2) => open(x2, y, p3[1]) && free([x2, y], [x2, p3[1]]));
    for (const x1 of ones) {
      for (const x2 of twos) {
        if (s * (x2 - x1) > SPACING) ways.push({ y, x1, x2, out: Math.abs(y - wanted) + (Math.abs(x1 - x1s) + Math.abs(x2 - x2s)) / 2 });
      }
    }
  }
  ways.sort((m, n) => m.out - n.out);
  // Crossings counted in three parts, each counted once: up to the furthest turn into the lane, the lane between, and on from the first turn out.
  const [m1, m2] = [x1s + s * 5 * SPACING, x2s - s * 5 * SPACING];
  const counted = new Map<string, number>();
  const part = (key: string, pts: Pt[]) => {
    if (!counted.has(key)) counted.set(key, taken.crossings(pts.map(sw)));
    return counted.get(key)!;
  };
  const crossings = (pts: Pt[]) => {
    const [[x1, y], [x2]] = [pts[2], pts[3]];
    if (s * (m2 - m1) < 0) return taken.crossings(pts.map(sw));
    const lane: Pt[] = [
      [m1, y],
      [m2, y],
    ];
    return (
      part(`in ${x1} ${y}`, [...pts.slice(0, 3), lane[0]]) + part(`lane ${y}`, lane) + part(`out ${x2} ${y}`, [lane[1], ...pts.slice(3)])
    );
  };
  let best: { cost: number; pts: Pt[] } | null = null;
  for (const { y, x1, x2, out } of ways) {
    if (best && out >= best.cost) break;
    if (!free([x1, y], [x2, y])) continue;
    const pts: Pt[] = [p0, [x1, p0[1]], [x1, y], [x2, y], [x2, p3[1]], p3];
    const cost = out + CROSSING * crossings(pts);
    if (!best || cost < best.cost) best = { cost, pts };
  }
  const lane = best ? best.pts[2][1] : (nearest[0] ?? wanted);
  const [x1, x2] = best ? [best.pts[1][0], best.pts[3][0]] : [x1s, x2s];
  const pts: Pt[] = [p0, [x1, p0[1]], [x1, lane], [x2, lane], [x2, p3[1]], p3];
  taken.add(pts.map(sw));
  return { d: rounded(pts.map(sw)), mid: sw([(x1 + x2) / 2, lane]), pts: pts.map(sw), ends: [sw(p0), sw(p3)], trace: pts.map(sw) };
}

/** A line drawn between two boxes. */
interface Route {
  /** The SVG path. */
  d: string;
  /** Where its label goes. */
  mid: Pt;
  /** Its corners, when it goes around boxes (none for a curve). */
  pts: Pt[];
  /** Where it leaves and enters. */
  ends: [Pt, Pt];
  /** The line as short straight stretches, to tell what it crosses. */
  trace: Pt[];
}

/** How far apart lines running side by side are kept. */
const SPACING = 8;
/** How much a crossing weighs against going further round, in pixels. */
const CROSSING = 80;

/** The straight stretches of the lines drawn so far, for the next ones to keep off. */
export class Taken {
  /** Across the page, by where they are down it: [y, from x, to x, which stretch]. */
  private across = new Map<number, [number, number, number, number][]>();
  /** Down the page, by where they are across it: [x, from y, to y, which stretch]. */
  private down = new Map<number, [number, number, number, number][]>();
  /** Every stretch, curves as short straight ones, to count crossings with. */
  private all: [Pt, Pt][] = [];
  /** Which of them pass through each square of the page, so only those near a line are looked at. */
  private cells = new Map<number, number[]>();
  /** The last count each stretch was looked at in, so one in several squares counts once. */
  private seen: number[] = [];
  private count = 0;
  /** Stretches taken away for now (of a line being drawn again). */
  private hidden = new Set<number>();

  private static CELL = 48;
  /** The squares a stretch from p to q passes through (those its bounds cover). */
  private static squares([x1, y1]: Pt, [x2, y2]: Pt, each: (key: number) => void) {
    const c = Taken.CELL;
    for (let i = Math.floor(Math.min(x1, x2) / c); i <= Math.floor(Math.max(x1, x2) / c); i++)
      for (let j = Math.floor(Math.min(y1, y2) / c); j <= Math.floor(Math.max(y1, y2) / c); j++) each(i * 65536 + j);
  }

  /** How many stretches have been drawn. */
  get size() {
    return this.all.length;
  }

  /** How many of the lines drawn (the first `upto` stretches) the line through pts crosses (touching at an end doesn't count). */
  crossings(pts: Pt[], upto = Infinity): number {
    const turn = (a: Pt, b: Pt, c: Pt) => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
    let n = 0;
    for (let i = 1; i < pts.length; i++) {
      const [p, q] = [pts[i - 1], pts[i]];
      const count = ++this.count;
      Taken.squares(p, q, (key) => {
        for (const k of this.cells.get(key) ?? []) {
          if (this.seen[k] === count || k >= upto || this.hidden.has(k)) continue;
          this.seen[k] = count;
          const [r, t] = this.all[k];
          if (turn(p, q, r) * turn(p, q, t) < 0 && turn(r, t, p) * turn(r, t, q) < 0) n++;
        }
      });
    }
    return n;
  }

  /** Whether a straight stretch from p to q keeps clear of every one running the same way. */
  free([x1, y1]: Pt, [x2, y2]: Pt): boolean {
    const runs = (by: Map<number, [number, number, number, number][]>, at: number, a: number, b: number) =>
      [-1, 0, 1].every((k) =>
        (by.get(Math.round(at / SPACING) + k) ?? []).every(
          ([c, lo, hi, n]) =>
            Math.abs(c - at) >= SPACING - 1 || Math.min(hi, Math.max(a, b)) - Math.max(lo, Math.min(a, b)) <= 2 || this.hidden.has(n)
        )
      );
    if (y1 === y2) return runs(this.across, y1, x1, x2);
    if (x1 === x2) return runs(this.down, x1, y1, y2);
    return true;
  }

  /** Note the stretches of a line through pts; which they are, to hide them again. */
  add(pts: Pt[]): [number, number] {
    const first = this.all.length;
    const put = (by: Map<number, [number, number, number, number][]>, run: [number, number, number, number]) => {
      const k = Math.round(run[0] / SPACING);
      const list = by.get(k);
      if (list) list.push(run);
      else by.set(k, [run]);
    };
    for (let i = 1; i < pts.length; i++) {
      const [p, q] = [pts[i - 1], pts[i]];
      const k = this.all.push([p, q]) - 1;
      Taken.squares(p, q, (key) => {
        const list = this.cells.get(key);
        if (list) list.push(k);
        else this.cells.set(key, [k]);
      });
      const [[x1, y1], [x2, y2]] = [p, q];
      if (y1 === y2) put(this.across, [y1, Math.min(x1, x2), Math.max(x1, x2), k]);
      else if (x1 === x2) put(this.down, [x1, Math.min(y1, y2), Math.max(y1, y2), k]);
    }
    return [first, this.all.length];
  }

  /** Leave out stretches added before (from, to), as if not drawn, or put them back. */
  hide([from, to]: [number, number], hidden = true) {
    for (let k = from; k < to; k++) {
      if (hidden) this.hidden.add(k);
      else this.hidden.delete(k);
    }
  }
}

/** Room kept between a line going around boxes and the boxes. */
const CLEAR = 12;

/**
 * A line from s to e (points on sides of boxes, with the way out of each)
 * going around boxes at right angles: a little way straight out of each
 * side, then the shortest way between on lines clear of every box, with as
 * few turns as it can. Null when no way is found.
 */
export function aroundBoxes(s: { p: Pt; out: Pt }, e: { p: Pt; out: Pt }, boxes: Box[], taken = new Taken()) {
  const stub = CLEAR + 8;
  const q0: Pt = [s.p[0] + s.out[0] * stub, s.p[1] + s.out[1] * stub];
  const q3: Pt = [e.p[0] + e.out[0] * stub, e.p[1] + e.out[1] * stub];
  const inside = ([x, y]: Pt) => boxes.some((r) => x > r.x - CLEAR && x < r.x + r.w + CLEAR && y > r.y - CLEAR && y < r.y + r.h + CLEAR);
  const blocked = ([x1, y1]: Pt, [x2, y2]: Pt) =>
    boxes.some(
      (r) =>
        Math.max(x1, x2) > r.x - CLEAR &&
        Math.min(x1, x2) < r.x + r.w + CLEAR &&
        Math.max(y1, y2) > r.y - CLEAR &&
        Math.min(y1, y2) < r.y + r.h + CLEAR
    );
  // Lines to run on: through both ends, and just clear of each box's sides (and a little further, beside lines already there).
  const lines = (pick: (p: Pt) => number, lo: (r: Box) => number, size: (r: Box) => number) =>
    [
      ...new Set([
        pick(q0),
        pick(q3),
        ...boxes.flatMap((r) => [0, 1, 2].flatMap((k) => [lo(r) - CLEAR - 4 - k * SPACING, lo(r) + size(r) + CLEAR + 4 + k * SPACING])),
      ]),
    ].sort((m, n) => m - n);
  const xs = lines(
    (p) => p[0],
    (r) => r.x,
    (r) => r.w
  );
  const ys = lines(
    (p) => p[1],
    (r) => r.y,
    (r) => r.h
  );
  const W = xs.length;
  const at = (n: number): Pt => [xs[n % W], ys[Math.floor(n / W)]];
  const start = xs.indexOf(q0[0]) + ys.indexOf(q0[1]) * W;
  const goal = xs.indexOf(q3[0]) + ys.indexOf(q3[1]) * W;
  // Shortest by length, each turn counting as more length. A state is a point and the way it was reached.
  const TURN = 40;
  const steps: [number, number][] = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  const cost = new Map<number, number>();
  const from = new Map<number, number>();
  const queue: [number, number][] = [];
  const push = (state: number, c: number, prev: number) => {
    if (c >= (cost.get(state) ?? Infinity)) return;
    cost.set(state, c);
    from.set(state, prev);
    queue.push([c, state]);
    // Kept in order by bubbling up: a small heap.
    for (let i = queue.length - 1; i > 0;) {
      const up = (i - 1) >> 1;
      if (queue[up][0] <= queue[i][0]) break;
      [queue[up], queue[i]] = [queue[i], queue[up]];
      i = up;
    }
  };
  const pop = () => {
    const top = queue[0];
    const last = queue.pop()!;
    if (queue.length) {
      queue[0] = last;
      for (let i = 0; ;) {
        const [l, r] = [2 * i + 1, 2 * i + 2];
        let m = i;
        if (l < queue.length && queue[l][0] < queue[m][0]) m = l;
        if (r < queue.length && queue[r][0] < queue[m][0]) m = r;
        if (m === i) break;
        [queue[m], queue[i]] = [queue[i], queue[m]];
        i = m;
      }
    }
    return top;
  };
  for (let dir = 0; dir < 4; dir++) push(start * 4 + dir, 0, -1);
  let end = -1;
  while (queue.length) {
    const [c, state] = pop();
    if (c > (cost.get(state) ?? Infinity)) continue;
    const [n, dir] = [state >> 2, state & 3];
    if (n === goal) {
      end = state;
      break;
    }
    const [i, j] = [n % W, Math.floor(n / W)];
    steps.forEach(([di, dj], nd) => {
      const [i2, j2] = [i + di, j + dj];
      if (i2 < 0 || i2 >= W || j2 < 0 || j2 >= ys.length) return;
      const m = i2 + j2 * W;
      const [p, q] = [at(n), at(m)];
      if ((m !== goal && inside(q)) || blocked(p, q)) return;
      // Running along a line already drawn costs more than going round.
      const along = (taken.free(p, q) ? 0 : 4 * TURN) + CROSSING * taken.crossings([p, q]);
      push(m * 4 + nd, c + Math.abs(q[0] - p[0]) + Math.abs(q[1] - p[1]) + (nd === dir ? 0 : TURN) + along, state);
    });
  }
  if (end < 0) return null;
  const path: Pt[] = [];
  for (let st = end; st >= 0; st = from.get(st)!) path.unshift(at(st >> 2));
  // Only the corners: points where the line turns.
  const pts = [s.p, ...path, e.p].filter((p, i, all) => {
    if (i === 0 || i === all.length - 1) return true;
    const [a, b] = [all[i - 1], all[i + 1]];
    return !((a[0] === p[0] && p[0] === b[0]) || (a[1] === p[1] && p[1] === b[1]));
  });
  // The label on the longest stretch.
  let mid: Pt = pts[0];
  let longest = -1;
  for (let i = 1; i < pts.length; i++) {
    const len = Math.abs(pts[i][0] - pts[i - 1][0]) + Math.abs(pts[i][1] - pts[i - 1][1]);
    if (len > longest) [longest, mid] = [len, [(pts[i][0] + pts[i - 1][0]) / 2, (pts[i][1] + pts[i - 1][1]) / 2]];
  }
  return { d: rounded(pts), mid, pts, ends: [s.p, e.p] as [Pt, Pt], trace: pts };
}

/** The way each arrow goes, and the sides of its boxes it joins. */
export function routeAll(d: Diagram, L: Layout, measure: Measure) {
  // A frame's description is in the way of lines too (its title alone has room above the contents),
  // except of lines to that frame.
  const heads = new Map<string, Box>();
  for (const [nid, b] of L.boxes) {
    const n = d.nodes.get(nid)!;
    if (b.frame && n.desc) heads.set(nid, { x: b.x, y: b.y + 4, w: b.w, h: frameHead(n, b.w, measure) - 4, frame: false });
  }
  const all = [...L.boxes.values()];
  // The sides each arrow joins its boxes by: where pinned, else facing each other.
  const sidesOf = new Map(
    d.edges.map((e) => {
      const natural = facing(L.boxes.get(e.from)!, L.boxes.get(e.to)!, d.direction);
      return [e, [e.sides.from ?? natural[0], e.sides.to ?? natural[1]] as [Side, Side]];
    })
  );
  // Ends sharing a side of a box spread out along it, in the order of the boxes at their other ends, so they don't cross.
  const at = new Map(d.edges.map((e) => [e, [0.5, 0.5] as [number, number]]));
  const sharing = new Map<string, { e: DiagramEdge; end: 0 | 1; box: string; side: Side; other: Box }[]>();
  for (const e of d.edges) {
    const [s0, s1] = sidesOf.get(e)!;
    for (const end of [
      { e, end: 0 as const, box: e.from, side: s0, other: L.boxes.get(e.to)! },
      { e, end: 1 as const, box: e.to, side: s1, other: L.boxes.get(e.from)! },
    ]) {
      const k = `${end.box} ${end.side}`;
      sharing.set(k, [...(sharing.get(k) ?? []), end]);
    }
  }
  for (const ends of sharing.values()) {
    if (ends.length < 2) continue;
    const { box, side } = ends[0];
    const b = L.boxes.get(box)!;
    const across = side === 'top' || side === 'bottom';
    const centre = (r: Box) => (across ? r.x + r.w / 2 : r.y + r.h / 2);
    const len = across ? b.w : b.h;
    const step = Math.min(len / (ends.length + 1), 16) / len;
    ends.sort((p, q) => centre(p.other) - centre(q.other));
    ends.forEach(({ e, end }, i) => (at.get(e)![end] = 0.5 + (i - (ends.length - 1) / 2) * step));
  }
  const routeOf = (e: DiagramEdge, taken?: Taken) => {
    const others = [...all, ...[...heads].filter(([nid]) => nid !== e.from && nid !== e.to).map(([, h]) => h)];
    const labelWidth = e.label ? edgeLabelWidth(e, measure) + 8 : 0;
    return route(L.boxes.get(e.from)!, L.boxes.get(e.to)!, d.direction, others, labelWidth, sidesOf.get(e), at.get(e), taken);
  };
  // Curves first: they go their own way, and the lines going round boxes then pick ways crossing them least.
  const first = new Map(d.edges.map((e) => [e, routeOf(e)]));
  const curved = d.edges.filter((e) => !first.get(e)!.pts.length);
  // Lines going round boxes after, one by one, each keeping off those before: in whichever of a few orders crosses least
  // (when there are many, trying more orders takes long and seldom helps).
  const rounding = d.edges.filter((e) => first.get(e)!.pts.length);
  const from = (e: DiagramEdge) => {
    const b = L.boxes.get(e.from)!;
    return b.y + b.h / 2 + (b.x + b.w / 2) / 1e4;
  };
  const orders = [
    rounding,
    [...rounding].reverse(),
    [...rounding].sort((p, q) => from(p) - from(q)),
    [...rounding].sort((p, q) => from(q) - from(p)),
  ];
  /** Every line's crossings with the others, each counted once. */
  const crossingsIn = (rs: Map<DiagramEdge, Route>) => {
    const t = new Taken();
    let n = 0;
    for (const r of rs.values()) {
      n += t.crossings(r.trace);
      t.add(r.trace);
    }
    return n;
  };
  let routes = new Map<DiagramEdge, Route>();
  let fewest = Infinity;
  for (const order of orders.slice(0, rounding.length > 1 && rounding.length <= 30 ? 4 : 1)) {
    const taken = new Taken();
    const rs = new Map(curved.map((e) => [e, first.get(e)!]));
    for (const r of rs.values()) taken.add(r.trace);
    for (const e of order) rs.set(e, routeOf(e, taken));
    const n = crossingsIn(rs);
    if (n < fewest) [routes, fewest] = [rs, n];
    if (!n) break;
  }
  // Then each line going around boxes is routed again knowing all the others, kept when it crosses fewer.
  const drawn = new Taken();
  const stretches = new Map([...routes].map(([e, r]) => [e, drawn.add(r.trace)]));
  for (let pass = 0; pass < 2 && fewest > 0; pass++) {
    for (const e of rounding) {
      const was = stretches.get(e)!;
      drawn.hide(was);
      const now = drawn.crossings(routes.get(e)!.trace);
      const before = drawn.size;
      const again = now ? routeOf(e, drawn) : null;
      const added: [number, number] = [before, drawn.size];
      if (again && drawn.crossings(again.trace, before) < now) {
        routes.set(e, again);
        stretches.set(e, added);
      } else {
        drawn.hide(added);
        drawn.hide(was, false);
      }
    }
  }
  return { routes, sidesOf };
}

/** A polyline with its corners rounded. */
function rounded(pts: Pt[], radius = 8): string {
  let d = `M${pts[0]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [p, q, n] = [pts[i - 1], pts[i], pts[i + 1]];
    const r = Math.min(radius, Math.hypot(q[0] - p[0], q[1] - p[1]) / 2, Math.hypot(n[0] - q[0], n[1] - q[1]) / 2);
    const toward = (from: Pt, to: Pt): Pt => {
      const len = Math.hypot(to[0] - from[0], to[1] - from[1]) || 1;
      return [q[0] + ((to[0] - from[0]) / len) * r, q[1] + ((to[1] - from[1]) / len) * r];
    };
    d += ` L${toward(q, p)} Q${q} ${toward(q, n)}`;
  }
  return d + ` L${pts[pts.length - 1]}`;
}

/** A mind-map branch from parent to child. */
function branch(a: Box, b: Box, dir: Direction): string {
  if (dir === 'LR') {
    const p0: Pt = [a.x + a.w, a.y + a.h / 2];
    const p3: Pt = [b.x, b.y + b.h / 2];
    const mx = (p0[0] + p3[0]) / 2;
    return `M${p0} C${mx},${p0[1]} ${mx},${p3[1]} ${p3}`;
  }
  const p0: Pt = [a.x + a.w / 2, a.y + a.h];
  const p3: Pt = [b.x + b.w / 2, b.y];
  const my = (p0[1] + p3[1]) / 2;
  return `M${p0} C${p0[0]},${my} ${p3[0]},${my} ${p3}`;
}

/** Where an arrow's label is typed: across the middle of the line. */
const labelAt = ([x, y]: Pt) => ({ x: x - 90, y: y - 14, width: 180, height: 28 });

/**
 * A box over the selection, unseen until typed into: then it shows, and Enter
 * or leaving it keeps what was typed (Escape empties it). Keys while it is
 * empty are the diagram's (onKey), so it only waits for text, IME too.
 */
function TypeIn({ class: cls, onKey, onDone }: { class: string; onKey: (e: KeyboardEvent) => boolean; onDone: (text: string) => void }) {
  const [text, setText] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => input.current?.focus({ preventScroll: true }), []);
  const typing = text !== '';
  return (
    <input
      ref={input}
      class={cls + (typing ? '' : ' dg-type-idle')}
      value={text}
      onInput={(e) => setText(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (imeActive(e)) return;
        if (!typing) {
          if (onKey(e)) e.preventDefault();
        } else if (e.key === 'Enter') {
          e.preventDefault();
          onDone(text);
        } else if (e.key === 'Escape') setText('');
      }}
      onBlur={() => typing && onDone(text)}
    />
  );
}

/** How much larger than its own size an embedded diagram may be drawn. */
const EMBED_GROW = 2;

/** Shapes and colours offered in a box's menu. */
const SHAPE_CHOICES: [ShapeChoice, () => string][] = [
  ['box', () => t('箱', 'Box')],
  ['actor', () => t('人', 'Actor')],
  ['db', () => t('DB', 'Database')],
  ['queue', () => t('キュー', 'Queue')],
  ['external', () => t('外部', 'External')],
  ['process', () => t('プロセス', 'Process')],
  ['store', () => t('データストア', 'Data store')],
  ['sticky', () => t('付箋', 'Sticky note')],
  ['frame', () => t('枠', 'Frame')],
  [CONTAINER, () => t('入れ物', 'Container')],
  ['row', () => t('横並び', 'Row')],
  ['column', () => t('縦並び', 'Column')],
  ['grid', () => t('格子', 'Grid')],
];
/** The outlines offered in a box's menu, each turned on and off there. */
const BORDER_CHOICES: [string, () => string][] = [
  ['solid', () => t('実線', 'Solid')],
  ['dashed', () => t('破線', 'Dashed')],
  ['dotted', () => t('点線', 'Dotted')],
  ['none', () => t('線なし', 'None')],
  ['thick', () => t('太く', 'Thick')],
  ['thin', () => t('細く', 'Thin')],
  ['double', () => t('二重', 'Double')],
  ['round', () => t('角丸', 'Round')],
  ['square', () => t('角', 'Square')],
  ['shadow', () => t('影', 'Shadow')],
];
/** What boxes selected together can be put in, from their menu. */
const GROUP_CHOICES = [
  ['row', () => t('横に並べる', 'Line up in a row')],
  ['column', () => t('縦に並べる', 'Line up in a column')],
  ['grid', () => t('格子に並べる', 'Line up in a grid')],
  ['frame', () => t('枠で囲む', 'Put in a frame')],
] as const;
/** The names of what they are put in: a line-up's is unseen, a note in the outline. */
const GROUP_NAMES = {
  row: () => t('横並び', 'Row'),
  column: () => t('縦並び', 'Column'),
  grid: () => t('格子', 'Grid'),
  frame: () => t('グループ', 'Group'),
};

/**
 * A row of colours to pick from in a menu, the first taking the colour away;
 * letters shows each as a coloured A, for text, after the row's label.
 */
function Swatches(props: { label: string; value?: string; none: string; letters?: boolean; onPick: (color: string | null) => void }) {
  const { value, letters, onPick } = props;
  return (
    <div class={'dg-menu-row' + (letters ? ' letters' : '')} role="group" aria-label={props.label}>
      {letters && <span class="dg-swatch-label">{props.label}</span>}
      {[null, ...COLOR_CHOICES].map((c) => (
        <button
          key={c ?? ''}
          class={'dg-swatch' + (c ? '' : ' none') + (value === (c ?? undefined) ? ' on' : '')}
          title={c ?? props.none}
          style={c ? (letters ? { color: colorValue(c) } : { background: colorValue(c) }) : undefined}
          onClick={() => onPick(c)}
        >
          {letters && 'A'}
        </button>
      ))}
    </div>
  );
}

const edgeKey = (e: DiagramEdge) => `${e.from}>${e.to}>${e.label}>${e.style.dash}${e.style.ends}`;

/** How far the drawing zooms out and in, and by how much a button press. */
const ZOOM_MIN = 0.2;
const ZOOM_MAX = 3;
const ZOOM_STEP = 1.25;

/**
 * How large the drawing is shown, and moving about it: ⌘/Ctrl + the wheel (a
 * pinch on a trackpad) zooms around the pointer, the buttons around the middle
 * of what is in sight, and a drag on the empty background scrolls. Each item
 * opens fitted (no larger than its own size).
 */
function useZoom(id: string, scroller: RefObject<HTMLDivElement | null>, svg: RefObject<SVGSVGElement | null>, on: boolean) {
  const [scale, setScale] = useState(1);
  const now = useRef(scale);
  now.current = scale;
  const [panning, setPanning] = useState(false);
  /** The point kept where it is on screen: there, and how far across and down the drawing it is. */
  const anchor = useRef<{ x: number; y: number; fx: number; fy: number } | null>(null);
  const zoom = (next: number, at?: { clientX: number; clientY: number }) => {
    const [s, w] = [svg.current, scroller.current];
    if (!s || !w) return;
    const r = s.getBoundingClientRect();
    const v = w.getBoundingClientRect();
    const x = at ? at.clientX : (Math.max(r.left, v.left) + Math.min(r.right, v.right)) / 2;
    const y = at ? at.clientY : (Math.max(r.top, 0) + Math.min(r.bottom, innerHeight)) / 2;
    anchor.current = { x, y, fx: (x - r.left) / r.width, fy: (y - r.top) / r.height };
    setScale(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next)));
  };
  useLayoutEffect(() => {
    const a = anchor.current;
    anchor.current = null;
    const [s, w] = [svg.current, scroller.current];
    if (!a || !s || !w) return;
    const r = s.getBoundingClientRect();
    w.scrollLeft += r.left + a.fx * r.width - a.x;
    window.scrollBy(0, r.top + a.fy * r.height - a.y);
  }, [scale]);
  /** All of a drawing width × height in sight: no wider than the view, no taller than the window, no larger than its own size. */
  const fitted = (width: number, height: number) =>
    Math.max(ZOOM_MIN, Math.min(1, scroller.current!.clientWidth / width, (innerHeight - 120) / height));
  // Opened (another item, or first drawn), it fits, before it is seen.
  const opened = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!on || opened.current === id || !svg.current || !scroller.current) return;
    opened.current = id;
    const { width, height } = svg.current.viewBox.baseVal;
    anchor.current = null;
    setScale(fitted(width, height));
  });
  useEffect(() => {
    const w = scroller.current;
    if (!on || !w) return;
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault(); // not the page's own zoom
      // A pinch comes in small steps; a mouse wheel's notch, no more than one button press.
      zoom(now.current * Math.exp(-Math.max(-22, Math.min(22, e.deltaY)) * 0.01), e);
    };
    w.addEventListener('wheel', wheel, { passive: false });
    return () => w.removeEventListener('wheel', wheel);
  }, [on]);
  return {
    scale,
    panning,
    by: (k: number) => zoom(now.current * k),
    reset: () => zoom(1),
    /** All of it in sight, and scrolled to. */
    fit: (width: number, height: number) => {
      if (!scroller.current) return;
      anchor.current = null;
      setScale(fitted(width, height));
      requestAnimationFrame(() => svg.current?.scrollIntoView({ block: 'center', inline: 'center' }));
    },
    /** A press on the background: dragged, it scrolls; let go where it was, it is a click. */
    pan: (e: PointerEvent, click: () => void) => {
      const w = scroller.current;
      if (!w || e.button !== 0) return click();
      const [x, y, left, top] = [e.clientX, e.clientY, w.scrollLeft, window.scrollY];
      let moved = false;
      const move = (ev: PointerEvent) => {
        if (!moved && Math.hypot(ev.clientX - x, ev.clientY - y) < 4) return;
        if (!moved) setPanning((moved = true));
        w.scrollLeft = left - (ev.clientX - x);
        window.scrollTo(window.scrollX, top - (ev.clientY - y));
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        setPanning(false);
        if (!moved) click();
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    },
  };
}

function ZoomTools({ zoom, onFit }: { zoom: ReturnType<typeof useZoom>; onFit: () => void }) {
  return (
    <span class="dg-zoom" role="group" aria-label={t('表示の大きさ', 'Zoom')}>
      <button class="mini" title={t('縮小（⌘ + ホイールでも）', 'Zoom out (or ⌘ + wheel)')} onClick={() => zoom.by(1 / ZOOM_STEP)}>
        −
      </button>
      <button class="mini dg-zoom-level" title={t('原寸に戻す', 'Actual size')} onClick={zoom.reset}>
        {Math.round(zoom.scale * 100)}%
      </button>
      <button class="mini" title={t('拡大（⌘ + ホイールでも）', 'Zoom in (or ⌘ + wheel)')} onClick={() => zoom.by(ZOOM_STEP)}>
        +
      </button>
      <button class="mini" title={t('全体が見える大きさに', 'Fit it all in sight')} onClick={onFit}>
        {t('全体', 'Fit')}
      </button>
    </span>
  );
}

/**
 * The diagram (a flow, or a mind map) for the zoomed item, or (embedded, e.g.
 * in a slide) for rootId, without the hints and not editable but for edit:
 * then its keys and paste act only on what is selected in it (marked on it as
 * data-holding, for the page around to leave keys to it), and a click outside
 * it lets go of that. zoomable (in a document): drawn and zoomed as in its own
 * view, rather than shrunk into the space given.
 */
export function DiagramView({
  rootId,
  embedded,
  edit,
  zoomable,
  kind = 'flow',
}: {
  rootId?: string;
  embedded?: boolean;
  edit?: boolean;
  zoomable?: boolean;
  kind?: 'flow' | 'tree';
}) {
  const ctl = useCtl();
  const { store } = ctl;
  const id = rootId ?? ctl.zoomId;
  const marker = 'dg-arrow' + useId().replace(/\W/g, '');
  const [hover, setHover] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  /** Shrunk into the space given (in a slide), not zoomed. */
  const sized = embedded && !zoomable;
  const zoom = useZoom(id, scrollRef, svgRef, !sized);
  /** The box or arrow clicked, which Delete removes (and Enter renames, for a box). */
  const [sel, setSel] = useState<{ box: string } | { edge: string } | null>(null);
  /** More boxes picked with Shift or ⌘ besides the selected one, to line up, frame or remove together. */
  const [more, setMore] = useState<string[]>([]);
  const select = (s: { box: string } | { edge: string } | null) => {
    setSel(s);
    setMore([]);
  };
  /** The selected boxes and where they were right-clicked. */
  const [manyMenu, setManyMenu] = useState<{ x: number; y: number } | null>(null);
  /** Whether saving an image with boxes selected saves only them. */
  const [onlyChosen, setOnlyChosen] = useState(true);
  const [renaming, setRenaming] = useState<string | null>(null);
  /** The arrow whose label is being written (its key). */
  const [labeling, setLabeling] = useState<string | null>(null);
  /** Counts what was typed straight onto the selection, so the box waiting for it starts empty again. */
  const [typedIn, setTypedIn] = useState(0);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  /** The arrow right-clicked, and where. */
  const [edgeMenu, setEdgeMenu] = useState<{ x: number; y: number } | null>(null);
  /** An arrow being drawn from a box: where the pointer is, and the box under it. */
  const [link, setLink] = useState<{ from: string; at: Pt; to: string | null } | null>(null);
  /** An end of the selected arrow being dragged to another box: from the end that stays, where the pointer is, and the box under it. */
  const [bend, setBend] = useState<{ fixed: Pt; at: Pt; to: string | null } | null>(null);
  /** A box being dragged: how far, and where it would go. */
  const [moving, setMoving] = useState<{ id: string; dx: number; dy: number; drop: Drop | null } | null>(null);
  /** The arrows' ways last worked out, and for what. */
  const routed = useRef<{ key: string; routes: Route[]; sides: [Side, Side][] } | null>(null);
  const showCompleted = ctl.prefs.showCompleted;
  // Built anew on each render: the store changes in place, and laying out a page of boxes is quick.
  const d = buildDiagram(store, id, { showCompleted, kind });
  const L = layout(d, measure);
  const editable = !embedded || !!edit;

  const selectedEdge = sel && 'edge' in sel ? d.edges.find((e) => edgeKey(e) === sel.edge) : undefined;
  const selectedBox = sel && 'box' in sel && L.boxes.has(sel.box) ? sel.box : null;
  /** All the boxes selected: the selected one first. */
  const chosen = selectedBox ? [selectedBox, ...more.filter((m) => m !== selectedBox && L.boxes.has(m))] : [];
  const many = chosen.length > 1;
  /** Add a box to the selection, or take it out. */
  const toggle = (nid: string) => {
    if (!selectedBox) return select({ box: nid });
    const rest = chosen.includes(nid) ? chosen.filter((c) => c !== nid) : [...chosen, nid];
    setSel(rest.length ? { box: rest[0] } : null);
    setMore(rest.slice(1));
  };
  const remove = () => {
    if (selectedEdge) {
      disconnect(store, selectedEdge);
      ctl.commit();
    } else if (many) {
      for (const c of outermost(
        store,
        chosen.filter((c) => c !== id)
      ))
        store.remove(c);
      ctl.commit();
    } else if (selectedBox && selectedBox !== id && selectedBox !== ctl.zoomId) ctl.deleteItem(selectedBox);
    select(null);
  };
  // Keys on the selection. The listener stays put and reads the latest render, so keys typed quickly one after another all count.
  const onKey = useRef<(e: KeyboardEvent) => boolean>(() => false);
  onKey.current = (e) => {
    if (!sel || renaming || labeling || menu || edgeMenu || manyMenu) return false;
    if (e.key === 'Escape') select(null);
    else if (many && (e.key === 'Delete' || e.key === 'Backspace')) remove();
    else if (many) return false;
    else if (e.key === 'Delete' || e.key === 'Backspace') remove();
    else if ((e.key === 'Enter' || e.key === 'F2') && selectedEdge && canLabel(selectedEdge)) setLabeling(edgeKey(selectedEdge));
    else if (d.kind === 'tree' && selectedBox) return !(e.metaKey || e.ctrlKey || e.altKey) && mindMapKey(e, selectedBox);
    else if (e.key === 'Enter' && selectedBox) setRenaming(selectedBox);
    else return false;
    return true;
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as Element).closest('input, textarea, [contenteditable]')) return;
      if (onKey.current(e)) e.preventDefault();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  // Copying the selected box takes the rows under it and the arrows among them; pasting adds the boxes after the selected one.
  const onClip = useRef<(e: ClipboardEvent) => void>(() => {});
  onClip.current = (e) => {
    if (renaming || labeling || menu || edgeMenu || manyMenu || !e.clipboardData) return;
    // Words typed or selected are copied and pasted as usual; the unseen box waiting on the selection isn't typed in yet.
    const target = e.target as Element;
    if (target.closest?.('input, textarea, [contenteditable]') && !target.classList.contains('dg-type-idle')) return;
    if (e.type !== 'paste' && !document.getSelection()?.isCollapsed) return;
    if (embedded && !sel) return; // in a document, pasting elsewhere is the document's
    if (e.type === 'paste') {
      const text = e.clipboardData.getData('text');
      if (!text.trim()) return;
      e.preventDefault();
      const after = selectedBox && selectedBox !== id ? selectedBox : null;
      const parent = after ? store.parentOf(after)! : id;
      const index = after ? store.indexOf(after) + 1 : store.node(parent).children.length;
      const added = ctl.pasteItems(text, parent, index);
      if (!added.length) return;
      ctl.commit();
      select({ box: added[added.length - 1] });
    } else if (selectedBox) {
      e.preventDefault();
      e.clipboardData.setData('text/plain', ctl.copyItems(many ? outermost(store, chosen) : [selectedBox]));
      if (e.type === 'cut' && (many || selectedBox !== id)) remove();
    }
  };
  // In a document, a click anywhere else lets go of the selection, so keys there are the document's again.
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!embedded || !edit) return;
    const away = (e: PointerEvent) => !wrapRef.current?.contains(e.target as Node) && select(null);
    window.addEventListener('pointerdown', away);
    return () => window.removeEventListener('pointerdown', away);
  }, [embedded, edit]);
  useEffect(() => {
    if (embedded && !edit) return;
    const clip = (e: Event) => onClip.current(e as ClipboardEvent);
    const types = ['copy', 'cut', 'paste'];
    types.forEach((type) => window.addEventListener(type, clip));
    return () => types.forEach((type) => window.removeEventListener(type, clip));
  }, []);

  if (!d.nodes.size) {
    return (
      <div class="diagram-wrap">
        <p class="diagram-empty">
          {lang() === 'en' ? (
            <>
              Nothing to draw yet. Each row becomes a box, a row with <code>shape: frame</code> a frame around the rows under it, and a link
              in a field (<code>to: [[API]] gRPC</code>) an arrow.
            </>
          ) : (
            <>
              まだ描くものがありません。行が箱に、<code>shape: frame</code> の行がその下の行を囲む枠に、属性に書いたリンク（
              <code>to: [[API]] gRPC</code>）が矢印になります。
            </>
          )}
        </p>
        {editable && <AddBox onAdd={() => addBox(id)} tree={d.kind === 'tree'} />}
      </div>
    );
  }

  const near = (e: { from: string; to: string }) => hover !== null && (e.from === hover || e.to === hover);
  // Routed again only when the boxes or arrows change, not on hovering or selecting.
  const routedFor = JSON.stringify([
    d.direction,
    [...L.boxes].map(([nid, b]) => [nid, b.x, b.y, b.w, b.h, b.frame, b.frame && d.nodes.get(nid)!.desc]),
    d.edges.map((e) => [e.from, e.to, e.label, e.sides]),
  ]);
  if (routed.current?.key !== routedFor) {
    const r = routeAll(d, L, measure);
    routed.current = { key: routedFor, routes: d.edges.map((e) => r.routes.get(e)!), sides: d.edges.map((e) => r.sidesOf.get(e)!) };
  }
  const routes = new Map(d.edges.map((e, i) => [e, routed.current!.routes[i]]));
  const sidesOf = new Map(d.edges.map((e, i) => [e, routed.current!.sides[i]]));
  // The drawing's bounds: the boxes, and lines going around them with their labels.
  let [x0, y0, x1, y1] = [0, 0, L.width, L.height];
  for (const e of d.edges) {
    const r = routes.get(e)!;
    const half = e.label ? edgeLabelWidth(e, measure) / 2 + 4 : 0;
    for (const [x, y] of r.pts) [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
    if (r.pts.length) [x0, x1] = [Math.min(x0, r.mid[0] - half), Math.max(x1, r.mid[0] + half)];
  }
  // The zoomed item's description above it all.
  const about = diagramDesc(d, x1 - x0, measure);
  const aboutTop = y0 - about.length * DESC_LINE - (about.length ? DESC_GAP : 0);
  if (about.length) {
    y0 = aboutTop;
    x1 = Math.max(x1, x0 + Math.max(...about.map((l) => measure(l, DIAGRAM_DESC_SIZE))));
  }
  const W = x1 - x0 + 2 * M;
  const H = y1 - y0 + 2 * M;

  /**
   * The drawing to save: all of it, or (with boxes selected and only them
   * asked for) those boxes, all inside them and the arrows between them,
   * cropped to what they cover.
   */
  const drawing = (): Drawing => {
    const svg = svgRef.current!;
    // At its own size, however large it is shown.
    if (!chosen.length || !onlyChosen) return { svg: standaloneSvg(svg, { view: [x0 - M, y0 - M, W, H] }), width: W, height: H };
    const part = new Set<string>();
    const take = (n: string) => {
      if (part.has(n)) return;
      part.add(n);
      d.nodes.get(n)?.children.forEach(take);
    };
    chosen.forEach(take);
    const keep = (el: Element) => {
      const box = el.closest('[data-box]');
      if (box) return part.has(box.getAttribute('data-box')!);
      const line = el.closest('[data-from]');
      if (line) return part.has(line.getAttribute('data-from')!) && part.has(line.getAttribute('data-to')!);
      return !el.closest('.dg-about');
    };
    // Its bounds, from where its parts are drawn on the page.
    const m = svg.getScreenCTM()!.inverse();
    let [left, top, right, bottom] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const el of svg.querySelectorAll('[data-box], [data-from]')) {
      if (el.closest('.dg-editing') || !keep(el)) continue;
      const at = el.getBoundingClientRect();
      const p = new DOMPoint(at.left, at.top).matrixTransform(m);
      const q = new DOMPoint(at.right, at.bottom).matrixTransform(m);
      [left, top, right, bottom] = [Math.min(left, p.x), Math.min(top, p.y), Math.max(right, q.x), Math.max(bottom, q.y)];
    }
    const view: [number, number, number, number] = [left - M, top - M, right - left + 2 * M, bottom - top + 2 * M];
    return { svg: standaloneSvg(svg, { keep, view }), width: view[2], height: view[3] };
  };

  // ---- editing

  /** A pointer position in the drawing's coordinates. */
  const toDrawing = (ev: { clientX: number; clientY: number }): Pt => {
    const m = svgRef.current!.getScreenCTM()!.inverse();
    const p = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(m);
    return [p.x, p.y];
  };
  /** Follow the pointer on the whole window until it is let go; Escape gives up. */
  const follow = (move: (ev: PointerEvent) => void, up: (ev: PointerEvent) => void, cancel: () => void) => {
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', key, true);
    };
    const onUp = (ev: PointerEvent) => (stop(), up(ev));
    const onCancel = () => (stop(), cancel());
    const key = (ev: KeyboardEvent) => ev.key === 'Escape' && (ev.preventDefault(), ev.stopPropagation(), onCancel());
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', key, true);
  };

  // A press on a box selects it; dragged, it moves the box into a frame or elsewhere in its row, column or grid.
  const pressBox = (e: PointerEvent, nid: string) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const start = toDrawing(e);
    let dragging = false;
    const at = (ev: PointerEvent) => {
      const p = toDrawing(ev);
      return { p, dx: p[0] - start[0], dy: p[1] - start[1] };
    };
    follow(
      (ev) => {
        const { p, dx, dy } = at(ev);
        if (!dragging && Math.hypot(dx, dy) < 5) return;
        if (nid === id) return; // the item a mind map grows from stays put
        dragging = true;
        setMoving({ id: nid, dx, dy, drop: dropAt(d, L, id, nid, p) });
      },
      (ev) => {
        setMoving(null);
        if (!dragging) return e.shiftKey || e.metaKey || e.ctrlKey ? toggle(nid) : select({ box: nid });
        const drop = dropAt(d, L, id, nid, at(ev).p);
        if (drop && moveBox(store, nid, drop)) ctl.commit();
        select({ box: nid });
      },
      () => setMoving(null)
    );
  };

  // From the dot on a box to the box the pointer is let go on, which the first then points to.
  const startLink = (e: PointerEvent, from: string) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const target = (p: Pt) => boxAt(L, p, (n) => canConnect(d, from, n));
    const at = (ev: PointerEvent) => {
      const p = toDrawing(ev);
      return { from, at: p, to: target(p) };
    };
    follow(
      (ev) => setLink(at(ev)),
      (ev) => {
        setLink(null);
        const to = at(ev).to;
        if (!to) return;
        connect(store, from, to);
        ctl.commit();
      },
      () => setLink(null)
    );
    select(null);
    setLink(at(e));
  };

  // From a handle at an end of the selected arrow to the box it should join instead.
  const startBend = (e: PointerEvent, edge: DiagramEdge, end: 'from' | 'to') => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const fixed = routes.get(edge)!.ends[end === 'to' ? 0 : 1];
    const stays = end === 'to' ? edge.from : edge.to;
    const at = (ev: PointerEvent) => {
      const p = toDrawing(ev);
      return { fixed, at: p, to: boxAt(L, p, (n) => n === edge[end] || canConnect(d, stays, n)) };
    };
    follow(
      (ev) => setBend(at(ev)),
      (ev) => {
        setBend(null);
        const { to, at: p } = at(ev);
        // Let go on its own box: the end is pinned to the side nearest.
        if (to === edge[end]) {
          const side = nearestSide(L.boxes.get(to)!, p);
          if (side !== sidesOf.get(edge)![end === 'from' ? 0 : 1] || edge.sides[end]) {
            if (setSide(store, edge, end, side)) ctl.commit();
          }
          return select(null);
        }
        if (!to || !reconnect(store, d, edge, end, to)) return;
        ctl.commit();
        select(null);
      },
      () => setBend(null)
    );
    setBend(at(e));
  };

  const rename = (nid: string, text: string | null) => {
    setRenaming(null);
    if (text === null || !text.trim() || text === store.node(nid).text) return;
    store.setText(nid, text.trim());
    ctl.commit();
  };
  /** Whether an arrow has words to write: not a dependency. */
  const canLabel = (e: DiagramEdge) => lineKindOf(store, e) !== DEP_KEY;
  const label = (e: DiagramEdge, text: string | null) => {
    setLabeling(null);
    if (text === null || text.trim() === labelOf(store, e)) return;
    if (setLabel(store, e, text)) ctl.commit();
    select(null); // its key goes with its label
  };
  /** A new box under parent (before another, or last), named at once. */
  function addBox(parent: string, before: string | null = null) {
    const kids = store.node(parent).children;
    const n = store.addChild(
      parent,
      before ? kids.indexOf(before) : -1,
      d.kind === 'tree' ? t('新しいトピック', 'New topic') : t('新しい箱', 'New box')
    );
    ctl.commit();
    select({ box: n.id });
    setRenaming(n.id);
  }
  /** A row after nid (under the same row), or under it when it is the one the mind map grows from. */
  const addAfter = (nid: string) => {
    if (nid === id) return addBox(id);
    const parent = store.parentOf(nid)!;
    const kids = store.node(parent).children;
    addBox(parent, kids[kids.indexOf(nid) + 1] ?? null);
  };
  /**
   * A mind map's keys, on the selected row: Tab adds a row under it, Enter
   * one after it, F2 or Space renames it, and the arrow keys go along the
   * branches. False for any other key.
   */
  const mindMapKey = (e: KeyboardEvent, nid: string): boolean => {
    if (e.key === 'Tab' && !e.shiftKey) addBox(nid);
    else if (e.key === 'Enter' && !e.shiftKey) addAfter(nid);
    else if (e.key === 'F2' || e.key === ' ') setRenaming(nid);
    else if (e.key.startsWith('Arrow')) {
      const to = neighbour(d, nid, e.key);
      if (to) select({ box: to });
    } else return false;
    return true;
  };
  /** Whether a box can be added inside: a frame, a plain box (which becomes a container), any row of a mind map. */
  const holdsBoxes = (nid: string) => d.kind === 'tree' || d.nodes.get(nid)!.isFrame || d.nodes.get(nid)!.shape === 'box';

  /** Where the dot for drawing an arrow sits on a box: its right side, or its bottom going down. */
  const dotAt = (b: Box): Pt => (d.direction === 'TB' ? [b.x + b.w / 2, b.y + b.h] : [b.x + b.w, b.y + b.h / 2]);
  const dotFor = editable && !link && !bend && !moving && !renaming && !labeling && hover !== null && hover !== id ? hover : null;
  const linkFrom = link && L.boxes.get(link.from);
  const movingBox = moving && L.boxes.get(moving.id);
  const dropHolder = moving?.drop && moving.drop.parent !== id ? L.boxes.get(moving.drop.parent) : undefined;

  const handlers = editable
    ? {
        press: pressBox,
        rename: (nid: string) => (select({ box: nid }), setRenaming(nid)),
        menu: (e: MouseEvent, nid: string) => {
          e.preventDefault();
          if (many && chosen.includes(nid)) return setManyMenu({ x: e.clientX, y: e.clientY });
          select({ box: nid });
          setMenu({ id: nid, x: e.clientX, y: e.clientY });
        },
      }
    : undefined;
  const sb = selectedBox ? L.boxes.get(selectedBox) : undefined;
  /** Where a box's name is typed: over the box (a frame: over its title). */
  const nameAt = (b: Box) => {
    const width = Math.max(b.frame ? 200 : b.w, 140);
    return { x: b.frame ? b.x + 6 : b.x + b.w / 2 - width / 2, y: b.frame ? b.y + 3 : b.y + b.h / 2 - 14, width, height: 28 };
  };
  // Typing on the selection writes its name (an arrow's label) at once: an unseen box waits there for it.
  const idle = editable && !renaming && !labeling && !menu && !edgeMenu && !manyMenu && !moving && !link && !bend;
  const typeAt = !idle
    ? undefined
    : sb && !many
      ? nameAt(sb)
      : selectedEdge && canLabel(selectedEdge)
        ? labelAt(routes.get(selectedEdge)!.mid)
        : undefined;
  /** Put the selected boxes in a new line-up or frame; a frame's name is typed at once. */
  const groupChosen = (shape: (typeof GROUP_CHOICES)[number][0]) => {
    const g = group(
      store,
      chosen.filter((c) => c !== id),
      shape,
      GROUP_NAMES[shape]()
    );
    if (!g) return;
    ctl.commit();
    select({ box: g });
    if (shape === 'frame') setRenaming(g);
  };
  const typed = (text: string) => {
    if (selectedBox) rename(selectedBox, text);
    else if (selectedEdge) label(selectedEdge, text);
    setTypedIn((n) => n + 1);
  };
  const renamed = renaming ? L.boxes.get(renaming) : undefined;

  return (
    <div ref={wrapRef} class={'diagram-wrap' + (sized ? ' embedded' : '')} data-holding={embedded && sel ? '' : undefined}>
      {embedded && edit && (
        <div class="diagram-tools">
          <AddBox onAdd={() => addBox(id)} tree={d.kind === 'tree'} />
          {zoomable && <ZoomTools zoom={zoom} onFit={() => zoom.fit(W, H)} />}
        </div>
      )}
      {!embedded && (
        <div class="diagram-tools">
          <AddBox onAdd={() => addBox(id)} tree={d.kind === 'tree'} />
          {chosen.length > 0 && (
            <label
              class="diagram-part"
              title={t('選んだ箱と、その間の矢印だけを書き出す', 'Save only the boxes selected and the arrows between them')}
            >
              <input type="checkbox" checked={onlyChosen} onChange={(e) => setOnlyChosen(e.currentTarget.checked)} />
              {t('選択した箱だけ', 'Selected boxes only')}
            </label>
          )}
          <ZoomTools zoom={zoom} onFit={() => zoom.fit(W, H)} />
          <ExportTools
            class="diagram-export"
            drawing={drawing}
            name={store.get(id) && id !== store.rootId ? store.node(id).text : 'Home'}
          />
        </div>
      )}
      <div class="diagram-scroll" ref={scrollRef}>
        <svg
          ref={svgRef}
          class={'diagram' + (editable ? ' editable' : '') + (zoom.panning ? ' panning' : '')}
          viewBox={`${x0 - M} ${y0 - M} ${W} ${H}`}
          width={sized ? '100%' : W * zoom.scale}
          height={sized ? '100%' : H * zoom.scale}
          // Embedded, it fills the space it is given, though a small drawing grows no more than so much.
          style={sized ? { maxWidth: `min(100%, ${W * EMBED_GROW}px)`, maxHeight: `min(100%, ${H * EMBED_GROW}px)` } : undefined}
          onMouseLeave={() => setHover(null)}
          onPointerDown={(e) => e.target === e.currentTarget && (sized ? select(null) : zoom.pan(e, () => select(null)))}
        >
          <defs>
            <marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
              <path d="M0,1 L10,5 L0,9 z" fill="context-stroke" />
            </marker>
          </defs>
          {markedLines(d.desc ?? '', about, d.descMarks).map((l, i) => (
            <text key={i} class="dg-about" x={x0} y={aboutTop + (i + 1) * DESC_LINE - 4}>
              <Runs runs={l} />
            </text>
          ))}
          {[...L.boxes].map(([nid, b]) =>
            b.frame ? <Frame key={nid} node={d.nodes.get(nid)!} box={b} on={handlers} onHover={setHover} /> : null
          )}
          {L.branches.map(([a, b]) => (
            <path key={a + '>' + b} class="dg-branch" data-from={a} data-to={b} d={branch(L.boxes.get(a)!, L.boxes.get(b)!, d.direction)} />
          ))}
          {d.edges.map((e) => {
            const r = routes.get(e)!;
            const k = edgeKey(e);
            return (
              <g
                key={k}
                data-from={e.from}
                data-to={e.to}
                class={'dg-edge ' + e.style.dash + (near(e) ? ' near' : '') + (selectedEdge === e ? ' selected' : '')}
                style={e.style.color ? `--edge: ${e.style.color}` : undefined}
              >
                <path
                  d={r.d}
                  marker-end={e.style.ends !== 'none' ? `url(#${marker})` : undefined}
                  marker-start={e.style.ends === 'both' ? `url(#${marker})` : undefined}
                />
                {editable && (
                  <path
                    class="dg-edge-hit"
                    d={r.d}
                    onPointerDown={(ev) => ev.stopPropagation()}
                    onClick={() => select({ edge: k })}
                    onDblClick={() => canLabel(e) && (select({ edge: k }), setLabeling(k))}
                    onContextMenu={(ev) => {
                      ev.preventDefault();
                      select({ edge: k });
                      setEdgeMenu({ x: ev.clientX, y: ev.clientY });
                    }}
                  >
                    <title>
                      {t(
                        'クリックで選択、ダブルクリックでラベル、右クリックで種類、Delete で削除',
                        'Click to select, double-click for its label, right-click for its kind, Delete to remove'
                      )}
                    </title>
                  </path>
                )}
              </g>
            );
          })}
          {[...L.boxes].map(([nid, b]) =>
            b.frame ? null : <Shape key={nid} node={d.nodes.get(nid)!} box={b} on={handlers} onHover={setHover} />
          )}
          {/* Titles and labels over the lines, so a line passing behind one keeps it readable. */}
          {[...L.boxes].map(([nid, b]) => {
            const n = d.nodes.get(nid)!;
            if (!b.frame || n.frame === 'hidden') return null;
            return (
              <g key={nid} data-box={nid} style={inkOf(n)}>
                {n.icon && <Icon value={n.icon} x={b.x + 12} y={b.y + 5} size={15} color={n.color} />}
                <text class={'dg-frame-title' + (n.frame === 'box' ? ' box' : '')} x={b.x + 12 + (n.icon ? ICON_SPACE : 0)} y={b.y + 17}>
                  <Runs runs={markedLines(n.label, [n.label], n.marks?.label)[0]} />
                </text>
                {markedLines(n.desc ?? '', frameDesc(n, b.w, measure), n.marks?.desc).map((l, i) => (
                  <text key={i} class="dg-frame-desc" x={b.x + 12} y={b.y + 17 + (i + 1) * (PROP_SIZE + 3)}>
                    <Runs runs={l} />
                  </text>
                ))}
              </g>
            );
          })}
          {d.edges.map((e) => {
            if (!e.label) return null;
            // Labels of lines between the same two boxes are stacked rather than drawn over each other.
            const mid = routes.get(e)!.mid;
            const nth = d.edges
              .filter((o) => o.label && ((o.from === e.from && o.to === e.to) || (o.from === e.to && o.to === e.from)))
              .indexOf(e);
            return <EdgeLabel key={edgeKey(e)} edge={e} text={e.label} at={[mid[0], mid[1] + nth * 18]} near={near(e)} />;
          })}

          {/* editing: the selection, the dot to draw arrows from, an arrow or a box being dragged; never saved in an image */}
          <g class="dg-editing">
            {!moving &&
              chosen.map((c) => {
                const b = L.boxes.get(c)!;
                return <rect key={c} class="dg-selected" x={b.x - 4} y={b.y - 4} width={b.w + 8} height={b.h + 8} rx={9} />;
              })}
            {selectedEdge && (
              <g
                class="dg-delete"
                transform={`translate(${routes.get(selectedEdge)!.mid[0]},${routes.get(selectedEdge)!.mid[1] - (selectedEdge.label ? 20 : 0)})`}
                onPointerDown={(ev) => ev.stopPropagation()}
                onClick={remove}
              >
                <title>{t('この矢印を削除', 'Remove this arrow')}</title>
                <circle r={8} />
                <text y={4}>×</text>
              </g>
            )}
            {selectedEdge &&
              !bend &&
              (['from', 'to'] as const).map((end) => {
                const [cx, cy] = routes.get(selectedEdge)!.ends[end === 'from' ? 0 : 1];
                return (
                  <circle
                    key={end}
                    class="dg-link-dot dg-end"
                    cx={cx}
                    cy={cy}
                    r={5}
                    onPointerDown={(ev) => startBend(ev, selectedEdge, end)}
                  >
                    <title>{t('ドラッグして、つなぐ箱を変える', 'Drag to join another box')}</title>
                  </circle>
                );
              })}
            {bend && (
              <>
                {bend.to && (
                  <rect
                    class="dg-drop"
                    x={L.boxes.get(bend.to)!.x - 4}
                    y={L.boxes.get(bend.to)!.y - 4}
                    width={L.boxes.get(bend.to)!.w + 8}
                    height={L.boxes.get(bend.to)!.h + 8}
                    rx={9}
                  />
                )}
                <line class="dg-link-line" x1={bend.fixed[0]} y1={bend.fixed[1]} x2={bend.at[0]} y2={bend.at[1]} />
              </>
            )}
            {dotFor && L.boxes.has(dotFor) && (
              <circle
                class="dg-link-dot"
                cx={dotAt(L.boxes.get(dotFor)!)[0]}
                cy={dotAt(L.boxes.get(dotFor)!)[1]}
                r={5}
                onMouseEnter={() => setHover(dotFor)}
                onPointerDown={(e) => startLink(e, dotFor)}
              >
                <title>{t('ドラッグして、矢印を引く先の箱へ', 'Drag to the box the arrow should point to')}</title>
              </circle>
            )}
            {link && linkFrom && (
              <>
                {link.to && (
                  <rect
                    class="dg-drop"
                    x={L.boxes.get(link.to)!.x - 4}
                    y={L.boxes.get(link.to)!.y - 4}
                    width={L.boxes.get(link.to)!.w + 8}
                    height={L.boxes.get(link.to)!.h + 8}
                    rx={9}
                  />
                )}
                <line class="dg-link-line" x1={dotAt(linkFrom)[0]} y1={dotAt(linkFrom)[1]} x2={link.at[0]} y2={link.at[1]} />
              </>
            )}
            {moving && movingBox && (
              <>
                {dropHolder && (
                  <rect
                    class="dg-drop"
                    x={dropHolder.x - 4}
                    y={dropHolder.y - 4}
                    width={dropHolder.w + 8}
                    height={dropHolder.h + 8}
                    rx={10}
                  />
                )}
                <DropMark d={d} L={L} drop={moving.drop} />
                <rect
                  class="dg-ghost"
                  x={movingBox.x + moving.dx}
                  y={movingBox.y + moving.dy}
                  width={movingBox.w}
                  height={movingBox.h}
                  rx={6}
                />
              </>
            )}
            {typeAt && (
              <foreignObject class="dg-type-at" {...typeAt}>
                <TypeIn
                  key={`${selectedBox ?? (sel && 'edge' in sel && sel.edge)}#${typedIn}`}
                  class={selectedBox ? 'dg-rename' : 'dg-rename dg-label-input'}
                  onKey={(e) => onKey.current(e)}
                  onDone={typed}
                />
              </foreignObject>
            )}
            {renaming && renamed && (
              <foreignObject {...nameAt(renamed)}>
                <CellInput key={renaming} class="dg-rename" value={store.node(renaming).text} onDone={(text) => rename(renaming, text)} />
              </foreignObject>
            )}
            {labeling &&
              (() => {
                const e = d.edges.find((x) => edgeKey(x) === labeling);
                if (!e) return null;
                return (
                  // Room around it for the colour bubble of ⌘⇧H.
                  <foreignObject {...labelAt(routes.get(e)!.mid)} x={routes.get(e)!.mid[0] - 110} width={220} height={64}>
                    {/* In an HTML parent, so what it adds as it is typed in (the bubble) is HTML, not SVG. */}
                    <div>
                      <CellInput
                        key={labeling}
                        marked
                        class="dg-rename dg-label-input"
                        placeholder={t('ラベル', 'Label')}
                        value={labelOf(store, e)}
                        onDone={(text) => label(e, text)}
                      />
                    </div>
                  </foreignObject>
                );
              })()}
          </g>
        </svg>
      </div>
      {edgeMenu && selectedEdge && (
        <EdgeMenu
          edge={selectedEdge}
          x={edgeMenu.x}
          y={edgeMenu.y}
          kinds={lineKinds(store, id)}
          onClose={() => setEdgeMenu(null)}
          onRemove={remove}
          onLabel={canLabel(selectedEdge) ? (text) => label(selectedEdge, text) : undefined}
        />
      )}
      {menu && store.get(menu.id) && (
        <BoxMenu
          id={menu.id}
          x={menu.x}
          y={menu.y}
          root={id}
          holds={holdsBoxes(menu.id)}
          onClose={() => setMenu(null)}
          onAddInside={() => {
            if (d.kind === 'flow' && !d.nodes.get(menu.id)!.isFrame) setShape(store, menu.id, CONTAINER);
            addBox(menu.id);
          }}
          onAddAfter={() => addAfter(menu.id)}
          onUngroup={
            d.kind === 'flow' && d.nodes.get(menu.id)?.isFrame && menu.id !== id
              ? () => {
                  ungroup(store, menu.id);
                  ctl.commit();
                  select(null);
                }
              : undefined
          }
        />
      )}
      {manyMenu && many && (
        <PopupMenu x={manyMenu.x} y={manyMenu.y} onClose={() => setManyMenu(null)}>
          {d.kind === 'flow' &&
            GROUP_CHOICES.map(([shape, label]) => (
              <button key={shape} role="menuitem" onClick={() => (setManyMenu(null), groupChosen(shape))}>
                {label()}
              </button>
            ))}
          {d.kind === 'flow' && <hr />}
          <button role="menuitem" class="danger" onClick={() => (setManyMenu(null), remove())}>
            {t(`${chosen.filter((c) => c !== id).length} 個を削除`, `Delete ${chosen.filter((c) => c !== id).length}`)}
          </button>
        </PopupMenu>
      )}
      {/* How to work it, folded away until asked for. */}
      {!embedded && (
        <details class="diagram-hint">
          <summary>{t('操作方法', 'How to use it')}</summary>
          <ul>
            {(kind === 'tree'
              ? t(
                  'クリックで選択 ・ Tab で子、Enter で次の行を追加 ・ 矢印キーで移動 ・ ダブルクリックか F2 で名前を変更 ・ ドラッグで別の行の下へ ・ ⌘C / ⌘V でコピー・貼り付け ・ Delete で削除 ・ ⌘ + ホイールで拡大縮小、空いた所をドラッグでスクロール ・ この項目に direction: TB で縦に',
                  'Click to select · Tab adds a row under it, Enter one after it · Arrow keys move · Double-click or F2 renames · Drag under another row · ⌘C / ⌘V copy and paste · Delete removes · ⌘ + wheel zooms, drag the background to scroll · direction: TB on this item to grow down'
                )
              : t(
                  'クリックで選択、Shift+クリックで複数選択して右クリックで並べる ・ 選んで入力で名前を書き換え ・ 右クリックで形や色 ・ ドラッグで移動 ・ 箱の端の丸から矢印 ・ 矢印をダブルクリックでラベル ・ ⌘C / ⌘V でコピー・貼り付け ・ Delete で削除 ・ ⌘ + ホイールで拡大縮小、空いた所をドラッグでスクロール ・ shape: row / column / grid で並べる、この項目に direction: TB',
                  'Click to select, Shift+click more and right-click to line them up · Type to rename · Right-click for shape and colour · Drag to move · Draw arrows from the dot on a box · Double-click an arrow for its label · ⌘C / ⌘V copy and paste · Delete removes · ⌘ + wheel zooms, drag the background to scroll · shape: row / column / grid lines boxes up, direction: TB on this item'
                )
            )
              .split(/ [・·] /)
              .map((tip) => (
                <li key={tip}>{tip}</li>
              ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function AddBox({ onAdd, tree }: { onAdd: () => void; tree?: boolean }) {
  return (
    <button class="mini dg-add" onClick={onAdd}>
      {tree ? t('+ トピックを追加', '+ Add a topic') : t('+ 箱を追加', '+ Add a box')}
    </button>
  );
}

/** Where a dragged box would go in a row, column or grid: a bar before the box it would come before (or after the last). */
function DropMark({ d, L, drop }: { d: Diagram; L: Layout; drop: Drop | null }) {
  if (!drop) return null;
  const n = d.nodes.get(drop.parent);
  const arrange = n ? n.arrange : d.arrange;
  if (!arrange) return null;
  const kids = n ? n.children : d.top;
  const ref = drop.before ?? kids[kids.length - 1];
  const b = ref && L.boxes.get(ref);
  if (!b) return null;
  const after = drop.before === null;
  if (arrange.kind === 'column') {
    const y = after ? b.y + b.h + 20 : b.y - 20;
    return <line class="dg-drop-mark" x1={b.x - 6} x2={b.x + b.w + 6} y1={y} y2={y} />;
  }
  const x = after ? b.x + b.w + 20 : b.x - 20;
  return <line class="dg-drop-mark" x1={x} x2={x} y1={b.y - 6} y2={b.y + b.h + 6} />;
}

/** A box's menu: its name, shape and colour, boxes added beside or in it, and removing it. */
function BoxMenu(props: {
  id: string;
  x: number;
  y: number;
  root: string;
  holds: boolean;
  onClose: () => void;
  onAddInside: () => void;
  onAddAfter: () => void;
  /** Take the boxes out of it, when it is a frame. */
  onUngroup?: () => void;
}) {
  const { id, x, y, root, holds } = props;
  const ctl = useCtl();
  const { store } = ctl;
  // The name and description, typed here and written when the menu closes (unless by Escape).
  const [name, setName] = useState(store.node(id).text);
  const [desc, setDescText] = useState(() => descOf(store, id));
  // ⌘B and the like mark what is selected in them, as in a row.
  const nameField = useRef<HTMLInputElement>(null);
  const descField = useRef<HTMLTextAreaElement>(null);
  const nameMarks = useMarkKeys((ed) => (setName(ed.text), reselect(nameField.current, ed)));
  const descMarks = useMarkKeys((ed) => (setDescText(ed.text), reselect(descField.current, ed)));
  const font = FONT_KEYS.map((k) => store.fieldValue(id, k))
    .find(Boolean)
    ?.toLowerCase();
  /** Which of its looks has its choices open. */
  const [look, setLook] = useState<'shape' | 'fill' | 'text' | 'line' | null>(null);
  const onClose = () => {
    props.onClose();
    let changed = false;
    if (name.trim() && name.trim() !== store.node(id).text) {
      store.setText(id, name.trim());
      changed = true;
    }
    if (desc.trim() !== descOf(store, id).trim()) {
      setDesc(store, id, desc);
      changed = true;
    }
    if (changed) ctl.commit();
  };
  const run = (fn: () => void) => () => {
    onClose();
    fn();
  };
  const shapeWords = (store.fieldValue(id, 'shape') ?? '').toLowerCase().split(/\s+/);
  const shape = shapeWords.includes(CONTAINER)
    ? CONTAINER
    : (shapeWords.map((w) => arrangeOf(w)?.kind).find(Boolean) ??
      (shapeWords.includes('frame') ? 'frame' : SHAPE_CHOICES.some(([s]) => s === shapeWords[0]) ? shapeWords[0] : 'box'));
  const color = store.fieldValue(id, 'color')?.toLowerCase();
  const border = borderOf(BORDER_KEYS.map((k) => store.fieldValue(id, k)).find(Boolean));
  const borderOn = (w: string) => {
    const [part, value] = BORDER_WORDS[w];
    return border?.[part] === value;
  };
  return (
    <PopupMenu x={x} y={y} onClose={onClose} onCancel={props.onClose}>
      <div class="dg-menu-field">
        <input
          ref={nameField}
          class="dg-menu-input"
          aria-label={t('名前', 'Name')}
          value={name}
          onInput={(e) => setName(e.currentTarget.value)}
          onBlur={nameMarks.close}
          onKeyDown={(e) => !nameMarks.onKeyDown(e) && !imeActive(e) && e.key === 'Enter' && (e.preventDefault(), onClose())}
        />
        {nameMarks.bubble}
      </div>
      <div class="dg-menu-field">
        <textarea
          ref={descField}
          class="dg-menu-input"
          rows={2}
          aria-label={t('説明', 'Description')}
          placeholder={t('説明（Shift+Enter で改行）', 'Description (Shift+Enter for a new line)')}
          value={desc}
          onInput={(e) => setDescText(e.currentTarget.value)}
          onBlur={descMarks.close}
          onKeyDown={(e) => !descMarks.onKeyDown(e) && !imeActive(e) && e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), onClose())}
        />
        {descMarks.bubble}
      </div>
      {/* How it looks: a button each showing what it is now, opening its choices below (one at a time). */}
      <div class="dg-looks" role="group" aria-label={t('見た目', 'Look')}>
        {(
          [
            ['shape', t('形', 'Shape'), <span>{SHAPE_CHOICES.find(([s]) => s === shape)?.[1]()}</span>],
            [
              'fill',
              t('塗り', 'Fill'),
              <span class={'dg-look-dot' + (color ? '' : ' none')} style={color && { background: colorValue(color) }} />,
            ],
            ['text', t('文字', 'Text'), <b style={{ color: colorValue(font) }}>A</b>],
            [
              'line',
              t('線', 'Line'),
              <svg width="22" height="14" aria-hidden="true">
                <rect
                  x="2"
                  y="2"
                  width="18"
                  height="10"
                  rx={cornerOf(border, 3, 10)}
                  style={outlined(border, { stroke: 'currentColor', fill: 'none' }, 1.2)}
                />
              </svg>,
            ],
          ] as const
        ).map(([k, label, now]) => (
          <button
            key={k}
            class={'dg-look' + (look === k ? ' on' : '')}
            aria-expanded={look === k}
            onClick={() => setLook(look === k ? null : k)}
          >
            {label} {now}
          </button>
        ))}
      </div>
      {look === 'shape' && (
        <div class="dg-menu-row" role="group" aria-label={t('形', 'Shape')}>
          {SHAPE_CHOICES.map(([s, label]) => (
            <button
              key={s}
              class={'dg-chip' + (shape === s ? ' on' : '')}
              onClick={run(() => {
                setShape(store, id, s);
                ctl.commit();
              })}
            >
              {label()}
            </button>
          ))}
        </div>
      )}
      {look === 'fill' && (
        <Swatches
          label={t('色', 'Colour')}
          value={color}
          none={t('色なし', 'No colour')}
          onPick={(c) => run(() => (setColor(store, id, c), ctl.commit()))()}
        />
      )}
      {/* The colour of all its text (a stretch of it is coloured in the text: `[words]{red}`). Left open after a pick. */}
      {look === 'text' && (
        <Swatches
          label={t('文字', 'Text')}
          letters
          value={font}
          none={t('ふつうの色', 'Usual colour')}
          onPick={(c) => (setFontColor(store, id, c), ctl.commit())}
        />
      )}
      {look === 'line' && (
        <div class="dg-menu-row" role="group" aria-label={t('線', 'Outline')}>
          {BORDER_CHOICES.map(([w, label]) => (
            <button
              key={w}
              class={'dg-chip' + (borderOn(w) ? ' on' : '')}
              onClick={() => {
                toggleBorder(store, id, w);
                ctl.commit();
              }}
            >
              {label()}
            </button>
          ))}
        </div>
      )}
      <hr />
      {holds && (
        <button role="menuitem" onClick={run(props.onAddInside)}>
          {t('中に箱を追加', 'Add a box inside')}
        </button>
      )}
      {id !== root && (
        <button role="menuitem" onClick={run(props.onAddAfter)}>
          {t('後ろに箱を追加', 'Add a box after it')}
        </button>
      )}
      {props.onUngroup && (
        <button role="menuitem" onClick={run(props.onUngroup)}>
          {t('囲みを外す', 'Take the boxes out')}
        </button>
      )}
      <button role="menuitem" onClick={run(() => ctl.openRow(id))}>
        {t('アウトラインで開く', 'Open in the outline')}
      </button>
      {id !== root && (
        <>
          <hr />
          <button role="menuitem" class="danger" onClick={run(() => ctl.deleteItem(id))}>
            {t('削除', 'Delete')}
          </button>
        </>
      )}
    </PopupMenu>
  );
}

/** A menu at a point (in the window), closed by Escape, scrolling or a press elsewhere. */
function PopupMenu({
  x,
  y,
  title,
  onClose,
  onCancel = onClose,
  children,
}: {
  x: number;
  y: number;
  title?: string;
  /** Closed by a press elsewhere or scrolling. */
  onClose: () => void;
  /** Closed by Escape. */
  onCancel?: () => void;
  children: ComponentChildren;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // The latest of them, for the listeners set up once.
  const on = useRef({ onClose, onCancel });
  on.current = { onClose, onCancel };
  useEffect(() => {
    const first = ref.current?.querySelector<HTMLInputElement | HTMLButtonElement>('input, textarea, button');
    first?.focus();
    if (first instanceof HTMLInputElement) first.select();
    const away = (e: Event) => !ref.current?.contains(e.target as Node) && on.current.onClose();
    const key = (e: KeyboardEvent) => e.key === 'Escape' && !imeActive(e) && on.current.onCancel();
    // A long name or description scrolls inside its field: only a scroll outside the menu closes it.
    const scroll = (e: Event) => !ref.current?.contains(e.target as Node) && on.current.onClose();
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('keydown', key);
    window.addEventListener('scroll', scroll, true);
    return () => {
      window.removeEventListener('pointerdown', away, true);
      window.removeEventListener('keydown', key);
      window.removeEventListener('scroll', scroll, true);
    };
  }, []);
  // Kept in the window by its own size, which grows with a long description.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.left = `${Math.max(8, Math.min(x, window.innerWidth - el.offsetWidth - 8))}px`;
    el.style.top = `${Math.max(8, Math.min(y, window.innerHeight - el.offsetHeight - 8))}px`;
  });
  return (
    <div ref={ref} class="item-menu dg-menu" role="menu" onContextMenu={(e) => e.preventDefault()}>
      {title && <div class="item-menu-title">{title}</div>}
      {children}
    </div>
  );
}

/** Names of the kinds of line offered for an arrow; others are shown by their field name. */
const LINE_CHOICES: Record<string, () => string> = {
  to: () => t('矢印', 'Arrow'),
  async: () => t('破線', 'Dashed'),
  both: () => t('両矢印', 'Both ends'),
  link: () => t('線のみ', 'Line only'),
};

/** An arrow's menu: its kind of line (the field it is written in), and removing it. */
function EdgeMenu({
  edge,
  x,
  y,
  kinds,
  onClose,
  onRemove,
  onLabel,
}: {
  edge: DiagramEdge;
  x: number;
  y: number;
  kinds: string[];
  onClose: () => void;
  onRemove: () => void;
  /** Write its label, when it can have one. */
  onLabel?: (text: string) => void;
}) {
  const ctl = useCtl();
  const { store } = ctl;
  const current = lineKindOf(store, edge);
  const dep = current === DEP_KEY;
  // The label, typed here and written when the menu closes (unless by Escape, or to delete the arrow).
  const [text, setText] = useState(() => labelOf(store, edge));
  const field = useRef<HTMLInputElement>(null);
  const marks = useMarkKeys((ed) => (setText(ed.text), reselect(field.current, ed)));
  const close = () => {
    onClose();
    if (onLabel && text.trim() !== labelOf(store, edge)) onLabel(text);
  };
  return (
    <PopupMenu x={x} y={y} title={`${nodeLabel(store, edge.from)} → ${nodeLabel(store, edge.to)}`} onClose={close} onCancel={onClose}>
      {onLabel && (
        <div class="dg-menu-field">
          <input
            ref={field}
            class="dg-menu-input"
            aria-label={t('ラベル', 'Label')}
            placeholder={t('ラベル', 'Label')}
            value={text}
            onInput={(e) => setText(e.currentTarget.value)}
            onBlur={marks.close}
            onKeyDown={(e) => !marks.onKeyDown(e) && !imeActive(e) && e.key === 'Enter' && (e.preventDefault(), close())}
          />
          {marks.bubble}
        </div>
      )}
      {dep ? (
        <div class="dg-menu-note">{t('依存（after）の矢印です。種類は変えられません', 'A dependency (after); its kind stays')}</div>
      ) : (
        <div class="dg-menu-row" role="group" aria-label={t('線の種類', 'Kind of line')}>
          {kinds.map((k) => (
            <button
              key={k}
              class={'dg-chip' + (current === k ? ' on' : '')}
              onClick={() => {
                close();
                if (setLineKind(store, edge, k)) ctl.commit();
              }}
            >
              {LINE_CHOICES[k]?.() ?? k}
            </button>
          ))}
        </div>
      )}
      {!dep && (
        <Swatches
          label={t('色', 'Colour')}
          value={lineColorOf(edge)}
          none={t('種類の色', 'As its kind')}
          onPick={(c) => {
            close();
            if (setLineColor(store, edge, c)) ctl.commit();
          }}
        />
      )}
      {(edge.sides.from || edge.sides.to) && (
        <button
          role="menuitem"
          onClick={() => {
            close();
            const unpinned = setSide(store, edge, 'from', null);
            if (setSide(store, edge, 'to', null) || unpinned) ctl.commit();
          }}
        >
          {t('付く位置を自動に戻す', 'Let its ends face each other again')}
        </button>
      )}
      <hr />
      <button
        role="menuitem"
        class="danger"
        onClick={() => {
          onClose();
          onRemove();
        }}
      >
        {t('削除', 'Delete')}
      </button>
    </PopupMenu>
  );
}

interface Drawn {
  node: DiagramNode;
  box: Box;
  /** What pressing, double-clicking and right-clicking it do, when the diagram can be edited. */
  on?: {
    press: (e: PointerEvent, id: string) => void;
    rename: (id: string) => void;
    menu: (e: MouseEvent, id: string) => void;
  };
  onHover: (id: string | null) => void;
}

const tint = (color: string | undefined, amount = 12) =>
  color ? { stroke: color, fill: `color-mix(in srgb, ${color} ${amount}%, var(--bg))` } : undefined;

type Look = Record<string, string | number>;
const WEIGHTS = { thin: 0.8, thick: 2.4 };
const SHADOW = 'drop-shadow(0 2px 3px rgb(0 0 0 / 0.22))';

/** An outline's look as its border says, over look (its colour's); width is the stroke's as the stylesheet draws it. */
function outlined(border: Border | undefined, look: Look | undefined, width: number): Look | undefined {
  if (!border) return look;
  const w = border.weight ? WEIGHTS[border.weight] : width;
  const k = Math.max(1, w / 1.2);
  return {
    ...look,
    ...(border.color && { stroke: border.color }),
    ...(border.weight && { strokeWidth: w }),
    ...(border.dash === 'solid' && { strokeDasharray: 'none' }),
    ...(border.dash === 'dashed' && { strokeDasharray: `${5 * k} ${4 * k}` }),
    ...(border.dash === 'dotted' && { strokeDasharray: `0 ${3 * k}`, strokeLinecap: 'round' }),
    ...(border.shadow && { filter: SHADOW }),
    ...(border.none && { stroke: 'transparent' }),
  };
}

/** The lines drawn on a shape (a cylinder's rim, a queue's bars): the outline's colour and width. */
const linesOf = (look: Look | undefined) =>
  look && { ...(look.stroke && { stroke: look.stroke }), ...(look.strokeWidth && { strokeWidth: look.strokeWidth }) };

/** A rounded rectangle's corners: rx as drawn, or as the border says. */
const cornerOf = (border: Border | undefined, rx: number, h: number) =>
  border?.corner === 'square' ? 0 : border?.corner === 'round' ? Math.min(h / 2, 18) : rx;

/** The second, inner line of a double border, inset from w×h. */
function Inner({ look, w, h, rx, ellipse }: { look: Look | undefined; w: number; h: number; rx: number; ellipse?: boolean }) {
  const { filter: _, ...line } = look ?? {};
  const style = { ...line, fill: 'none' };
  const d = DOUBLE_GAP;
  return ellipse ? (
    <ellipse class="dg-double" cx={w / 2} cy={h / 2} rx={w / 2 - d} ry={h / 2 - d} style={style} />
  ) : (
    <rect class="dg-double" x={d} y={d} width={w - 2 * d} height={h - 2 * d} rx={Math.max(0, rx - d)} style={style} />
  );
}
const DOUBLE_GAP = 3;

/** A line's runs: a marked one in a tspan styled by its marks (dg-strong, dg-em …). */
const Runs = ({ runs }: { runs: Run[] }) => (
  <>
    {runs.map((r, i) =>
      r.kinds.length || r.color ? (
        <tspan key={i} class={r.kinds.map((k) => 'dg-' + k).join(' ') || undefined} style={r.color && { fill: r.color }}>
          {r.text}
        </tspan>
      ) : (
        r.text
      )
    )}
  </>
);

/** The colours of a box's text by part, for the stylesheet to draw them in (else as usual). */
const inkOf = ({ font }: DiagramNode) =>
  font &&
  (['name', 'desc', 'props'] as const)
    .filter((p) => font[p])
    .map((p) => `--ink-${p}: ${font[p]}`)
    .join('; ');

/** An icon from icons.ts, or an emoji, in a size×size square at x, y. */
function Icon({ value, x, y, size, color }: { value: string; x: number; y: number; size: number; color?: string }) {
  const icon = iconOf(value);
  if (!icon) return null;
  if ('text' in icon) {
    return (
      <text class="dg-icon-text" x={x + size / 2} y={y + size * 0.85} font-size={size}>
        {icon.text}
      </text>
    );
  }
  return (
    <path
      class="dg-icon"
      d={icon.path}
      transform={`translate(${x},${y}) scale(${size / 24})`}
      style={color ? { stroke: color } : undefined}
    />
  );
}

function Frame({ node, box, on, onHover }: Drawn) {
  const seen = node.frame !== 'none' && node.frame !== 'hidden';
  const look = seen ? outlined(node.border, tint(node.color, 6), node.frame === 'box' ? 1.2 : 1) : undefined;
  const rx = cornerOf(node.border, 8, box.h);
  return (
    <g
      class={'dg-frame ' + node.frame + (node.done ? ' done' : '')}
      data-box={node.id}
      transform={`translate(${box.x},${box.y})`}
      onMouseEnter={() => onHover(node.id)}
      onPointerDown={on && ((e) => on.press(e, node.id))}
      onDblClick={on && (() => on.rename(node.id))}
      onContextMenu={on && ((e) => on.menu(e, node.id))}
    >
      <title>{node.desc ? `${node.label}\n${node.desc}` : node.label}</title>
      <rect width={box.w} height={box.h} rx={rx} style={look} />
      {look && node.border?.double && <Inner look={look} w={box.w} h={box.h} rx={rx} />}
    </g>
  );
}

function Shape({ node, box, on, onHover }: Drawn) {
  const { w, h } = box;
  const style = outlined(node.border, tint(node.color), 1.2);
  const lines = linesOf(style);
  const rx = cornerOf(node.border, 6, h);
  const double = node.border?.double;
  const actor = node.shape === 'actor';
  const top = actor ? 36 : PAD + (node.shape === 'db' ? 12 : node.shape === 'process' ? PROCESS_PAD : 0);
  const cx = node.shape === 'queue' ? (w - 16) / 2 : w / 2;
  // The icon goes before the label, the two centred together; an actor's icon replaces the figure.
  const iconBeside = node.icon && !actor;
  const labelX = iconBeside ? cx + ICON_SPACE / 2 : cx;
  const iconX = cx - (measure(node.label, LABEL_SIZE) + ICON_SPACE) / 2;
  const desc = descLines(node, measure);
  /** The description's lines, then the fields', each with its class. */
  const below: [string, Run[]][] = [
    ...markedLines(node.desc ?? '', desc, node.marks?.desc).map((l): [string, Run[]] => ['dg-desc', l]),
    ...node.props.map((p): [string, Run[]] => ['dg-prop', [{ text: p, kinds: [] }]]),
  ];
  let outline;
  switch (node.shape) {
    case 'actor':
      outline = node.icon ? (
        <Icon value={node.icon} x={w / 2 - 14} y={2} size={28} color={node.color} />
      ) : (
        <g class="dg-actor" style={style && { stroke: style.stroke }}>
          <circle cx={w / 2} cy={7} r={6} />
          <path d={`M${w / 2},13 v10 M${w / 2 - 9},17 h18 M${w / 2},23 l-7,9 M${w / 2},23 l7,9`} />
        </g>
      );
      break;
    case 'db': {
      const rx = w / 2;
      outline = (
        <>
          <path d={`M0,6 a${rx},6 0 0,1 ${w},0 V${h - 6} a${rx},6 0 0,1 ${-w},0 Z`} style={style} />
          <path class="dg-line" d={`M0,6 a${rx},6 0 0,0 ${w},0`} style={lines} />
        </>
      );
      break;
    }
    case 'queue':
      outline = (
        <>
          <rect width={w} height={h} rx={rx} style={style} />
          {double && <Inner look={style} w={w} h={h} rx={rx} />}
          <path class="dg-line" d={`M${w - 16},0 V${h} M${w - 10},0 V${h}`} style={lines} />
        </>
      );
      break;
    case 'process':
      outline = (
        <>
          <ellipse cx={w / 2} cy={h / 2} rx={w / 2} ry={h / 2} style={style} />
          {double && <Inner look={style} w={w} h={h} rx={0} ellipse />}
        </>
      );
      break;
    case 'store':
      // Two lines, along the top and bottom (as in Yourdon / DeMarco, beside a process's ellipse).
      outline = (
        <>
          <rect class="dg-store-bg" width={w} height={h} style={style && { fill: style.fill }} />
          <path d={`M0,0 H${w} M0,${h} H${w}`} style={{ ...style, fill: 'none' }} />
        </>
      );
      break;
    case 'sticky': {
      const f = NOTE_FOLD;
      const paper = outlined(node.border, tint(node.color, 25), 1.2);
      outline = (
        <>
          <path class="dg-note" d={`M0,0 H${w - f} L${w},${f} V${h} H0 Z`} style={paper} />
          <path class="dg-line dg-note-fold" d={`M${w - f},0 V${f} H${w}`} style={linesOf(paper)} />
        </>
      );
      break;
    }
    default:
      outline = (
        <>
          <rect class={node.shape === 'external' ? 'dashed' : undefined} width={w} height={h} rx={rx} style={style} />
          {double && <Inner look={style} w={w} h={h} rx={rx} />}
        </>
      );
  }
  if (node.shape === 'sticky') {
    // Written on it from the top left, like a note: its name, then any description and fields.
    const text = markedLines(node.label, noteLines(node, measure), node.marks?.label);
    return (
      <g
        class={'dg-node' + (node.done ? ' done' : '')}
        style={inkOf(node)}
        data-box={node.id}
        transform={`translate(${box.x},${box.y})`}
        onMouseEnter={() => onHover(node.id)}
        onPointerDown={on && ((e) => on.press(e, node.id))}
        onDblClick={on && (() => on.rename(node.id))}
        onContextMenu={on && ((e) => on.menu(e, node.id))}
      >
        <title>{node.desc ? `${node.label}\n${node.desc}` : node.label}</title>
        {outline}
        {text.map((l, i) => (
          <text key={i} class="dg-note-text" x={PAD} y={PAD + NOTE_SIZE + i * NOTE_LINE}>
            <Runs runs={l} />
          </text>
        ))}
        {below.map(([cls, l], i) => (
          <text key={'b' + i} class={cls + ' left'} x={PAD} y={PAD + text.length * NOTE_LINE + (i + 1) * (PROP_SIZE + 3)}>
            <Runs runs={l} />
          </text>
        ))}
      </g>
    );
  }
  return (
    <g
      class={'dg-node' + (node.done ? ' done' : '')}
      style={inkOf(node)}
      data-box={node.id}
      transform={`translate(${box.x},${box.y})`}
      onMouseEnter={() => onHover(node.id)}
      onPointerDown={on && ((e) => on.press(e, node.id))}
      onDblClick={on && (() => on.rename(node.id))}
      onContextMenu={on && ((e) => on.menu(e, node.id))}
    >
      <title>{node.desc ? `${node.label}\n${node.desc}` : node.label}</title>
      {outline}
      {iconBeside && <Icon value={node.icon!} x={iconX} y={top - 1} size={16} color={node.color} />}
      <text class="dg-label" x={labelX} y={top + LABEL_SIZE}>
        <Runs runs={markedLines(node.label, [node.label], node.marks?.label)[0]} />
      </text>
      {below.map(([cls, l], i) => (
        <text key={i} class={cls} x={cx} y={top + LABEL_SIZE + 4 + (i + 1) * (PROP_SIZE + 3)}>
          <Runs runs={l} />
        </text>
      ))}
    </g>
  );
}

function EdgeLabel({ edge, text, at, near }: { edge: DiagramEdge; text: string; at: Pt; near: boolean }) {
  const w = edgeLabelWidth(edge, measure) + 8;
  return (
    <g class={'dg-edge-label' + (near ? ' near' : '')} data-from={edge.from} data-to={edge.to} transform={`translate(${at[0]},${at[1]})`}>
      <rect x={-w / 2} y={-8} width={w} height={16} rx={4} />
      <text y={4}>
        <Runs runs={markedLines(text, [text], edge.labelMarks)[0]} />
      </text>
    </g>
  );
}
