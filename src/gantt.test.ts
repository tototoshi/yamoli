import { expect, test } from 'vitest';
import { formatDate, parseDate } from './calendar';
import { findCycles } from './deps';
import { dependencyLinks, ganttRange, monthBands, scheduleIssue } from './gantt';
import { OutlineStore } from './model';
import { computeSchedule } from './schedule';

function project() {
  const s = OutlineStore.create();
  const p = s.addChild(s.rootId, -1, 'p');
  s.addAttribute(p.id, 'start', '2026-11-25');
  const a = s.addChild(p.id, -1, 'a');
  s.addAttribute(a.id, 'duration', '3d');
  const b = s.addChild(p.id, -1, 'b');
  s.addAttribute(b.id, 'duration', '5d');
  s.addAttribute(b.id, 'after', `[[${a.id}]]`);
  s.addAttribute(b.id, 'due', '2026-12-01');
  const c = s.addChild(p.id, -1, 'c'); // unscheduled: no duration, no children
  return { s, rows: [p.id, a.id, b.id, c.id], a: a.id, b: b.id };
}

test('range covers bars and due dates with margins', () => {
  const { s, rows } = project();
  const sched = computeSchedule(s, findCycles(s));
  const r = ganttRange(rows, sched)!;
  expect(formatDate(r.from)).toBe('2026-11-23'); // 11/25 - 2
  expect(formatDate(r.to)).toBe('2026-12-13'); // at least 21 days
  expect(ganttRange([rows[3]], sched)).toBeNull();
  expect(monthBands(r).map((m) => [m.label, formatDate(m.start), formatDate(m.end)])).toEqual([
    ['2026年11月', '2026-11-23', '2026-11-30'],
    ['2026年12月', '2026-12-01', '2026-12-13'],
  ]);
});

test('links connect rows that are both shown', () => {
  const { s, rows, a, b } = project();
  const sched = computeSchedule(s, findCycles(s));
  expect(dependencyLinks(s, rows, sched)).toEqual([{ from: a, to: b, critical: true }]);
  expect(dependencyLinks(s, [b], sched)).toEqual([]);
  expect(parseDate('2026-12-01')).toBe(sched.byId.get(b)!.due);
});

test('rows without a bar say why', () => {
  const { s, rows } = project();
  const [p, a, , c] = rows;
  const fresh = s.addChild(p, -1, '新しい作業').id; // no attributes yet
  const done = s.addChild(p, -1, '済んだ作業').id;
  s.setCompleted(done, true);
  const group = s.addChild(p, -1, 'グループ').id;
  s.addChild(group, -1, '中身');
  s.addAttribute(c, 'due', 'someday');
  const sched = computeSchedule(s, findCycles(s));
  const issue = (id: string) => scheduleIssue(s, id, sched, new Set());
  expect(issue(a)).toBeNull(); // has a bar
  expect(issue(fresh)).toBe('duration 未設定');
  expect(issue(done)).toBeNull();
  expect(issue(group)).toBeNull();
  expect(issue(c)).toBe('⚠ due: someday');

  s.node(p).attributes = []; // no start anywhere
  const unstarted = computeSchedule(s, findCycles(s));
  expect(scheduleIssue(s, a, unstarted, new Set())).toBe('開始日未設定');
});
