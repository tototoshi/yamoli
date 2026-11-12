/*
 * Gantt chart of the zoomed item's visible rows: names on the left, an SVG
 * timeline on the right sharing the same row height. Read-only for now.
 * The dates above stay in view while the page scrolls (a header of their
 * own, moved along with the timeline's horizontal scroll); rows are striped
 * so a name can be followed to its bar, and dependency lines stay faint
 * except the critical ones and those of the row under the pointer.
 * Zoomed far out (a project of a year or more), the dates above are years
 * and months instead of months and days, and days off are left unshaded.
 * The whole chart, names and all, saves as an SVG or PNG image.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { today, type Day } from './calendar';
import { useCtl } from './context';
import { lang, t } from './i18n';
import { standaloneSvg } from './exportImage';
import { ExportTools, type Drawing } from './ExportTools';
import { dependencyLinks, ganttRange, monthBands, schedTooltip, scheduleIssue } from './gantt';
import { nodeLabel } from './links';
import type { OutlineStore } from './model';
import { calendarAt, type Sched } from './schedule';

const ROW = 28;
const HEAD = 44;
const MONTH_H = 20;
/** Pixels per day, from zoomed out to zoomed in. */
export const GANTT_SCALES = [1, 2, 4, 6, 12, 22, 34];
/** Below this many pixels a day, the header shows years and months. */
const MONTHS_BELOW = 5;

const NS = 'http://www.w3.org/2000/svg';

/**
 * The chart in gantt as one image: its names drawn beside the dates and bars,
 * chartW of the timeline (the schedule, not the days filling the screen beyond
 * it) rather than what is scrolled into view, without the pointer's highlights.
 */
function ganttDrawing(gantt: HTMLElement, names: { label: string; depth: number; cls: string }[], chartW: number): Drawing {
  const head = gantt.querySelector<SVGSVGElement>('.gantt-head svg')!;
  const body = gantt.querySelector<SVGSVGElement>('.gantt-chart svg')!;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'gantt-svg');
  const add = (parent: Element, tag: string, attrs: Record<string, string | number>) => {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    parent.append(el);
    return el;
  };
  // Drawn in the page (out of sight) so the stylesheet applies and text can be measured.
  const holder = document.createElement('div');
  holder.style.cssText = 'position: fixed; left: -100000px; top: 0';
  holder.append(svg);
  document.body.append(holder);
  try {
    const stripes = add(svg, 'g', {});
    const texts = names.map(({ label, depth, cls }, i) => {
      const text = add(svg, 'text', { x: 8 + depth * 16, y: HEAD + i * ROW + ROW / 2 + 4.5, class: 'name' + cls });
      text.textContent = label;
      return text as SVGTextElement;
    });
    const NAMES_MAX = 360;
    const namesW = Math.max(140, Math.min(NAMES_MAX, Math.max(...texts.map((el) => el.x.baseVal[0].value + el.getComputedTextLength())) + 12));
    for (const el of texts) {
      const room = namesW - 8 - el.x.baseVal[0].value;
      while (el.textContent!.length > 1 && el.getComputedTextLength() > room) el.textContent = el.textContent!.slice(0, -2) + '…';
    }
    names.forEach((_, i) => add(stripes, 'rect', { x: 0, y: HEAD + i * ROW, width: namesW, height: ROW, class: 'row' + (i % 2 ? ' odd' : '') }));

    const width = namesW + chartW;
    const height = HEAD + Number(body.getAttribute('height'));
    for (const [part, y] of [[head, 0], [body, HEAD]] as const) {
      const copy = part.cloneNode(true) as SVGSVGElement;
      copy.removeAttribute('style'); // the header's scroll offset
      copy.setAttribute('x', String(namesW));
      copy.setAttribute('y', String(y));
      copy.setAttribute('width', String(chartW));
      copy.querySelectorAll('.row-hover').forEach((el) => el.remove());
      copy.querySelectorAll('.dep').forEach((el) => el.classList.remove('near', 'far'));
      // Marker ids of their own, so the copy's arrows don't point at the page's.
      copy.querySelectorAll('marker').forEach((m) => (m.id = 'x-' + m.id));
      copy.querySelectorAll('[marker-end]').forEach((el) => el.setAttribute('marker-end', el.getAttribute('marker-end')!.replace('#', '#x-')));
      svg.append(copy);
    }
    add(svg, 'line', { x1: namesW, x2: namesW, y1: 0, y2: height, class: 'frame-line' });
    add(svg, 'line', { x1: 0, x2: width, y1: HEAD, y2: HEAD, class: 'frame-line' });
    for (const [k, v] of Object.entries({ viewBox: `0 0 ${width} ${height}`, width, height })) svg.setAttribute(k, String(v));
    return { svg: standaloneSvg(svg), width, height };
  } finally {
    holder.remove();
  }
}

/**
 * The chart for the zoomed item, or (embedded, e.g. in a slide) for rootId
 * with its expanded rows and without the toolbar.
 */
export function GanttView({ rootId, embedded }: { rootId?: string; embedded?: boolean }) {
  const ctl = useCtl();
  const { store, schedule } = ctl;
  const zoomId = rootId ?? ctl.zoomId;
  const [hover, setHover] = useState<string | null>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const ganttRef = useRef<HTMLDivElement>(null);
  const [chartWidth, setChartWidth] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  // The zoomed item itself heads the chart (its span, or its own bar).
  const isRoot = zoomId === store.rootId;
  const below = embedded ? expandedRows(store, zoomId) : ctl.visibleRows();
  const rows = (isRoot ? below : [zoomId, ...below]).filter((id) => !store.isData(id));
  const scale = Math.min(Math.max(ctl.prefs.ganttZoom, 0), GANTT_SCALES.length - 1);
  const dw = GANTT_SCALES[scale];
  const now = today();
  // Fill the available width with days. With nothing dated yet (say the
  // project's start is missing), lay the rows out around today so their
  // problems still show.
  const minDays = Math.max(21, Math.floor(chartWidth / dw));
  const range = ganttRange(rows, schedule, minDays) ?? { from: now - 2, to: now - 3 + minDays };

  // The widest days that still show the whole schedule.
  const span = ganttRange(rows, schedule, 1);
  let fitScale = span ? 0 : scale;
  if (span) while (fitScale + 1 < GANTT_SCALES.length && (span.to - span.from + 1) * GANTT_SCALES[fitScale + 1] <= chartWidth) fitScale++;

  const scrollToToday = () => {
    const el = chartRef.current;
    if (el) el.scrollLeft = (now - range.from) * dw - el.clientWidth / 3;
  };
  useEffect(() => {
    const el = chartRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setChartWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [rows.length > 0]);
  // Start with today in view when the chart spans it.
  useLayoutEffect(() => {
    if (now > range.from && now <= range.to) scrollToToday();
  }, [zoomId, dw]);

  if (!rows.length) {
    return (
      <p class="gantt-empty">
        {lang() === 'en' ? (
          <>
            Nothing is scheduled yet. Give tasks a <code>duration</code> (e.g. 3d) and the project a <code>start</code> (e.g.
            2026-11-10).
          </>
        ) : (
          <>
            日程のある作業がありません。作業に <code>duration</code>（例 3d）を、プロジェクトに <code>start</code>（例
            2026-11-10）を設定すると表示されます。
          </>
        )}
      </p>
    );
  }

  const days = range.to - range.from + 1;
  const width = days * dw;
  const height = rows.length * ROW;
  const x = (d: Day) => (d - range.from) * dw;
  const rowY = (i: number) => i * ROW;
  const index = new Map(rows.map((id, i) => [id, i]));
  const cal = calendarAt(store, zoomId, ctl.jpDays);
  const baseDepth = store.path(zoomId).length + (isRoot ? 1 : 0);

  const dayList = Array.from({ length: days }, (_, i) => range.from + i);
  const compact = dw < MONTHS_BELOW;
  const offDays = compact ? [] : dayList.filter((d) => !cal.isWorkday(d));
  const labelEvery = dw >= 16 ? 1 : 7;
  const months = monthBands(range);
  const todayW = Math.max(dw, 2);

  return (
    <div class={'gantt-wrap' + (embedded ? ' embedded' : '')}>
      {!embedded && (
        <div class="gantt-tools">
          <button class="mini" title={t('縮小', 'Narrower days')} disabled={scale === 0} onClick={() => ctl.setGanttZoom(scale - 1)}>
            −
          </button>
          <button
            class="mini"
            title={t('拡大', 'Wider days')}
            disabled={scale === GANTT_SCALES.length - 1}
            onClick={() => ctl.setGanttZoom(scale + 1)}
          >
            ＋
          </button>
          <button
            class="mini"
            title={t('全体が入る幅にする', 'Fit the whole schedule')}
            disabled={scale === fitScale}
            onClick={() => ctl.setGanttZoom(fitScale)}
          >
            {t('全体', 'Fit')}
          </button>
          <button class="mini" disabled={now < range.from || now > range.to} onClick={scrollToToday}>
            {t('今日', 'Today')}
          </button>
          <span class="gantt-legend">
            <i class="lg task" />
            {t('作業', 'Task')} <i class="lg critical" />
            {t('クリティカルパス', 'Critical path')} <i class="lg late" />
            {t('期限超過', 'Late')} <i class="lg due" />
            {t('期限', 'Due')}
          </span>
          <ExportTools
            class="export-tools"
            name={isRoot ? 'Home' : store.node(zoomId).text}
            drawing={() =>
              ganttDrawing(
                ganttRef.current!,
                rows.map((id) => ({
                  label: nodeLabel(store, id),
                  depth: store.path(id).length - baseDepth,
                  cls: (store.node(id).completed ? ' done' : '') + (schedule.byId.get(id)?.kind === 'summary' ? ' summary' : ''),
                })),
                span ? Math.min(width, x(span.to + 1)) : width
              )
            }
          />
        </div>
      )}
      <div class="gantt" ref={ganttRef} onMouseLeave={() => setHover(null)}>
        <div class="gantt-corner" style={{ height: `${HEAD}px` }} />
        <div class="gantt-head">
          <svg width={width} height={HEAD} class="gantt-svg" style={{ transform: `translateX(${-scrollLeft}px)` }}>
            {offDays.map((d) => (
              <rect key={d} x={x(d)} y={MONTH_H} width={dw} height={HEAD - MONTH_H} class="day-off" />
            ))}
            {now >= range.from && now <= range.to && <rect x={x(now)} y={MONTH_H} width={todayW} height={HEAD - MONTH_H} class="today" />}
            {compact ? (
              <>
                {months.map((m, i) => (
                  <g key={m.start}>
                    {(i === 0 || m.start === Date.UTC(m.year, 0, 1) / 86_400_000) && (
                      <>
                        <line x1={x(m.start)} x2={x(m.start)} y1={0} y2={MONTH_H} class="month-line" />
                        <text x={x(m.start) + 6} y={14} class="month-label">
                          {t(`${m.year}年`, String(m.year))}
                        </text>
                      </>
                    )}
                    <line x1={x(m.start)} x2={x(m.start)} y1={MONTH_H} y2={HEAD} class="month-line" />
                    {(m.end - m.start + 1) * dw >= 24 && (
                      <text x={x(m.start) + 3} y={MONTH_H + 16} class="month-short">
                        {m.short}
                      </text>
                    )}
                  </g>
                ))}
              </>
            ) : (
              <>
                {months.map((m) => (
                  <g key={m.start}>
                    <line x1={x(m.start)} x2={x(m.start)} y1={0} y2={HEAD} class="month-line" />
                    <text x={x(m.start) + 6} y={14} class="month-label">
                      {m.label}
                    </text>
                  </g>
                ))}
                {dayList.map((d) => {
                  const date = new Date(d * 86_400_000);
                  const show = labelEvery === 1 || date.getUTCDay() === 1;
                  if (!show) return null;
                  const label =
                    labelEvery === 1 ? String(date.getUTCDate()) : `${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
                  return (
                    <text
                      key={d}
                      x={labelEvery === 1 ? x(d) + dw / 2 : x(d) + 2}
                      y={MONTH_H + 16}
                      class={'day-label' + (labelEvery === 1 ? ' center' : '') + (d === now ? ' now' : '')}
                    >
                      {label}
                    </text>
                  );
                })}
              </>
            )}
          </svg>
        </div>
        <div class="gantt-names">
          {rows.map((id, i) => {
            const n = store.node(id);
            const depth = store.path(id).length - baseDepth;
            const kids = ctl.shownChildren(id).filter((c) => !store.isData(c));
            const canToggle = id !== zoomId && kids.length > 0 && !ctl.search;
            let cls = 'gantt-name' + (i % 2 ? ' odd' : '');
            if (hover === id) cls += ' hover';
            if (n.completed) cls += ' done';
            if (schedule.byId.get(id)?.kind === 'summary') cls += ' summary';
            return (
              <div
                key={id}
                class={cls}
                onContextMenu={(e) => {
                  e.preventDefault();
                  ctl.openMenu(id, e.clientX, e.clientY);
                }}
                style={{ height: `${ROW}px`, paddingLeft: `${4 + depth * 16}px` }}
                onMouseEnter={() => setHover(id)}
              >
                <button
                  class={'toggle' + (canToggle ? '' : ' empty')}
                  tabIndex={-1}
                  onClick={() => canToggle && store.setCollapsed(id, !n.collapsed) && ctl.commit()}
                >
                  {canToggle ? (ctl.isExpanded(id) ? '▾' : '▸') : ''}
                </button>
                <a href={ctl.hashFor(id, 'gantt')} title={nodeLabel(store, id)}>
                  {nodeLabel(store, id)}
                </a>
              </div>
            );
          })}
        </div>
        <div class="gantt-chart" ref={chartRef} onScroll={(e) => setScrollLeft(e.currentTarget.scrollLeft)}>
          <svg width={width} height={height} class="gantt-svg">
            <defs>
              <marker
                id="gantt-arrow"
                viewBox="0 0 8 8"
                refX="7"
                refY="4"
                markerWidth="7"
                markerHeight="7"
                orient="auto"
              >
                <path d="M0,0 L8,4 L0,8 z" class="arrow-head" />
              </marker>
              <marker
                id="gantt-arrow-crit"
                viewBox="0 0 8 8"
                refX="7"
                refY="4"
                markerWidth="7"
                markerHeight="7"
                orient="auto"
              >
                <path d="M0,0 L8,4 L0,8 z" class="arrow-head critical" />
              </marker>
            </defs>

            {/* background: row stripes (which also catch the pointer), hovered row, days off, today, months */}
            {rows.map((id, i) => (
              <rect key={id} x={0} y={rowY(i)} width={width} height={ROW} class={'row' + (i % 2 ? ' odd' : '')} onMouseEnter={() => setHover(id)} />
            ))}
            {hover !== null && index.has(hover) && (
              <rect x={0} y={rowY(index.get(hover)!)} width={width} height={ROW} class="row-hover" />
            )}
            {offDays.map((d) => (
              <rect key={d} x={x(d)} y={0} width={dw} height={height} class="day-off" />
            ))}
            {now >= range.from && now <= range.to && <rect x={x(now)} y={0} width={todayW} height={height} class="today" />}
            {months.map((m) => (
              <line key={m.start} x1={x(m.start)} x2={x(m.start)} y1={0} y2={height} class="month-line" />
            ))}

            {/* dependency arrows, under the bars */}
            {dependencyLinks(store, rows, schedule)
              .map((l) => ({ ...l, near: hover !== null && (l.from === hover || l.to === hover) }))
              .sort((a, b) => Number(a.near) - Number(b.near)) // the hovered row's on top
              .map((l) => {
              const a = schedule.byId.get(l.from)!;
              const b = schedule.byId.get(l.to)!;
              const x1 = a.kind === 'milestone' ? x(a.start) + 6 : x(a.end + 1);
              const x2 = b.kind === 'milestone' ? x(b.start) - 6 : x(b.start);
              const y1 = rowY(index.get(l.from)!) + ROW / 2;
              const y2 = rowY(index.get(l.to)!) + ROW / 2;
              const d =
                x2 - x1 >= 12
                  ? `M${x1},${y1} H${x1 + 6} V${y2} H${x2}`
                  : `M${x1},${y1} h6 V${y2 + (y2 > y1 ? -ROW / 2 : ROW / 2)} H${x2 - 8} V${y2} H${x2}`;
              return (
                <path
                  key={l.from + '>' + l.to}
                  d={d}
                  class={'dep' + (l.critical ? ' critical' : '') + (l.near ? ' near' : hover !== null ? ' far' : '')}
                  marker-end={`url(#${l.critical ? 'gantt-arrow-crit' : 'gantt-arrow'})`}
                />
              );
            })}

            {/* bars */}
            {rows.map((id, i) => {
              const s = schedule.byId.get(id);
              const y = rowY(i);
              if (!s) {
                // Explain the missing bar, at the visible left edge.
                const issue = scheduleIssue(store, id, schedule, ctl.cycles);
                return issue ? (
                  <text
                    key={id}
                    x={scrollLeft + 6}
                    y={y + ROW / 2 + 4}
                    class={'unscheduled' + (issue.startsWith('⚠') ? ' invalid' : '')}
                  >
                    {issue}
                  </text>
                ) : null;
              }
              return (
                <g key={id} class={store.node(id).completed ? 'done' : ''} onMouseEnter={() => setHover(id)}>
                  <title>{nodeLabel(store, id) + '\n' + schedTooltip(s)}</title>
                  <Bar s={s} x={x} y={y} />
                  {s.due !== undefined && (
                    <line x1={x(s.due + 1)} x2={x(s.due + 1)} y1={y + 3} y2={y + ROW - 3} class="due" />
                  )}
                  {schedule.invalid.has(id) && (
                    <text x={x(s.end + 1) + 10} y={y + ROW / 2 + 4} class="unscheduled invalid">
                      ⚠ {schedule.invalid.get(id)}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
      </div>
    </div>
  );
}

/** Items under id in outline order, skipping collapsed subtrees. */
function expandedRows(store: OutlineStore, id: string): string[] {
  return store.items(id).flatMap((c) => [c, ...(store.node(c).collapsed ? [] : expandedRows(store, c))]);
}

function Bar({ s, x, y }: { s: Sched; x: (d: Day) => number; y: number }) {
  const mid = y + ROW / 2;
  if (s.kind === 'milestone') {
    const cx = x(s.start);
    return (
      <path
        d={`M${cx},${mid - 7} L${cx + 7},${mid} L${cx},${mid + 7} L${cx - 7},${mid} z`}
        class={'milestone' + (s.critical ? ' critical' : '')}
      />
    );
  }
  const x0 = x(s.start);
  const x1 = x(s.end + 1);
  if (s.kind === 'summary') {
    const top = mid - 5;
    return (
      <path
        d={`M${x0},${top} H${x1} V${top + 10} L${x1 - 5},${top + 5} H${x0 + 5} L${x0},${top + 10} z`}
        class="summary"
      />
    );
  }
  const lateFrom = s.due !== undefined && s.end > s.due ? x(s.due + 1) : null;
  return (
    <>
      <rect
        x={x0 + 0.5}
        y={mid - 7}
        width={Math.max(x1 - x0 - 1, 2)}
        height={14}
        rx={3}
        class={'bar' + (s.critical ? ' critical' : '')}
      />
      {lateFrom !== null && (
        <rect x={lateFrom} y={mid - 7} width={x1 - lateFrom - 0.5} height={14} rx={3} class="bar late" />
      )}
    </>
  );
}
