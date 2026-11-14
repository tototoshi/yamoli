/*
 * Dates and working calendars for scheduling.
 *
 * Dates are whole days counted from 1970-01-01 (UTC), so arithmetic is plain
 * integer math and time zones never shift a date.
 *
 *   workdays: mon-fri          (also "mon,wed,fri", "月-金"; default mon-fri)
 *   holidays: jp, 2026-11-27, 2026-12-29..2027-01-03
 *   duration: 3d | 2w | 10cd   (working days, working weeks, calendar days)
 */

export type Day = number;

const MS_PER_DAY = 86_400_000;

export function parseDate(s: string | undefined): Day | null {
  const m = s?.trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (!m) return null;
  const [y, mo, d] = [+m[1], +m[2] - 1, +m[3]];
  const t = Date.UTC(y, mo, d);
  const check = new Date(t);
  if (check.getUTCMonth() !== mo || check.getUTCDate() !== d) return null;
  return t / MS_PER_DAY;
}

/** A date as typed: 2026-12-01, 2026/12/1, or 12/1 (in now's year). */
export function parseDateInput(s: string, now: Day): Day | null {
  const m = s.trim().match(/^(\d{1,2})[-/](\d{1,2})$/);
  return m ? parseDate(`${formatDate(now).slice(0, 4)}-${m[1]}-${m[2]}`) : parseDate(s);
}

export const formatDate = (d: Day) => new Date(d * MS_PER_DAY).toISOString().slice(0, 10);

/** 0 = Sunday … 6 = Saturday */
export const weekday = (d: Day) => new Date(d * MS_PER_DAY).getUTCDay();

export function today(): Day {
  const n = new Date();
  return Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()) / MS_PER_DAY;
}

/** "11/20", or "2027/1/5" outside the current year. */
export function shortDate(d: Day, now = today()): string {
  const [y, m, day] = formatDate(d).split('-').map(Number);
  const sameYear = y === Number(formatDate(now).slice(0, 4));
  return sameYear ? `${m}/${day}` : `${y}/${m}/${day}`;
}

// ---------------------------------------------------------------- workdays

const DAY_NAMES: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
  日: 0,
  月: 1,
  火: 2,
  水: 3,
  木: 4,
  金: 5,
  土: 6,
};

const dayIndex = (s: string) =>
  DAY_NAMES[
    s
      .trim()
      .toLowerCase()
      .slice(0, /^[a-z]/i.test(s.trim()) ? 3 : 1)
  ];

/** Weekday numbers from "mon-fri", "mon,wed,fri", "月-金"…; null if unparseable. */
export function parseWorkdays(s: string): Set<number> | null {
  const out = new Set<number>();
  for (const part of s.split(/[,\s、]+/).filter(Boolean)) {
    const [a, b] = part.split(/[-~〜]/);
    const from = dayIndex(a);
    const to = b === undefined ? from : dayIndex(b);
    if (from === undefined || to === undefined) return null;
    for (let i = from; ; i = (i + 1) % 7) {
      out.add(i);
      if (i === to) break;
    }
  }
  return out.size ? out : null;
}

// ---------------------------------------------------------------- holidays

export interface HolidaySpec {
  /** Include Japanese public holidays. */
  jp: boolean;
  days: Set<Day>;
}

/** "jp, 2026-11-27, 2026-12-29..2027-01-03"; null if any part is unparseable. */
export function parseHolidays(s: string): HolidaySpec | null {
  const spec: HolidaySpec = { jp: false, days: new Set() };
  for (const part of s.split(/[,\s、]+/).filter(Boolean)) {
    if (part.toLowerCase() === 'jp') {
      spec.jp = true;
      continue;
    }
    const [a, b] = part.split('..');
    const from = parseDate(a);
    const to = b === undefined ? from : parseDate(b);
    if (from === null || to === null || to < from) return null;
    for (let d = from; d <= to; d++) spec.days.add(d);
  }
  return spec;
}

// ---------------------------------------------------------------- calendar

export class WorkCalendar {
  constructor(
    private workdays: Set<number> = new Set([1, 2, 3, 4, 5]),
    private holidays: HolidaySpec = { jp: false, days: new Set() },
    /** Japanese holidays by ISO date, once loaded. */
    private jpDays: ReadonlyMap<string, string> | null = null
  ) {}

  get workdaysPerWeek() {
    return this.workdays.size;
  }

  isWorkday(d: Day): boolean {
    if (!this.workdays.has(weekday(d)) || this.holidays.days.has(d)) return false;
    return !(this.holidays.jp && this.jpDays?.has(formatDate(d)));
  }

  /** d itself if it is a working day, else the next one. */
  nextWorkday(d: Day): Day {
    for (let i = 0; i < 3660; i++) if (this.isWorkday(d + i)) return d + i;
    return d; // no working days at all: give up rather than loop forever
  }

  /** How many working days there are from a to b, both included. */
  workdaysBetween(a: Day, b: Day): number {
    let n = 0;
    for (let d = a; d <= b; d++) if (this.isWorkday(d)) n++;
    return n;
  }

  /** The n-th working day counting `start` (a working day) as the first. */
  addWorkdays(start: Day, n: number): Day {
    let d = start;
    for (let left = n - 1; left > 0;) {
      d++;
      if (this.isWorkday(d)) left--;
      if (d - start > 36600) break;
    }
    return d;
  }
}

// ---------------------------------------------------------------- duration

export interface Duration {
  amount: number;
  unit: 'd' | 'w' | 'cd';
}

/** "3d", "2w", "10cd", "3" (= days), "3日", "2週"; null if unparseable. */
export function parseDuration(s: string): Duration | null {
  const m = s.trim().match(/^(\d+(?:\.\d+)?)\s*(d|w|cd|日|週|暦日)?$/i);
  if (!m) return null;
  const unit = (m[2] ?? 'd').toLowerCase();
  return {
    amount: Number(m[1]),
    unit: unit === 'w' || unit === '週' ? 'w' : unit === 'cd' || unit === '暦日' ? 'cd' : 'd',
  };
}
