/*
 * Gantt chart of the zoomed item's visible rows: names on the left, an SVG
 * timeline on the right sharing the same row height. Read-only for now.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { today, type Day } from './calendar';
import { useCtl } from './context';
import { dependencyLinks, ganttRange, monthBands, schedTooltip, scheduleIssue } from './gantt';
import { nodeLabel } from './links';
import { calendarAt, type Sched } from './schedule';

const ROW = 28;
const HEAD = 44;
const MONTH_H = 20;
/** Pixels per day, from zoomed out to zoomed in. */
export const GANTT_SCALES = [6, 12, 22, 34];

export function GanttView() {
  const ctl = useCtl();
  const { store, schedule, zoomId } = ctl;
  const [hover, setHover] = useState<string | null>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const [chartWidth, setChartWidth] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  // The zoomed item itself heads the chart (its span, or its own bar).
  const isRoot = zoomId === store.rootId;
  const rows = (isRoot ? ctl.visibleRows() : [zoomId, ...ctl.visibleRows()]).filter((id) => !store.isData(id));
  const scale = Math.min(Math.max(ctl.prefs.ganttScale, 0), GANTT_SCALES.length - 1);
  const dw = GANTT_SCALES[scale];
  const now = today();
  // Fill the available width with days. With nothing dated yet (say the
  // project's start is missing), lay the rows out around today so their
  // problems still show.
  const minDays = Math.max(21, Math.floor(chartWidth / dw));
  const range = ganttRange(rows, schedule, minDays) ?? { from: now - 2, to: now - 3 + minDays };

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
        日程のある作業がありません。作業に <code>duration</code>（例 3d）を、プロジェクトに <code>start</code>（例
        2026-11-10）を設定すると表示されます。
      </p>
    );
  }

  const days = range.to - range.from + 1;
  const width = days * dw;
  const height = HEAD + rows.length * ROW;
  const x = (d: Day) => (d - range.from) * dw;
  const rowY = (i: number) => HEAD + i * ROW;
  const index = new Map(rows.map((id, i) => [id, i]));
  const cal = calendarAt(store, zoomId, ctl.jpDays);
  const baseDepth = store.path(zoomId).length + (isRoot ? 1 : 0);

  const dayList = Array.from({ length: days }, (_, i) => range.from + i);
  const offDays = dayList.filter((d) => !cal.isWorkday(d));
  const labelEvery = dw >= 16 ? 1 : 7;

  return (
    <div class="gantt-wrap">
      <div class="gantt-tools">
        <button class="mini" title="縮小" disabled={scale === 0} onClick={() => ctl.setGanttScale(scale - 1)}>
          −
        </button>
        <button
          class="mini"
          title="拡大"
          disabled={scale === GANTT_SCALES.length - 1}
          onClick={() => ctl.setGanttScale(scale + 1)}
        >
          ＋
        </button>
        <button class="mini" disabled={now < range.from || now > range.to} onClick={scrollToToday}>
          今日
        </button>
        <span class="gantt-legend">
          <i class="lg task" />
          作業 <i class="lg critical" />
          クリティカルパス <i class="lg late" />
          期限超過 <i class="lg due" />
          期限
        </span>
      </div>
      <div class="gantt" onMouseLeave={() => setHover(null)}>
        <div class="gantt-names" style={{ paddingTop: `${HEAD}px` }}>
          {rows.map((id) => {
            const n = store.node(id);
            const depth = store.path(id).length - baseDepth;
            const kids = ctl.shownChildren(id).filter((c) => !store.isData(c));
            const canToggle = id !== zoomId && kids.length > 0 && !ctl.search;
            let cls = 'gantt-name';
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
                  {nodeLabel(store, id) || '無題'}
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

            {/* background: hovered row, days off, today */}
            {hover !== null && index.has(hover) && (
              <rect x={0} y={rowY(index.get(hover)!)} width={width} height={ROW} class="row-hover" />
            )}
            {offDays.map((d) => (
              <rect key={d} x={x(d)} y={MONTH_H} width={dw} height={height - MONTH_H} class="day-off" />
            ))}
            {now >= range.from && now <= range.to && (
              <rect x={x(now)} y={MONTH_H} width={dw} height={height - MONTH_H} class="today" />
            )}

            {/* header: months, then days */}
            {monthBands(range).map((m) => (
              <g key={m.start}>
                <line x1={x(m.start)} x2={x(m.start)} y1={0} y2={height} class="month-line" />
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
            <line x1={0} x2={width} y1={HEAD - 0.5} y2={HEAD - 0.5} class="head-line" />

            {/* dependency arrows, under the bars */}
            {dependencyLinks(store, rows, schedule).map((l) => {
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
                  class={'dep' + (l.critical ? ' critical' : '')}
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
