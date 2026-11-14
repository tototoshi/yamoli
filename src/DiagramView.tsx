/*
 * The zoomed item drawn as a diagram (see diagram.ts for how rows, fields and
 * links become boxes, frames and arrows), and edited there: boxes renamed,
 * given a shape and colour, added, moved into frames or along a row, column
 * or grid, and arrows drawn and removed (diagramEdit.ts writes the outline).
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useId, useRef, useState } from 'preact/hooks';
import { CellInput } from './CellInput';
import { useCtl } from './context';
import {
  buildDiagram,
  descLines,
  estimate,
  frameDesc,
  frameHead,
  ICON_SPACE,
  layout,
  LABEL_SIZE,
  PAD,
  PROP_SIZE,
  colorValue,
  CONTAINER,
  type Box,
  type Diagram,
  type DiagramEdge,
  type DiagramNode,
  type Direction,
  type Layout,
  type Measure,
  type Shape as ShapeKind,
} from './diagram';
import {
  boxAt,
  canConnect,
  connect,
  descOf,
  disconnect,
  dropAt,
  lineKindOf,
  lineKinds,
  moveBox,
  reconnect,
  setColor,
  setDesc,
  setLineKind,
  setShape,
  type Drop,
} from './diagramEdit';
import { DEP_KEY } from './deps';
import { standaloneSvg } from './exportImage';
import { ExportTools } from './ExportTools';
import { iconOf } from './icons';
import { lang, t } from './i18n';
import { nodeLabel } from './links';

const M = 16; // margin around the drawing

let ctx: CanvasRenderingContext2D | null | undefined;
let family = '';
/** Text width as the browser will draw it. */
const measure: Measure = (text, size) => {
  if (ctx === undefined) {
    ctx = document.createElement('canvas').getContext('2d');
    family = getComputedStyle(document.body).fontFamily;
  }
  if (!ctx) return estimate(text, size);
  ctx.font = `${size === LABEL_SIZE ? 600 : 400} ${size}px ${family}`;
  return ctx.measureText(text).width;
};

type Pt = [number, number];

/**
 * An arrow from box a to box b: out of the side facing b, in through the side
 * facing a, along the diagram's direction when the boxes are apart that way.
 * A curve that would cross another box goes around it instead, in a lane
 * above or below (left or right of) the boxes in the way.
 */
function route(a: Box, b: Box, dir: Direction, others: Box[], labelWidth = 0): { d: string; mid: Pt; pts: Pt[]; ends: [Pt, Pt] } {
  const apartX = b.x >= a.x + a.w ? 1 : b.x + b.w <= a.x ? -1 : 0;
  const apartY = b.y >= a.y + a.h ? 1 : b.y + b.h <= a.y ? -1 : 0;
  const horizontal = !!apartX && (dir === 'LR' || !apartY);
  // Work along x; a vertical arrow is the same with x and y swapped.
  const sw = (p: Pt): Pt => (horizontal ? p : [p[1], p[0]]);
  const swb = (r: Box): Box => (horizontal ? r : { x: r.y, y: r.x, w: r.h, h: r.w, frame: r.frame });
  const [A, B] = [swb(a), swb(b)];
  const ahead = horizontal ? apartX > 0 : apartY ? apartY > 0 : b.y + b.h / 2 >= a.y + a.h / 2;
  const s = ahead ? 1 : -1;
  const p0: Pt = [ahead ? A.x + A.w : A.x, A.y + A.h / 2];
  const p3: Pt = [ahead ? B.x : B.x + B.w, B.y + B.h / 2];
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
  if (!inWay.length) return { d: `M${sw(p0)} C${sw(c1)} ${sw(c2)} ${sw(p3)}`, mid: sw(at(0.5)), pts: [], ends: [sw(p0), sw(p3)] };

  // A lane clear of every box between the ends, nearest to the straight line.
  const [lo, hi] = [Math.min(p0[0], p3[0]) + 16, Math.max(p0[0], p3[0]) - 16];
  const between = boxes.filter((r) => r.x < hi && r.x + r.w > lo);
  const clear = (y: number) => between.every((r) => y <= r.y - 8 || y >= r.y + r.h + 8);
  const wanted = (p0[1] + p3[1]) / 2;
  // Far enough out for the label too, which sits across a lane that runs down the page.
  const gap = horizontal ? 14 : Math.max(14, labelWidth / 2 + 6);
  const lanes = [...between.map((r) => r.y - gap), ...between.map((r) => r.y + r.h + gap)].filter(clear);
  const lane = lanes.sort((m, n) => Math.abs(m - wanted) - Math.abs(n - wanted))[0] ?? wanted;
  const x1 = p0[0] + s * 16;
  const x2 = p3[0] - s * 16;
  const pts: Pt[] = [p0, [x1, p0[1]], [x1, lane], [x2, lane], [x2, p3[1]], p3];
  return { d: rounded(pts.map(sw)), mid: sw([(x1 + x2) / 2, lane]), pts: pts.map(sw), ends: [sw(p0), sw(p3)] };
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

/** How much larger than its own size an embedded diagram may be drawn. */
const EMBED_GROW = 2;

/** Shapes and colours offered in a box's menu. */
const SHAPE_CHOICES: [ShapeKind | 'frame' | typeof CONTAINER, () => string][] = [
  ['box', () => t('箱', 'Box')],
  ['actor', () => t('人', 'Actor')],
  ['db', () => t('DB', 'Database')],
  ['queue', () => t('キュー', 'Queue')],
  ['external', () => t('外部', 'External')],
  ['frame', () => t('枠', 'Frame')],
  [CONTAINER, () => t('入れ物', 'Container')],
];
const COLOR_CHOICES = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray'];

const edgeKey = (e: DiagramEdge) => `${e.from}>${e.to}>${e.label}>${e.style.dash}${e.style.ends}`;

/**
 * The diagram for the zoomed item, or (embedded, e.g. in a slide) for rootId,
 * without the hints and not editable.
 */
export function DiagramView({ rootId, embedded }: { rootId?: string; embedded?: boolean }) {
  const ctl = useCtl();
  const { store } = ctl;
  const id = rootId ?? ctl.zoomId;
  const marker = 'dg-arrow' + useId().replace(/\W/g, '');
  const [hover, setHover] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  /** The box or arrow clicked, which Delete removes (and Enter renames, for a box). */
  const [sel, setSel] = useState<{ box: string } | { edge: string } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  /** The box whose description is being written. */
  const [describing, setDescribing] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  /** The arrow right-clicked, and where. */
  const [edgeMenu, setEdgeMenu] = useState<{ x: number; y: number } | null>(null);
  /** An arrow being drawn from a box: where the pointer is, and the box under it. */
  const [link, setLink] = useState<{ from: string; at: Pt; to: string | null } | null>(null);
  /** An end of the selected arrow being dragged to another box: from the end that stays, where the pointer is, and the box under it. */
  const [bend, setBend] = useState<{ fixed: Pt; at: Pt; to: string | null } | null>(null);
  /** A box being dragged: how far, and where it would go. */
  const [moving, setMoving] = useState<{ id: string; dx: number; dy: number; drop: Drop | null } | null>(null);
  const showCompleted = ctl.prefs.showCompleted;
  // Built anew on each render: the store changes in place, and laying out a page of boxes is quick.
  const d = buildDiagram(store, id, { showCompleted });
  const L = layout(d, measure);
  const editable = !embedded;

  const selectedEdge = sel && 'edge' in sel ? d.edges.find((e) => edgeKey(e) === sel.edge) : undefined;
  const selectedBox = sel && 'box' in sel && L.boxes.has(sel.box) ? sel.box : null;
  const remove = () => {
    if (selectedEdge) {
      disconnect(store, selectedEdge);
      ctl.commit();
    } else if (selectedBox && selectedBox !== ctl.zoomId) ctl.deleteItem(selectedBox);
    setSel(null);
  };
  useEffect(() => {
    if (!sel || renaming || describing || menu || edgeMenu) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as Element).closest('input, textarea, [contenteditable]')) return;
      if (e.key === 'Escape') setSel(null);
      else if (e.key === 'Delete' || e.key === 'Backspace') remove();
      else if (e.key === 'Enter' && selectedBox) setRenaming(selectedBox);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!d.nodes.size) {
    return (
      <div class="diagram-wrap">
        <p class="diagram-empty">
          {lang() === 'en' ? (
            <>
              Nothing to draw yet. Each row becomes a box, rows under a row a frame around them, and a link in a field (
              <code>to: [[API]] gRPC</code>) an arrow.
            </>
          ) : (
            <>
              まだ描くものがありません。行が箱に、子を持つ行がそれを囲む枠に、属性に書いたリンク（
              <code>to: [[API]] gRPC</code>）が矢印になります。
            </>
          )}
        </p>
        {editable && <AddBox onAdd={() => addBox(id)} />}
      </div>
    );
  }

  const near = (e: { from: string; to: string }) => hover !== null && (e.from === hover || e.to === hover);
  // A frame's description is in the way of lines too (its title alone has room above the contents),
  // except of lines to that frame.
  const heads = new Map<string, Box>();
  for (const [nid, b] of L.boxes) {
    const n = d.nodes.get(nid)!;
    if (b.frame && n.desc) heads.set(nid, { x: b.x, y: b.y + 4, w: b.w, h: frameHead(n, b.w, measure) - 4, frame: false });
  }
  const all = [...L.boxes.values()];
  const routes = new Map(
    d.edges.map((e) => {
      const others = [...all, ...[...heads].filter(([nid]) => nid !== e.from && nid !== e.to).map(([, h]) => h)];
      return [e, route(L.boxes.get(e.from)!, L.boxes.get(e.to)!, d.direction, others, e.label ? measure(e.label, PROP_SIZE) + 8 : 0)];
    })
  );
  // The drawing's bounds: the boxes, and lines going around them with their labels.
  let [x0, y0, x1, y1] = [0, 0, L.width, L.height];
  for (const e of d.edges) {
    const r = routes.get(e)!;
    const half = e.label ? measure(e.label, PROP_SIZE) / 2 + 4 : 0;
    for (const [x, y] of r.pts) [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
    if (r.pts.length) [x0, x1] = [Math.min(x0, r.mid[0] - half), Math.max(x1, r.mid[0] + half)];
  }
  const W = x1 - x0 + 2 * M;
  const H = y1 - y0 + 2 * M;

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
        if (!dragging) return setSel({ box: nid });
        const drop = dropAt(d, L, id, nid, at(ev).p);
        if (drop && moveBox(store, nid, drop)) ctl.commit();
        setSel({ box: nid });
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
    setSel(null);
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
        const to = at(ev).to;
        if (!to || !reconnect(store, d, edge, end, to)) return;
        ctl.commit();
        setSel(null);
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
  const describe = (nid: string, text: string | null) => {
    setDescribing(null);
    if (text === null || text.trim() === descOf(store, nid).trim()) return;
    setDesc(store, nid, text);
    ctl.commit();
  };
  /** A new box under parent (before another, or last), named at once. */
  function addBox(parent: string, before: string | null = null) {
    const kids = store.node(parent).children;
    const n = store.addChild(parent, before ? kids.indexOf(before) : -1, t('新しい箱', 'New box'));
    ctl.commit();
    setSel({ box: n.id });
    setRenaming(n.id);
  }
  /** Whether a box can be added inside: a frame, a plain box (which becomes a container), any row of a mind map. */
  const holdsBoxes = (nid: string) => d.kind === 'tree' || d.nodes.get(nid)!.isFrame || d.nodes.get(nid)!.shape === 'box';

  /** Where the dot for drawing an arrow sits on a box: its right side, or its bottom going down. */
  const dotAt = (b: Box): Pt => (d.direction === 'TB' ? [b.x + b.w / 2, b.y + b.h] : [b.x + b.w, b.y + b.h / 2]);
  const dotFor = editable && !link && !bend && !moving && !renaming && !describing && hover !== null && hover !== id ? hover : null;
  const linkFrom = link && L.boxes.get(link.from);
  const movingBox = moving && L.boxes.get(moving.id);
  const dropHolder = moving?.drop && moving.drop.parent !== id ? L.boxes.get(moving.drop.parent) : undefined;

  const handlers = editable
    ? {
        press: pressBox,
        rename: (nid: string) => (setSel({ box: nid }), setRenaming(nid)),
        menu: (e: MouseEvent, nid: string) => {
          e.preventDefault();
          setSel({ box: nid });
          setMenu({ id: nid, x: e.clientX, y: e.clientY });
        },
      }
    : undefined;
  const sb = selectedBox ? L.boxes.get(selectedBox) : undefined;
  const renamed = renaming ? L.boxes.get(renaming) : undefined;
  const described = describing ? L.boxes.get(describing) : undefined;

  return (
    <div class={'diagram-wrap' + (embedded ? ' embedded' : '')}>
      {!embedded && (
        <div class="diagram-tools">
          <AddBox onAdd={() => addBox(id)} />
          <ExportTools
            class="diagram-export"
            drawing={() => ({ svg: standaloneSvg(svgRef.current!), width: W, height: H })}
            name={store.get(id) && id !== store.rootId ? store.node(id).text : 'Home'}
          />
        </div>
      )}
      <svg
        ref={svgRef}
        class={'diagram' + (editable ? ' editable' : '')}
        viewBox={`${x0 - M} ${y0 - M} ${W} ${H}`}
        width={embedded ? '100%' : W}
        height={embedded ? '100%' : H}
        // Embedded, it fills the space it is given, though a small drawing grows no more than so much.
        style={embedded ? { maxWidth: `${W * EMBED_GROW}px`, maxHeight: `${H * EMBED_GROW}px` } : undefined}
        onMouseLeave={() => setHover(null)}
        onPointerDown={(e) => e.target === e.currentTarget && setSel(null)}
      >
        <defs>
          <marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
            <path d="M0,1 L10,5 L0,9 z" fill="context-stroke" />
          </marker>
        </defs>
        {[...L.boxes].map(([nid, b]) =>
          b.frame ? <Frame key={nid} node={d.nodes.get(nid)!} box={b} on={handlers} onHover={setHover} /> : null
        )}
        {L.branches.map(([a, b]) => (
          <path key={a + '>' + b} class="dg-branch" d={branch(L.boxes.get(a)!, L.boxes.get(b)!, d.direction)} />
        ))}
        {d.edges.map((e) => {
          const r = routes.get(e)!;
          const k = edgeKey(e);
          return (
            <g
              key={k}
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
                  onClick={() => setSel({ edge: k })}
                  onContextMenu={(ev) => {
                    ev.preventDefault();
                    setSel({ edge: k });
                    setEdgeMenu({ x: ev.clientX, y: ev.clientY });
                  }}
                >
                  <title>
                    {t('クリックで選択、右クリックで種類、Delete で削除', 'Click to select, right-click for its kind, Delete to remove')}
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
          if (!b.frame) return null;
          const n = d.nodes.get(nid)!;
          return (
            <g key={nid}>
              {n.icon && <Icon value={n.icon} x={b.x + 12} y={b.y + 5} size={15} color={n.color} />}
              <text class={'dg-frame-title' + (n.frame === 'box' ? ' box' : '')} x={b.x + 12 + (n.icon ? ICON_SPACE : 0)} y={b.y + 17}>
                {n.label}
              </text>
              {frameDesc(n, b.w, measure).map((l, i) => (
                <text key={i} class="dg-frame-desc" x={b.x + 12} y={b.y + 17 + (i + 1) * (PROP_SIZE + 3)}>
                  {l}
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
          return <EdgeLabel key={edgeKey(e)} text={e.label} at={[mid[0], mid[1] + nth * 18]} near={near(e)} />;
        })}

        {/* editing: the selection, the dot to draw arrows from, an arrow or a box being dragged */}
        {sb && !moving && <rect class="dg-selected" x={sb.x - 4} y={sb.y - 4} width={sb.w + 8} height={sb.h + 8} rx={9} />}
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
              <circle key={end} class="dg-link-dot dg-end" cx={cx} cy={cy} r={5} onPointerDown={(ev) => startBend(ev, selectedEdge, end)}>
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
              <rect class="dg-drop" x={dropHolder.x - 4} y={dropHolder.y - 4} width={dropHolder.w + 8} height={dropHolder.h + 8} rx={10} />
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
        {renaming && renamed && (
          <foreignObject
            x={renamed.frame ? renamed.x + 6 : renamed.x + renamed.w / 2 - Math.max(renamed.w, 140) / 2}
            y={renamed.frame ? renamed.y + 3 : renamed.y + renamed.h / 2 - 14}
            width={Math.max(renamed.frame ? 200 : renamed.w, 140)}
            height={28}
          >
            <CellInput key={renaming} class="dg-rename" value={store.node(renaming).text} onDone={(text) => rename(renaming, text)} />
          </foreignObject>
        )}
        {/* Under a box's name: in a frame, below its title; else over the box from its name down. */}
        {describing && described && (
          <foreignObject
            x={described.frame ? described.x + 6 : described.x + described.w / 2 - Math.max(described.w, 240) / 2}
            y={described.frame ? described.y + 24 : described.y + described.h / 2 - 8}
            width={Math.max(described.frame ? 280 : described.w, 240)}
            height={84}
          >
            <CellInput
              key={describing}
              class="dg-rename dg-describe"
              lines
              placeholder={t('説明（Shift+Enter で改行）', 'Description (Shift+Enter for a new line)')}
              value={descOf(store, describing)}
              onDone={(text) => describe(describing, text)}
            />
          </foreignObject>
        )}
      </svg>
      {edgeMenu && selectedEdge && (
        <EdgeMenu
          edge={selectedEdge}
          x={edgeMenu.x}
          y={edgeMenu.y}
          kinds={lineKinds(store, id)}
          onClose={() => setEdgeMenu(null)}
          onRemove={remove}
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
          onRename={() => setRenaming(menu.id)}
          onDescribe={() => setDescribing(menu.id)}
          onAddInside={() => {
            if (d.kind === 'flow' && !d.nodes.get(menu.id)!.isFrame) setShape(store, menu.id, CONTAINER);
            addBox(menu.id);
          }}
          onAddAfter={() => {
            const parent = store.parentOf(menu.id)!;
            const kids = store.node(parent).children;
            addBox(parent, kids[kids.indexOf(menu.id) + 1] ?? null);
          }}
        />
      )}
      {!embedded && (
        <p class="diagram-hint">
          {t(
            'クリックで選択 ・ ダブルクリックか Enter で名前を変更 ・ 右クリックで形や色 ・ ドラッグで移動 ・ 箱の端の丸から矢印 ・ Delete で削除 ・ 枠に layout: row / column / grid、この項目に direction: TB',
            'Click to select · Double-click or Enter to rename · Right-click for shape and colour · Drag to move · Draw arrows from the dot on a box · Delete removes · layout: row / column / grid on a frame, direction: TB on this item'
          )}
        </p>
      )}
    </div>
  );
}

function AddBox({ onAdd }: { onAdd: () => void }) {
  return (
    <button class="mini dg-add" onClick={onAdd}>
      {t('+ 箱を追加', '+ Add a box')}
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
  onRename: () => void;
  onDescribe: () => void;
  onAddInside: () => void;
  onAddAfter: () => void;
}) {
  const { id, x, y, root, holds, onClose } = props;
  const ctl = useCtl();
  const { store } = ctl;
  const run = (fn: () => void) => () => {
    onClose();
    fn();
  };
  const shapeWords = (store.fieldValue(id, 'shape') ?? '').toLowerCase().split(/\s+/);
  const shape = shapeWords.includes(CONTAINER)
    ? CONTAINER
    : shapeWords.includes('frame')
      ? 'frame'
      : SHAPE_CHOICES.some(([s]) => s === shapeWords[0])
        ? shapeWords[0]
        : 'box';
  const color = store.fieldValue(id, 'color')?.toLowerCase();
  return (
    <PopupMenu x={x} y={y} title={nodeLabel(store, id)} onClose={onClose}>
      <button role="menuitem" onClick={run(props.onRename)}>
        {t('名前を変更', 'Rename')}
      </button>
      <button role="menuitem" onClick={run(props.onDescribe)}>
        {t('説明を編集', 'Edit the description')}
      </button>
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
      <div class="dg-menu-row" role="group" aria-label={t('色', 'Colour')}>
        <button
          class={'dg-swatch none' + (!color ? ' on' : '')}
          title={t('色なし', 'No colour')}
          onClick={run(() => {
            setColor(store, id, null);
            ctl.commit();
          })}
        />
        {COLOR_CHOICES.map((c) => (
          <button
            key={c}
            class={'dg-swatch' + (color === c ? ' on' : '')}
            title={c}
            style={{ background: colorValue(c) }}
            onClick={run(() => {
              setColor(store, id, c);
              ctl.commit();
            })}
          />
        ))}
      </div>
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
  children,
}: {
  x: number;
  y: number;
  title: string;
  onClose: () => void;
  children: ComponentChildren;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector('button')?.focus();
    const away = (e: Event) => !ref.current?.contains(e.target as Node) && onClose();
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('keydown', key);
    window.addEventListener('scroll', onClose, true);
    return () => {
      window.removeEventListener('pointerdown', away, true);
      window.removeEventListener('keydown', key);
      window.removeEventListener('scroll', onClose, true);
    };
  }, []);
  return (
    <div
      ref={ref}
      class="item-menu dg-menu"
      role="menu"
      style={{ left: `${Math.min(x, window.innerWidth - 260)}px`, top: `${Math.min(y, window.innerHeight - 380)}px` }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div class="item-menu-title">{title}</div>
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
}: {
  edge: DiagramEdge;
  x: number;
  y: number;
  kinds: string[];
  onClose: () => void;
  onRemove: () => void;
}) {
  const ctl = useCtl();
  const { store } = ctl;
  const current = lineKindOf(store, edge);
  const dep = current === DEP_KEY;
  return (
    <PopupMenu x={x} y={y} title={`${nodeLabel(store, edge.from)} → ${nodeLabel(store, edge.to)}`} onClose={onClose}>
      {dep ? (
        <div class="dg-menu-note">{t('依存（after）の矢印です。種類は変えられません', 'A dependency (after); its kind stays')}</div>
      ) : (
        <div class="dg-menu-row" role="group" aria-label={t('線の種類', 'Kind of line')}>
          {kinds.map((k) => (
            <button
              key={k}
              class={'dg-chip' + (current === k ? ' on' : '')}
              onClick={() => {
                onClose();
                if (setLineKind(store, edge, k)) ctl.commit();
              }}
            >
              {LINE_CHOICES[k]?.() ?? k}
            </button>
          ))}
        </div>
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
  return (
    <g
      class={'dg-frame ' + node.frame + (node.done ? ' done' : '')}
      transform={`translate(${box.x},${box.y})`}
      onMouseEnter={() => onHover(node.id)}
      onPointerDown={on && ((e) => on.press(e, node.id))}
      onDblClick={on && (() => on.rename(node.id))}
      onContextMenu={on && ((e) => on.menu(e, node.id))}
    >
      <title>{node.desc ? `${node.label}\n${node.desc}` : node.label}</title>
      <rect width={box.w} height={box.h} rx={8} style={node.frame === 'none' ? undefined : tint(node.color, 6)} />
    </g>
  );
}

function Shape({ node, box, on, onHover }: Drawn) {
  const { w, h } = box;
  const style = tint(node.color);
  const actor = node.shape === 'actor';
  const top = actor ? 36 : PAD + (node.shape === 'db' ? 12 : 0);
  const cx = node.shape === 'queue' ? (w - 16) / 2 : w / 2;
  // The icon goes before the label, the two centred together; an actor's icon replaces the figure.
  const iconBeside = node.icon && !actor;
  const labelX = iconBeside ? cx + ICON_SPACE / 2 : cx;
  const iconX = cx - (measure(node.label, LABEL_SIZE) + ICON_SPACE) / 2;
  const desc = descLines(node, measure);
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
          <path class="dg-line" d={`M0,6 a${rx},6 0 0,0 ${w},0`} style={style && { stroke: style.stroke }} />
        </>
      );
      break;
    }
    case 'queue':
      outline = (
        <>
          <rect width={w} height={h} rx={6} style={style} />
          <path class="dg-line" d={`M${w - 16},0 V${h} M${w - 10},0 V${h}`} style={style && { stroke: style.stroke }} />
        </>
      );
      break;
    default:
      outline = <rect class={node.shape === 'external' ? 'dashed' : undefined} width={w} height={h} rx={6} style={style} />;
  }
  return (
    <g
      class={'dg-node' + (node.done ? ' done' : '')}
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
        {node.label}
      </text>
      {[...desc.map((d) => ['dg-desc', d]), ...node.props.map((p) => ['dg-prop', p])].map(([cls, text], i) => (
        <text key={i} class={cls} x={cx} y={top + LABEL_SIZE + 4 + (i + 1) * (PROP_SIZE + 3)}>
          {text}
        </text>
      ))}
    </g>
  );
}

function EdgeLabel({ text, at, near }: { text: string; at: Pt; near: boolean }) {
  const w = measure(text, PROP_SIZE) + 8;
  return (
    <g class={'dg-edge-label' + (near ? ' near' : '')} transform={`translate(${at[0]},${at[1]})`}>
      <rect x={-w / 2} y={-8} width={w} height={16} rx={4} />
      <text y={4}>{text}</text>
    </g>
  );
}
