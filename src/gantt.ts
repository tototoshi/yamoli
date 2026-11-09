/*
 * Layout for the Gantt view: which days to show, month bands, and the
 * dependency links between rows. Geometry (pixels) is left to the view.
 */
import { formatDate, type Day } from './calendar';
import { dependencies } from './deps';
import type { OutlineStore } from './model';
import { t } from './i18n';
import type { Sched, ScheduleResult } from './schedule';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface DayRange {
  from: Day;
  /** Inclusive. */
  to: Day;
}

/**
 * Why a row has no bar, or null when it has one or needs none (a group, or
 * finished work). Every open leaf counts as a task, so new items show up as
 * still needing a duration rather than silently missing from the plan.
 */
export function scheduleIssue(store: OutlineStore, id: string, schedule: ScheduleResult, cycles: Set<string>) {
  if (schedule.byId.has(id)) return null;
  const invalid = schedule.invalid.get(id);
  if (invalid) return `⚠ ${invalid}`;
  if (cycles.has(id)) return t('⚠ 依存が循環しています', '⚠ Dependency cycle');
  if (schedule.unscheduled.has(id)) return t('開始日未設定', 'No start date');
  const n = store.node(id);
  if (!store.items(id).length && !n.completed) return t('duration 未設定', 'No duration');
  return null;
}

/** Days covering every scheduled row and due date, with a little margin. */
export function ganttRange(rows: string[], schedule: ScheduleResult, minDays = 21): DayRange | null {
  let from = Infinity;
  let to = -Infinity;
  for (const id of rows) {
    const s = schedule.byId.get(id);
    if (!s) continue;
    from = Math.min(from, s.start, s.due ?? Infinity);
    to = Math.max(to, s.end, s.due ?? -Infinity);
  }
  if (from === Infinity) return null;
  from -= 2;
  to = Math.max(to + 3, from + minDays - 1);
  return { from, to };
}

export interface MonthBand {
  start: Day;
  /** Inclusive. */
  end: Day;
  label: string;
}

/** Month bands within the range, labelled "2026年11月" (or "Nov 2026"). */
export function monthBands({ from, to }: DayRange): MonthBand[] {
  const bands: MonthBand[] = [];
  for (let d = from; d <= to; ) {
    const [y, m] = formatDate(d).split('-').map(Number);
    const nextMonth = Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1) / 86_400_000;
    const end = Math.min(nextMonth - 1, to);
    bands.push({ start: d, end, label: t(`${y}年${m}月`, `${MONTHS[m - 1]} ${y}`) });
    d = end + 1;
  }
  return bands;
}

export interface DepLink {
  from: string;
  to: string;
  critical: boolean;
}

/** Direct dependencies between rows that are both on the chart. */
export function dependencyLinks(store: OutlineStore, rows: string[], schedule: ScheduleResult): DepLink[] {
  const shown = new Set(rows.filter((id) => schedule.byId.has(id)));
  const links: DepLink[] = [];
  for (const to of shown) {
    for (const from of dependencies(store, to)) {
      if (!shown.has(from)) continue;
      const critical = !!schedule.byId.get(from)!.critical && !!schedule.byId.get(to)!.critical;
      links.push({ from, to, critical });
    }
  }
  return links;
}

/** Hover text describing an item's computed dates. */
export function schedTooltip(s: Sched): string {
  const span = s.end - s.start + 1;
  return [
    s.kind === 'summary' ? t('子の作業の期間', 'Span of the work below') : s.kind === 'milestone' ? t('マイルストーン', 'Milestone') : t('作業', 'Task'),
    s.kind === 'milestone'
      ? formatDate(s.start)
      : t(`${formatDate(s.start)} 〜 ${formatDate(s.end)}（${span}日間）`, `${formatDate(s.start)} – ${formatDate(s.end)} (${span} days)`),
    s.due !== undefined && t(`期限 ${formatDate(s.due)}`, `Due ${formatDate(s.due)}`),
    s.late > 0 && t(`${s.late}日超過`, `${s.late} days late`),
    s.delayed && t('依存のため指定の開始日より遅れて開始', 'Starts after its start date because of dependencies'),
    s.critical && s.kind !== 'summary' && t('クリティカルパス上（遅れると全体が遅れる）', 'On the critical path (a delay delays everything)'),
  ]
    .filter(Boolean)
    .join('\n');
}
