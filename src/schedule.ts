/*
 * Schedule computation from attributes.
 *
 *   duration: 3d          makes an item a task (0d = milestone)
 *   start: 2026-11-10     earliest start; inherited by descendants
 *   due: 2026-11-20       deadline; lateness is reported
 *   workdays / holidays   working calendar; inherited by descendants
 *   after: [[x]]          dependencies (see deps.ts); an ancestor's
 *                         dependencies also hold for its descendants
 *
 * A task starts on the first working day after all its dependencies end, but
 * not before its (inherited) start. Items without a duration that contain
 * scheduled items become summaries spanning them. Tasks with no start
 * anywhere and no scheduled dependency are left unscheduled.
 */
import { parseDate, parseDuration, parseHolidays, parseWorkdays, WorkCalendar, type Day } from './calendar';
import { dependencies } from './deps';
import type { OutlineNode, OutlineStore } from './model';

export interface Sched {
  start: Day;
  end: Day;
  kind: 'task' | 'milestone' | 'summary';
  due?: Day;
  /** Calendar days past due (0 when on time or without a due date). */
  late: number;
  /** The item's own start was pushed later by its dependencies. */
  delayed: boolean;
  /** On the chain that determines when its project finishes. */
  critical: boolean;
}

export interface ScheduleResult {
  byId: Map<string, Sched>;
  /** Tasks (with a duration) that could not be placed: no start anywhere. */
  unscheduled: Set<string>;
  /** Items with an attribute value that could not be parsed, and which one. */
  invalid: Map<string, string>;
  /** Some calendar uses Japanese holidays. */
  needsJp: boolean;
}

const attr = (n: OutlineNode, key: string) =>
  n.attributes.find((a) => a.key.trim().toLowerCase() === key)?.value.trim() || undefined;

export function computeSchedule(
  store: OutlineStore,
  cycles: Set<string>,
  jpDays: ReadonlyMap<string, string> | null = null
): ScheduleResult {
  const res: ScheduleResult = { byId: new Map(), unscheduled: new Set(), invalid: new Map(), needsJp: false };
  const memo = new Map<string, Sched | null>();
  const visiting = new Set<string>();
  /** What determined each item's dates (dependency, child, …) for the critical chain. */
  const driver = new Map<string, string | null>();

  const ancestry = (id: string) => store.path(id).reverse(); // self first, root last

  /** Nearest value of key on id or an ancestor, with the item that holds it. */
  const inherited = (id: string, key: string) => {
    for (const a of ancestry(id)) {
      const v = attr(store.node(a), key);
      if (v) return { value: v, owner: a };
    }
    return null;
  };

  const dateAttr = (id: string, key: string): Day | undefined => {
    const v = attr(store.node(id), key);
    if (v === undefined) return undefined;
    const d = parseDate(v);
    if (d === null) res.invalid.set(id, `${key}: ${v}`);
    return d ?? undefined;
  };

  const inheritedStart = (id: string): Day | undefined => {
    for (const a of ancestry(id)) {
      const d = dateAttr(a, 'start');
      if (d !== undefined) return d;
    }
    return undefined;
  };

  const calendars = new Map<string, WorkCalendar>();
  const calendarFor = (id: string): WorkCalendar => {
    const w = inherited(id, 'workdays');
    const h = inherited(id, 'holidays');
    const cacheKey = `${w?.owner ?? ''}|${h?.owner ?? ''}`;
    let cal = calendars.get(cacheKey);
    if (!cal) {
      const days = w ? parseWorkdays(w.value) : undefined;
      if (w && !days) res.invalid.set(w.owner, `workdays: ${w.value}`);
      const hol = h ? parseHolidays(h.value) : undefined;
      if (h && !hol) res.invalid.set(h.owner, `holidays: ${h.value}`);
      if (hol?.jp) res.needsJp = true;
      cal = new WorkCalendar(days ?? undefined, hol ?? undefined, jpDays);
      calendars.set(cacheKey, cal);
    }
    return cal;
  };

  const schedOf = (id: string): Sched | null => {
    if (memo.has(id)) return memo.get(id)!;
    if (visiting.has(id) || cycles.has(id)) return null;
    visiting.add(id);
    const s = compute(id);
    visiting.delete(id);
    memo.set(id, s);
    return s;
  };

  /**
   * When dependents may start after `id`: its end if scheduled; otherwise an
   * unscheduled item passes its own dependencies through (zero length).
   */
  const endOf = (id: string, seen = new Set<string>()): Day | undefined => {
    const s = schedOf(id);
    if (s) return s.end;
    if (seen.has(id)) return undefined;
    seen.add(id);
    let best: Day | undefined;
    for (const d of dependencies(store, id)) {
      const e = endOf(d, seen);
      if (e !== undefined && (best === undefined || e > best)) {
        best = e;
        driver.set(id, d);
      }
    }
    return best;
  };

  /** Latest end among id's and its ancestors' dependencies, and which one it was. */
  const afterDeps = (id: string) => {
    let latest: Day | undefined;
    let by: string | null = null;
    for (const holder of ancestry(id)) {
      for (const d of dependencies(store, holder)) {
        // An ancestor depending on something inside itself would be circular.
        if (d === id || store.isAncestor(d, id) || (holder !== id && store.isAncestor(holder, d))) continue;
        const e = endOf(d);
        if (e !== undefined && (latest === undefined || e > latest)) {
          latest = e;
          by = d;
        }
      }
    }
    return { after: latest === undefined ? undefined : latest + 1, by };
  };

  const finish = (id: string, s: Omit<Sched, 'due' | 'late' | 'critical'>): Sched => {
    const due = dateAttr(id, 'due');
    return { ...s, due, late: due !== undefined && s.end > due ? s.end - due : 0, critical: false };
  };

  const task = (id: string, dur: { amount: number; unit: 'd' | 'w' | 'cd' }): Sched | null => {
    const own = dateAttr(id, 'start');
    const base = inheritedStart(id);
    const { after, by } = afterDeps(id);
    if (after === undefined && base === undefined) {
      res.unscheduled.add(id);
      return null;
    }
    let start = Math.max(after ?? -Infinity, base ?? -Infinity);
    driver.set(id, after !== undefined && after >= (base ?? -Infinity) ? by : null);
    const cal = calendarFor(id);
    let end: Day;
    if (dur.unit === 'cd') {
      end = start + Math.max(Math.ceil(dur.amount) - 1, 0);
    } else {
      start = cal.nextWorkday(start);
      const days = Math.ceil(dur.unit === 'w' ? dur.amount * cal.workdaysPerWeek : dur.amount);
      end = days === 0 ? start : cal.addWorkdays(start, days);
    }
    return finish(id, {
      start,
      end,
      kind: dur.amount === 0 ? 'milestone' : 'task',
      delayed: own !== undefined && after !== undefined && after > own,
    });
  };

  const summary = (id: string): Sched | null => {
    let start: Day | undefined;
    let end: Day | undefined;
    for (const c of store.node(id).children) {
      const s = schedOf(c);
      if (!s) continue;
      if (start === undefined || s.start < start) start = s.start;
      if (end === undefined || s.end > end) {
        end = s.end;
        driver.set(id, c);
      }
    }
    if (start === undefined || end === undefined) return null;
    return finish(id, { start, end, kind: 'summary', delayed: false });
  };

  const compute = (id: string): Sched | null => {
    const raw = attr(store.node(id), 'duration');
    if (raw !== undefined) {
      const dur = parseDuration(raw);
      if (dur) return task(id, dur);
      res.invalid.set(id, `duration: ${raw}`);
    }
    return summary(id);
  };

  for (const id of Object.keys(store.nodes)) {
    // Validate dates even on items that end up unscheduled.
    dateAttr(id, 'start');
    dateAttr(id, 'due');
    const s = schedOf(id);
    if (s) res.byId.set(id, s);
  }

  // Critical chain: per project (nearest item with a start), walk back from the
  // latest-finishing task through whatever determined each item's dates.
  const projectOf = (id: string) => ancestry(id).find((a) => dateAttr(a, 'start') !== undefined) ?? '';
  const latest = new Map<string, { end: Day; ids: string[] }>();
  for (const [id, s] of res.byId) {
    if (s.kind === 'summary') continue;
    const p = projectOf(id);
    const cur = latest.get(p);
    if (!cur || s.end > cur.end) latest.set(p, { end: s.end, ids: [id] });
    else if (s.end === cur.end) cur.ids.push(id);
  }
  for (const { ids } of latest.values()) {
    for (const start of ids) {
      for (let cur: string | null | undefined = start, guard = 0; cur && guard < 10000; guard++) {
        const s = res.byId.get(cur);
        if (s) s.critical = true;
        cur = driver.get(cur);
      }
    }
  }
  return res;
}
