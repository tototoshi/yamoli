import { expect, test } from 'vitest';
import { parseDate } from './calendar';
import { dateCells } from './GanttView';
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
