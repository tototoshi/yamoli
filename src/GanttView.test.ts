import { expect, test } from 'vitest';
import { parseDate } from './calendar';
import { dateCells, lateFrom } from './GanttView';
import type { Sched } from './schedule';

const day = (s: string) => parseDate(s)!;
const sched = (start: string, end: string, kind: Sched['kind'] = 'task'): Sched => ({
  start: day(start),
  end: day(end),
  kind,
  late: 0,
  delayed: false,
  critical: false,
});

test('date columns: start, end and working days; the year only outside this one', () => {
  const now = day('2026-11-12');
  expect(dateCells(sched('2026-11-16', '2026-11-20'), 5, now)).toEqual(['11/16', '11/20', '5日']);
  expect(dateCells(sched('2026-12-28', '2027-01-05'), 5, now)).toEqual(['12/28', '2027/1/5', '5日']);
  expect(dateCells(sched('2026-11-20', '2026-11-20', 'milestone'), 0, now)).toEqual(['11/20', '', '◆']);
  expect(dateCells(undefined, 0, now)).toEqual(['', '', '']);
});

test('the late part of a bar runs from the day after its due date, but never starts before the bar', () => {
  const due = (start: string, end: string, d: string) => ({ ...sched(start, end), due: day(d) });
  expect(lateFrom(due('2026-11-16', '2026-11-20', '2026-11-18'))).toBe(day('2026-11-19'));
  expect(lateFrom(due('2026-12-14', '2026-12-23', '2026-12-11'))).toBe(day('2026-12-14')); // all of it late
  expect(lateFrom(due('2026-11-16', '2026-11-20', '2026-11-20'))).toBeNull();
  expect(lateFrom(sched('2026-11-16', '2026-11-20'))).toBeNull();
});
