/*
 * Gantt chart of the zoomed item's visible rows: names on the left, an SVG
 * timeline on the right sharing the same row height. Bars can be moved and
 * their ends dragged, and names and dates typed in (written back as fields:
 * ganttEdit.ts); a chart embedded in a slide is only shown.
 * The dates above stay in view while the page scrolls (a header of their
 * own, moved along with the timeline's horizontal scroll); rows are striped
 * so a name can be followed to its bar, and dependency lines stay faint
 * except the critical ones and those of the row under the pointer.
 * Zoomed far out (a project of a year or more), the dates above are years
 * and months instead of months and days, and days off are left unshaded.
 * Beside the names, columns give each row's start, end and working days.
 * The whole chart, names and all, saves as an SVG or PNG image.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { formatDate, parseDateInput, shortDate, today, type Day } from './calendar';
import { useCtl } from './context';
import { lang, t } from './i18n';
import { standaloneSvg } from './exportImage';
import { ExportTools, type Drawing } from './ExportTools';
import { moveTo, resizeTo, setDays } from './ganttEdit';
import { imeActive } from './RowEditor';
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
/** The date columns' widths: start, end, working days. */
const DATE_COLS = [76, 76, 48];

/** A row's start, end and working days as shown in the date columns. */
export function dateCells(s: Sched | undefined, workdays: number, now: Day): [string, string, string] {
  if (!s) return ['', '', ''];
  if (s.kind === 'milestone') return [shortDate(s.start, now), '', '◆'];
  return [shortDate(s.start, now), shortDate(s.end, now), t(`${workdays}日`, `${workdays}d`)];
}

interface ExportRow {
  label: string;
  depth: number;
  cls: string;
  dates?: [string, string, string];
  /** Finishes past its due date (its end shown in red). */
  late?: boolean;
}

const NS = 'http://www.w3.org/2000/svg';
/** The legend's strip under a saved image. */
const LEGEND_H = 32;

/**
 * The chart in gantt as one image: its names drawn beside the dates and bars,
 * chartW of the timeline (the schedule, not the days filling the screen beyond
 * it) rather than what is scrolled into view, without the pointer's highlights,
 * and the legend under it.
 */
function ganttDrawing(gantt: HTMLElement, names: ExportRow[], chartW: number): Drawing {
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
    const namesW = Math.max(
      140,
      Math.min(NAMES_MAX, Math.max(...texts.map((el) => el.x.baseVal[0].value + el.getComputedTextLength())) + 12)
    );
    for (const el of texts) {
      const room = namesW - 8 - el.x.baseVal[0].value;
      while (el.textContent!.length > 1 && el.getComputedTextLength() > room) el.textContent = el.textContent!.slice(0, -2) + '…';
    }
    // The date columns, right-aligned in each.
    const datesW = names.some((n) => n.dates) ? DATE_COLS.reduce((a, b) => a + b, 0) : 0;
    if (datesW) {
      const right = DATE_COLS.map((_, c) => namesW + DATE_COLS.slice(0, c + 1).reduce((a, b) => a + b, 0) - 8);
      [t('開始', 'Start'), t('終了', 'End'), t('日数', 'Days')].forEach((label, c) => {
        add(svg, 'text', { x: right[c], y: HEAD - 10, class: 'date-head' }).textContent = label;
      });
      names.forEach(({ dates, cls, late }, i) =>
        dates?.forEach((v, c) => {
          const at = { x: right[c], y: HEAD + i * ROW + ROW / 2 + 4, class: 'date-cell' + cls + (late && c === 1 ? ' late' : '') };
          add(svg, 'text', at).textContent = v;
        })
      );
    }
    const left = namesW + datesW;
    names.forEach((_, i) =>
      add(stripes, 'rect', { x: 0, y: HEAD + i * ROW, width: left, height: ROW, class: 'row' + (i % 2 ? ' odd' : '') })
    );

    const width = left + chartW;
    const height = HEAD + Number(body.getAttribute('height'));
    for (const [part, y] of [
      [head, 0],
      [body, HEAD],
    ] as const) {
      const copy = part.cloneNode(true) as SVGSVGElement;
      copy.removeAttribute('style'); // the header's scroll offset
      copy.setAttribute('x', String(left));
      copy.setAttribute('y', String(y));
      copy.setAttribute('width', String(chartW));
      copy.querySelectorAll('.row-hover').forEach((el) => el.remove());
      copy.querySelectorAll('.dep').forEach((el) => el.classList.remove('near', 'far'));
      // Marker ids of their own, so the copy's arrows don't point at the page's.
      copy.querySelectorAll('marker').forEach((m) => (m.id = 'x-' + m.id));
      copy
        .querySelectorAll('[marker-end]')
        .forEach((el) => el.setAttribute('marker-end', el.getAttribute('marker-end')!.replace('#', '#x-')));
      svg.append(copy);
    }
    for (const lx of datesW ? [namesW, left] : [left]) add(svg, 'line', { x1: lx, x2: lx, y1: 0, y2: height, class: 'frame-line' });
    add(svg, 'line', { x1: 0, x2: width, y1: HEAD, y2: HEAD, class: 'frame-line' });
    // The legend, under the chart.
    add(svg, 'line', { x1: 0, x2: width, y1: height, y2: height, class: 'frame-line' });
    let lx = 8;
    const ly = height + LEGEND_H / 2;
    for (const [mark, label] of [
      ['bar', t('作業', 'Task')],
      ['bar critical', t('クリティカルパス', 'Critical path')],
      ['bar late', t('期限超過', 'Late')],
      ['due', t('期限', 'Due')],
    ]) {
      if (mark === 'due') add(svg, 'line', { x1: lx + 6, x2: lx + 6, y1: ly - 6, y2: ly + 6, class: mark });
      else add(svg, 'rect', { x: lx, y: ly - 4, width: 14, height: 8, rx: 2, class: mark });
      const text = add(svg, 'text', { x: lx + 20, y: ly + 4, class: 'legend' }) as SVGTextElement;
      text.textContent = label;
      lx += 20 + text.getComputedTextLength() + 16;
    }
    const [fullW, fullH] = [Math.max(width, lx), height + LEGEND_H];
    for (const [k, v] of Object.entries({ viewBox: `0 0 ${fullW} ${fullH}`, width: fullW, height: fullH })) svg.setAttribute(k, String(v));
    return { svg: standaloneSvg(svg), width: fullW, height: fullH };
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
  /** A bar being dragged: moved whole or by its end, by delta days so far. */
  const [drag, setDrag] = useState<{ id: string; mode: 'move' | 'end'; from: number; delta: number } | null>(null);
  /** A name (column -1) or date (0 start, 1 end, 2 days) being typed in. */
  const [editing, setEditing] = useState<{ id: string; col: number } | null>(null);
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
            Nothing is scheduled yet. Give tasks a <code>duration</code> (e.g. 3d) and the project a <code>start</code> (e.g. 2026-11-10).
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
  const showDates = !embedded && ctl.prefs.ganttDates;
  const dates = (id: string) => {
    const s = schedule.byId.get(id);
    const work = s && s.kind !== 'milestone' ? calendarAt(store, id, ctl.jpDays).workdaysBetween(s.start, s.end) : 0;
    return dateCells(s, work, now);
  };
  const dateRows = new Map(showDates ? rows.map((id) => [id, dates(id)]) : []);

  // ---- editing (not in a chart embedded in a slide)

  const canEdit = (id: string, col: number) => {
    const s = schedule.byId.get(id);
    return !embedded && (col < 0 || (s?.kind !== 'summary' && !(s?.kind === 'milestone' && col === 1)));
  };
  /** What a name or date cell holds when typed in. */
  const editText = (id: string, col: number) => {
    const s = schedule.byId.get(id);
    if (col < 0) return store.node(id).text;
    if (!s) return '';
    if (col === 2) return s.kind === 'task' ? String(calendarAt(store, id, ctl.jpDays).workdaysBetween(s.start, s.end)) : '0';
    return shortDate(col === 0 ? s.start : s.end, now);
  };
  const finishEdit = (id: string, col: number, text: string | null) => {
    setEditing(null);
    if (text === null || text === editText(id, col)) return;
    const s = schedule.byId.get(id);
    const cal = calendarAt(store, id, ctl.jpDays);
    if (col < 0) {
      store.setText(id, text);
    } else if (col === 2) {
      const n = Number(text.trim().replace(/\s*(d|日)$/i, ''));
      if (!text.trim() || !Number.isInteger(n) || n < 0)
        return ctl.showToast(t(`日数として読めません: ${text}`, `Not a number of days: ${text}`));
      setDays(store, id, s, n, cal);
    } else {
      if (!text.trim()) return;
      const d = parseDateInput(text, now);
      if (d === null) return ctl.showToast(t(`日付として読めません: ${text}`, `Not a date: ${text}`));
      if (col === 0) {
        if (s) moveTo(store, id, s, d);
        else store.setField(id, 'start', formatDate(d));
      } else if (!s) {
        store.setField(id, 'end', formatDate(d));
      } else {
        if (d < s.start) return ctl.showToast(t('開始より前には終われません', "It can't end before it starts"));
        resizeTo(store, id, s, d, cal);
      }
    }
    ctl.commit();
  };
  const cellInput = (id: string, col: number) => (
    <CellInput key={col} value={editText(id, col)} onDone={(text) => finishEdit(id, col, text)} />
  );

  // The pointer is followed on the whole window until it is let go (Escape puts the bar back).
  const startDrag = (e: PointerEvent, id: string, s: Sched) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const mode = (e.target as Element).classList.contains('bar-handle') ? 'end' : 'move';
    const from = e.clientX;
    const delta = (ev: PointerEvent) => Math.round((ev.clientX - from) / dw);
    const move = (ev: PointerEvent) => setDrag({ id, mode, from, delta: delta(ev) });
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', stop);
      window.removeEventListener('keydown', key, true);
      setDrag(null);
    };
    const up = (ev: PointerEvent) => {
      stop();
      const d = delta(ev);
      if (d === 0) return;
      if (mode === 'move') moveTo(store, id, s, s.start + d);
      else resizeTo(store, id, s, Math.max(s.start, s.end + d), calendarAt(store, id, ctl.jpDays));
      ctl.commit();
    };
    const key = (ev: KeyboardEvent) => ev.key === 'Escape' && (ev.preventDefault(), ev.stopPropagation(), stop());
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', stop);
    window.addEventListener('keydown', key, true);
    setDrag({ id, mode, from, delta: 0 });
  };
  /** Where a bar being dragged would go. */
  const dragged = (s: Sched, d: NonNullable<typeof drag>): Sched =>
    d.mode === 'move' ? { ...s, start: s.start + d.delta, end: s.end + d.delta } : { ...s, end: Math.max(s.start, s.end + d.delta) };

  const rowCls = (id: string) => (store.node(id).completed ? ' done' : '') + (schedule.byId.get(id)?.kind === 'summary' ? ' summary' : '');

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
          <button
            class={'mini' + (showDates ? ' on' : '')}
            aria-pressed={showDates}
            title={t('開始・終了・日数（稼働日）の列', 'Start, end and working-days columns')}
            onClick={() => ctl.setGanttDates(!showDates)}
          >
            {t('日付', 'Dates')}
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
                  cls: rowCls(id),
                  dates: dateRows.get(id),
                  late: (schedule.byId.get(id)?.late ?? 0) > 0,
                })),
                span ? Math.min(width, x(span.to + 1)) : width
              )
            }
          />
        </div>
      )}
      <div
        class={'gantt' + (showDates ? ' with-dates' : '')}
        ref={ganttRef}
        style={
          showDates ? { gridTemplateColumns: `minmax(140px, 260px) ${DATE_COLS.map((w) => w + 'px').join(' ')} minmax(0, 1fr)` } : undefined
        }
        onMouseLeave={() => setHover(null)}
      >
        <div class="gantt-corner" style={{ height: `${HEAD}px` }} />
        {showDates &&
          [t('開始', 'Start'), t('終了', 'End'), t('日数', 'Days')].map((label, c) => (
            <div key={c} class={'gantt-corner date-head' + (c === 2 ? ' last' : '')} style={{ height: `${HEAD}px` }}>
              {label}
            </div>
          ))}
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
                  const label = labelEvery === 1 ? String(date.getUTCDate()) : `${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
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
                {embedded ? (
                  <a href={ctl.hashFor(id, 'gantt')} title={nodeLabel(store, id)}>
                    {nodeLabel(store, id)}
                  </a>
                ) : editing?.id === id && editing.col < 0 ? (
                  cellInput(id, -1)
                ) : (
                  <>
                    <span class="gantt-label" title={t('クリックで編集', 'Click to edit')} onClick={() => setEditing({ id, col: -1 })}>
                      {nodeLabel(store, id)}
                    </span>
                    <a href={ctl.hashFor(id, 'gantt')} class="gantt-zoom" title={t('ズームイン', 'Zoom in')}>
                      ›
                    </a>
                  </>
                )}
              </div>
            );
          })}
        </div>
        {showDates &&
          [0, 1, 2].map((c) => (
            <div key={c} class={'gantt-dates' + (c === 2 ? ' last' : '')}>
              {rows.map((id, i) => {
                const s = schedule.byId.get(id);
                const late = c === 1 && !!s && s.late > 0;
                const edit = canEdit(id, c);
                return (
                  <div
                    key={id}
                    class={
                      'gantt-date' +
                      (i % 2 ? ' odd' : '') +
                      (hover === id ? ' hover' : '') +
                      rowCls(id) +
                      (late ? ' late' : '') +
                      (edit ? ' editable' : '')
                    }
                    style={{ height: `${ROW}px` }}
                    onMouseEnter={() => setHover(id)}
                    onClick={() => edit && setEditing({ id, col: c })}
                  >
                    {editing?.id === id && editing.col === c ? cellInput(id, c) : dateRows.get(id)![c]}
                  </div>
                );
              })}
            </div>
          ))}
        <div class="gantt-chart" ref={chartRef} onScroll={(e) => setScrollLeft(e.currentTarget.scrollLeft)}>
          <svg width={width} height={height} class="gantt-svg">
            <defs>
              <marker id="gantt-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M0,0 L8,4 L0,8 z" class="arrow-head" />
              </marker>
              <marker id="gantt-arrow-crit" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M0,0 L8,4 L0,8 z" class="arrow-head critical" />
              </marker>
            </defs>

            {/* background: row stripes (which also catch the pointer), hovered row, days off, today, months */}
            {rows.map((id, i) => (
              <rect
                key={id}
                x={0}
                y={rowY(i)}
                width={width}
                height={ROW}
                class={'row' + (i % 2 ? ' odd' : '')}
                onMouseEnter={() => setHover(id)}
              />
            ))}
            {hover !== null && index.has(hover) && <rect x={0} y={rowY(index.get(hover)!)} width={width} height={ROW} class="row-hover" />}
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
                  <text key={id} x={scrollLeft + 6} y={y + ROW / 2 + 4} class={'unscheduled' + (issue.startsWith('⚠') ? ' invalid' : '')}>
                    {issue}
                  </text>
                ) : null;
              }
              const movable = !embedded && s.kind !== 'summary';
              const d = drag?.id === id ? drag : null;
              const shown = d ? dragged(s, d) : s;
              return (
                <g
                  key={id}
                  class={(store.node(id).completed ? 'done' : '') + (movable ? ' movable' : '') + (d ? ' dragging' : '')}
                  onMouseEnter={() => setHover(id)}
                  onPointerDown={movable ? (e) => startDrag(e, id, s) : undefined}
                >
                  {!d && <title>{nodeLabel(store, id) + '\n' + schedTooltip(s)}</title>}
                  <Bar s={shown} x={x} y={y} />
                  {movable && s.kind === 'task' && (
                    <rect x={x(shown.end + 1) - 8} y={y + ROW / 2 - 7} width={12} height={14} class="bar-handle" />
                  )}
                  {d && d.delta !== 0 && (
                    <text x={x(shown.end + 1) + (shown.kind === 'milestone' ? 14 : 8)} y={y + ROW / 2 + 4} class="drag-label">
                      {d.mode === 'move'
                        ? shortDate(shown.start, now) + (shown.kind === 'task' ? ' – ' + shortDate(shown.end, now) : '')
                        : '– ' + shortDate(shown.end, now)}
                    </text>
                  )}
                  {s.due !== undefined && <line x1={x(s.due + 1)} x2={x(s.due + 1)} y1={y + 3} y2={y + ROW - 3} class="due" />}
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

/** The first day of a bar past its due date (not before the bar starts), or null when it isn't late. */
export function lateFrom(s: Sched): Day | null {
  return s.due !== undefined && s.end > s.due ? Math.max(s.due + 1, s.start) : null;
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
    return <path d={`M${x0},${top} H${x1} V${top + 10} L${x1 - 5},${top + 5} H${x0 + 5} L${x0},${top + 10} z`} class="summary" />;
  }
  const late = lateFrom(s);
  return (
    <>
      <rect x={x0 + 0.5} y={mid - 7} width={Math.max(x1 - x0 - 1, 2)} height={14} rx={3} class={'bar' + (s.critical ? ' critical' : '')} />
      {late !== null && <rect x={x(late) + 0.5} y={mid - 7} width={Math.max(x1 - x(late) - 1, 2)} height={14} rx={3} class="bar late" />}
    </>
  );
}

/** A cell being typed in: Enter or leaving it keeps what was typed, Escape doesn't. */
function CellInput({ value, onDone }: { value: string; onDone: (text: string | null) => void }) {
  const [text, setText] = useState(value);
  const input = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const finish = (v: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(v);
  };
  useLayoutEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  return (
    <input
      ref={input}
      class="gantt-input"
      value={text}
      onInput={(e) => setText(e.currentTarget.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (imeActive(e)) return;
        if (e.key === 'Enter') finish(text);
        else if (e.key === 'Escape') finish(null);
      }}
      onBlur={() => finish(text)}
    />
  );
}
