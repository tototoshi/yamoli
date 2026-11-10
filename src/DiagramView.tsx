/*
 * The zoomed item drawn as a diagram (see diagram.ts for how rows, fields and
 * links become boxes, frames and arrows). Clicking a box edits its row in the
 * outline.
 */
import { useId, useRef, useState } from 'preact/hooks';
import { useCtl } from './context';
import { buildDiagram, estimate, ICON_SPACE, layout, LABEL_SIZE, PAD, PROP_SIZE, type Box, type DiagramNode, type Direction, type Measure } from './diagram';
import { fileName, saveFile, standaloneSvg, svgToPng } from './exportImage';
import { iconOf } from './icons';
import { lang, t } from './i18n';

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
function route(a: Box, b: Box, dir: Direction, others: Box[], labelWidth = 0): { d: string; mid: Pt; pts: Pt[] } {
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
  if (!inWay.length) return { d: `M${sw(p0)} C${sw(c1)} ${sw(c2)} ${sw(p3)}`, mid: sw(at(0.5)), pts: [] };

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
  return { d: rounded(pts.map(sw)), mid: sw([(x1 + x2) / 2, lane]), pts: pts.map(sw) };
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

/**
 * The diagram for the zoomed item, or (embedded, e.g. in a slide) for rootId,
 * without the hints and not clickable.
 */
export function DiagramView({ rootId, embedded }: { rootId?: string; embedded?: boolean }) {
  const ctl = useCtl();
  const { store } = ctl;
  const id = rootId ?? ctl.zoomId;
  const marker = 'dg-arrow' + useId().replace(/\W/g, '');
  const [hover, setHover] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const showCompleted = ctl.prefs.showCompleted;
  // Built anew on each render: the store changes in place, and laying out a page of boxes is quick.
  const d = buildDiagram(store, id, { showCompleted });
  const L = layout(d, measure);

  if (!d.nodes.size) {
    return (
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
    );
  }

  const near = (e: { from: string; to: string }) => hover !== null && (e.from === hover || e.to === hover);
  const open = (nid: string) => !embedded && ctl.openRow(nid);
  const all = [...L.boxes.values()];
  const routes = new Map(d.edges.map((e) => [e, route(L.boxes.get(e.from)!, L.boxes.get(e.to)!, d.direction, all, e.label ? measure(e.label, PROP_SIZE) + 8 : 0)]));
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

  return (
    <div class={'diagram-wrap' + (embedded ? ' embedded' : '')}>
      {!embedded && <ExportTools svg={svgRef} name={store.get(id) && id !== store.rootId ? store.node(id).text : 'Home'} size={[W, H]} />}
      <svg ref={svgRef} class="diagram" viewBox={`${x0 - M} ${y0 - M} ${W} ${H}`} width={W} height={H} onMouseLeave={() => setHover(null)}>
        <defs>
          <marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
            <path d="M0,1 L10,5 L0,9 z" fill="context-stroke" />
          </marker>
        </defs>
        {[...L.boxes].map(([nid, b]) =>
          b.frame ? <Frame key={nid} node={d.nodes.get(nid)!} box={b} onOpen={open} onHover={setHover} /> : null
        )}
        {L.branches.map(([a, b]) => (
          <path key={a + '>' + b} class="dg-branch" d={branch(L.boxes.get(a)!, L.boxes.get(b)!, d.direction)} />
        ))}
        {d.edges.map((e) => {
          const r = routes.get(e)!;
          return (
            <g
              key={e.from + '>' + e.to + '>' + e.label}
              class={'dg-edge ' + e.style.dash + (near(e) ? ' near' : '')}
              style={e.style.color ? `--edge: ${e.style.color}` : undefined}
            >
              <path
                d={r.d}
                marker-end={e.style.ends !== 'none' ? `url(#${marker})` : undefined}
                marker-start={e.style.ends === 'both' ? `url(#${marker})` : undefined}
              />
            </g>
          );
        })}
        {[...L.boxes].map(([nid, b]) =>
          b.frame ? null : <Shape key={nid} node={d.nodes.get(nid)!} box={b} onOpen={open} onHover={setHover} />
        )}
        {/* Titles and labels over the lines, so a line passing behind one keeps it readable. */}
        {[...L.boxes].map(([nid, b]) => {
          if (!b.frame) return null;
          const n = d.nodes.get(nid)!;
          return (
            <g key={nid}>
              {n.icon && <Icon value={n.icon} x={b.x + 12} y={b.y + 5} size={15} color={n.color} />}
              <text class="dg-frame-title" x={b.x + 12 + (n.icon ? ICON_SPACE : 0)} y={b.y + 17}>
                {n.label}
              </text>
            </g>
          );
        })}
        {d.edges.map((e) =>
          e.label ? (
            <EdgeLabel
              key={e.from + '>' + e.to + '>' + e.label}
              text={e.label}
              at={routes.get(e)!.mid}
              near={near(e)}
            />
          ) : null
        )}
      </svg>
      {!embedded && (
        <p class="diagram-hint">
          {t(
            '箱をクリックで編集 ・ この項目に direction: TB で縦向き、diagram: tree / flow で描き方を指定',
            'Click a box to edit it · On this item, direction: TB draws top to bottom, diagram: tree / flow picks the layout'
          )}
        </p>
      )}
    </div>
  );
}

/** Save the drawing as SVG or PNG, or copy it as an image. */
function ExportTools({ svg, name, size: [w, h] }: { svg: { current: SVGSVGElement | null }; name: string; size: [number, number] }) {
  const ctl = useCtl();
  const source = () => standaloneSvg(svg.current!);
  const fail = () => ctl.showToast(t('画像を作れませんでした', 'Couldn’t make the image'));
  const copy = () => {
    try {
      // The PNG goes in as a promise so the copy stays within the click (Safari asks for that).
      const png = svgToPng(source(), w, h);
      navigator.clipboard
        .write([new ClipboardItem({ 'image/png': png })])
        .then(() => ctl.showToast(t('図を画像としてコピーしました', 'Copied the diagram as an image')), fail);
    } catch {
      fail();
    }
  };
  return (
    <div class="diagram-tools">
      <button class="mini" title={t('SVG ファイルとして保存', 'Save as an SVG file')} onClick={() => saveFile(fileName(name, 'svg'), new Blob([source()], { type: 'image/svg+xml' }))}>
        SVG
      </button>
      <button
        class="mini"
        title={t('PNG 画像として保存（2 倍の解像度）', 'Save as a PNG image (at twice the size)')}
        onClick={() => svgToPng(source(), w, h).then((b) => saveFile(fileName(name, 'png'), b), fail)}
      >
        PNG
      </button>
      <button class="mini" title={t('PNG 画像をクリップボードへ（資料に貼り付け）', 'PNG image to the clipboard, to paste into documents')} onClick={copy}>
        {t('画像をコピー', 'Copy image')}
      </button>
    </div>
  );
}

interface Drawn {
  node: DiagramNode;
  box: Box;
  onOpen: (id: string) => void;
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

function Frame({ node, box, onOpen, onHover }: Drawn) {
  return (
    <g
      class={'dg-frame ' + node.frame + (node.done ? ' done' : '')}
      transform={`translate(${box.x},${box.y})`}
      onMouseEnter={() => onHover(node.id)}
      onClick={(e) => {
        e.stopPropagation();
        onOpen(node.id);
      }}
    >
      <rect width={box.w} height={box.h} rx={8} style={node.frame === 'none' ? undefined : tint(node.color, 6)} />
    </g>
  );
}

function Shape({ node, box, onOpen, onHover }: Drawn) {
  const { w, h } = box;
  const style = tint(node.color);
  const actor = node.shape === 'actor';
  const top = actor ? 36 : PAD + (node.shape === 'db' ? 12 : 0);
  const cx = node.shape === 'queue' ? (w - 16) / 2 : w / 2;
  // The icon goes before the label, the two centred together; an actor's icon replaces the figure.
  const iconBeside = node.icon && !actor;
  const labelX = iconBeside ? cx + ICON_SPACE / 2 : cx;
  const iconX = cx - (measure(node.label, LABEL_SIZE) + ICON_SPACE) / 2;
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
      onClick={() => onOpen(node.id)}
    >
      <title>{node.label}</title>
      {outline}
      {iconBeside && <Icon value={node.icon!} x={iconX} y={top - 1} size={16} color={node.color} />}
      <text class="dg-label" x={labelX} y={top + LABEL_SIZE}>
        {node.label}
      </text>
      {node.props.map((p, i) => (
        <text key={i} class="dg-prop" x={cx} y={top + LABEL_SIZE + 4 + (i + 1) * (PROP_SIZE + 3)}>
          {p}
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
