import { expect, test } from 'vitest';
import { formatDate, parseDate, parseDuration, parseHolidays, parseWorkdays, WorkCalendar } from './calendar';
import { findCycles } from './deps';
import { OutlineStore } from './model';
import { computeSchedule, type Sched } from './schedule';

const D = (s: string) => parseDate(s)!;

test('calendar parsing', () => {
  expect(parseDate('2026-11-10')).toBe(D('2026/11/10'));
  expect(parseDate('2026-02-30')).toBeNull();
  expect(parseWorkdays('mon-fri')).toEqual(new Set([1, 2, 3, 4, 5]));
  expect(parseWorkdays('月,水,金')).toEqual(new Set([1, 3, 5]));
  expect(parseWorkdays('sat-mon')).toEqual(new Set([6, 0, 1]));
  expect(parseWorkdays('someday')).toBeNull();
  const h = parseHolidays('jp, 2026-12-30..2027-01-02, 2026-11-27')!;
  expect(h.jp).toBe(true);
  expect(h.days.size).toBe(5);
  expect(parseHolidays('2026-12-31..2026-12-01')).toBeNull();
  expect(parseDuration('3d')).toEqual({ amount: 3, unit: 'd' });
  expect(parseDuration('2w')).toEqual({ amount: 2, unit: 'w' });
  expect(parseDuration('10cd')).toEqual({ amount: 10, unit: 'cd' });
  expect(parseDuration('5日')).toEqual({ amount: 5, unit: 'd' });
  expect(parseDuration('soon')).toBeNull();
});

test('working calendar skips weekends and holidays', () => {
  const cal = new WorkCalendar(undefined, parseHolidays('2026-11-16')!);
  expect(formatDate(cal.nextWorkday(D('2026-11-14')))).toBe('2026-11-17'); // Sat -> (Mon is a holiday) -> Tue
  expect(formatDate(cal.addWorkdays(D('2026-11-13'), 3))).toBe('2026-11-18'); // Fri, Tue, Wed
});

function project() {
  const s = OutlineStore.create();
  const p = s.addChild(s.rootId, -1, 'リリース準備');
  s.addAttribute(p.id, 'start', '2026-11-10');
  const add = (text: string, attrs: Record<string, string>) => {
    const n = s.addChild(p.id, -1, text);
    for (const [k, v] of Object.entries(attrs)) s.addAttribute(n.id, k, v);
    return n.id;
  };
  const design = add('設計', { duration: '3d' });
  const api = add('API実装', { duration: '5d', after: `[[${design}]]` });
  const ui = add('UI実装', { duration: '4d', after: `[[${design}]]` });
  const tst = add('テスト', { duration: '2d', after: `[[${api}]], [[${ui}]]`, due: '2026-11-20' });
  const release = add('リリース', { duration: '0d', after: `[[${tst}]]` });
  return { s, p: p.id, design, api, ui, tst, release };
}

const dates = (x: Sched | undefined) => x && [formatDate(x.start), formatDate(x.end)];
const run = (s: OutlineStore, jp: ReadonlyMap<string, string> | null = null) => computeSchedule(s, findCycles(s), jp);

test('tasks are placed after their dependencies on working days', () => {
  const { s, p, design, api, ui, tst, release } = project();
  const r = run(s);
  expect(dates(r.byId.get(design))).toEqual(['2026-11-10', '2026-11-12']);
  expect(dates(r.byId.get(api))).toEqual(['2026-11-13', '2026-11-19']); // Fri + Mon–Thu
  expect(dates(r.byId.get(ui))).toEqual(['2026-11-13', '2026-11-18']);
  expect(dates(r.byId.get(tst))).toEqual(['2026-11-20', '2026-11-23']);
  expect(r.byId.get(tst)!.late).toBe(3);
  expect(r.byId.get(release)!.kind).toBe('milestone');
  expect(dates(r.byId.get(release))).toEqual(['2026-11-24', '2026-11-24']);
  expect(r.byId.get(p)!.kind).toBe('summary');
  expect(dates(r.byId.get(p))).toEqual(['2026-11-10', '2026-11-24']);
  // Critical chain runs through the longer branch (API), not UI.
  const critical = [design, api, ui, tst, release].filter((id) => r.byId.get(id)!.critical);
  expect(critical).toEqual([design, api, tst, release]);
  expect(r.needsJp).toBe(false);
});

test('Japanese holidays apply once loaded', () => {
  const { s, p, tst } = project();
  s.addAttribute(p, 'holidays', 'jp');
  expect(run(s).needsJp).toBe(true);
  const r = run(s, new Map([['2026-11-23', '勤労感謝の日']]));
  expect(dates(r.byId.get(tst))).toEqual(['2026-11-20', '2026-11-24']);
  expect(r.byId.get(tst)!.late).toBe(4);
});

test('calendar days, delayed starts, phase dependencies, unscheduled and invalid items', () => {
  const { s, p, design, tst } = project();
  const wait = s.addChild(p, -1, '審査待ち');
  s.addAttribute(wait.id, 'duration', '10cd');
  s.addAttribute(wait.id, 'after', `[[${design}]]`);
  s.addAttribute(wait.id, 'start', '2026-11-11'); // earlier than its dependency allows
  // A phase that depends on the test: its children inherit that dependency.
  const phase = s.addChild(s.rootId, -1, '運用フェーズ');
  s.addAttribute(phase.id, 'after', `[[${tst}]]`);
  const ops = s.addChild(phase.id, -1, '監視設定');
  s.addAttribute(ops.id, 'duration', '1d');
  const lonely = s.addChild(s.rootId, -1, 'いつか');
  s.addAttribute(lonely.id, 'duration', '2d');
  s.addAttribute(lonely.id, 'due', 'someday');

  const r = run(s);
  expect(dates(r.byId.get(wait.id))).toEqual(['2026-11-13', '2026-11-22']); // runs through weekends
  expect(r.byId.get(wait.id)!.delayed).toBe(true);
  expect(dates(r.byId.get(ops.id))).toEqual(['2026-11-24', '2026-11-24']);
  expect(dates(r.byId.get(phase.id))).toEqual(['2026-11-24', '2026-11-24']);
  expect(r.unscheduled.has(lonely.id)).toBe(true);
  expect(r.invalid.get(lonely.id)).toBe('due: someday');
});

test('items on a dependency cycle are not scheduled', () => {
  const { s, design, release } = project();
  s.addAttribute(design, 'after', `[[${release}]]`);
  const r = run(s);
  expect(r.byId.has(design)).toBe(false);
  expect(r.byId.has(release)).toBe(false);
});

test('is:late / is:critical / is:milestone search', async () => {
  const { searchTree, parseQuery } = await import('./search');
  const { s, design, api, tst, release } = project();
  const find = (q: string) => [...searchTree(s, s.rootId, parseQuery(q)).matches];
  expect(find('is:late')).toEqual([tst]);
  expect(find('is:クリティカル')).toEqual([design, api, tst, release]);
  expect(find('is:milestone')).toEqual([release]);
  s.setCompleted(tst, true);
  expect(find('is:遅延')).toEqual([]);
});
