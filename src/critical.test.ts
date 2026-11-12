import { expect, test } from 'vitest';
import { findCycles } from './deps';
import { OutlineStore } from './model';
import { computeSchedule } from './schedule';

const run = (s: OutlineStore) => computeSchedule(s, findCycles(s));

function project(start = '2026-11-16') {
  const s = OutlineStore.create();
  const p = s.addChild(s.rootId, -1, 'P').id;
  s.addField(p, 'start', start);
  const add = (parent: string, text: string, attrs: Record<string, string> = {}) => {
    const id = s.addChild(parent, -1, text).id;
    for (const [k, v] of Object.entries(attrs)) s.addField(id, k, v);
    return id;
  };
  return { s, p, add };
}

test('paths finishing on the same day are all critical', () => {
  const { s, p, add } = project();
  const a = add(p, 'a', { duration: '2d' });
  const b = add(p, 'b', { duration: '2d' }); // as long as a
  const c = add(p, 'c', { duration: '1d' }); // shorter: has a day to spare
  const join = add(p, 'join', { duration: '1d', after: `[[${a}]], [[${b}]], [[${c}]]` });
  const r = run(s);
  expect([a, b, c, join].map((id) => r.byId.get(id)!.critical)).toEqual([true, true, false, true]);
});

test('children of a phase that finish together are all critical through the phase', () => {
  const { s, p, add } = project();
  const ph = add(p, 'phase');
  const x = add(ph, 'x', { duration: '3d' });
  const y = add(ph, 'y', { duration: '3d' });
  add(p, 'after', { duration: '1d', after: `[[${ph}]]` });
  const r = run(s);
  expect([x, y].map((id) => r.byId.get(id)!.critical)).toEqual([true, true]);
});

test('a dependency ending on a Friday holds back a start set for the Monday after', () => {
  const { s, p, add } = project('2026-11-18'); // Wednesday
  const a = add(p, 'a', { duration: '3d' }); // Wed–Fri
  const b = add(p, 'b', { duration: '1d', start: '2026-11-23', after: `[[${a}]]` }); // Monday
  const r = run(s);
  expect(r.byId.get(a)!.critical).toBe(true);
  expect(r.byId.get(b)!.critical).toBe(true);
});

/**
 * Against what critical means: a task is critical exactly when one more day
 * of it would finish the project later. Random projects with phases,
 * dependencies on tasks and on finished phases (nothing waiting on itself).
 */
test('critical tasks are exactly those whose delay delays the project', () => {
  for (let seed = 1; seed <= 500; seed++) {
    let x = seed;
    const r = () => (x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const { s, p, add } = project();
    const tasks: string[] = [];
    const closed: string[] = [];
    let open = p;
    for (let i = 0, n = 6 + Math.floor(r() * 14); i < n; i++) {
      if (r() < 0.2) {
        if (open !== p) closed.push(open);
        open = add(p, 'phase ' + i);
        continue;
      }
      const deps = tasks.filter(() => r() < 0.25);
      if (r() < 0.3 && closed.length) deps.push(closed[Math.floor(r() * closed.length)]);
      const attrs: Record<string, string> = { duration: `${1 + Math.floor(r() * 4)}d` };
      if (deps.length) attrs.after = deps.map((d) => `[[${d}]]`).join(', ');
      tasks.push(add(r() < 0.7 ? open : p, 'task ' + i, attrs));
    }

    const finish = () => Math.max(...[...run(s).byId.values()].map((v) => v.end));
    const res = run(s);
    const end = finish();
    for (const t of tasks) {
      const field = s.node(t).children.find((c) => s.node(c).key === 'duration')!;
      const days = s.node(field).text;
      s.node(field).text = `${parseInt(days) + 1}d`;
      const delays = finish() > end;
      s.node(field).text = days;
      expect([seed, s.node(t).text, res.byId.get(t)!.critical]).toEqual([seed, s.node(t).text, delays]);
    }
  }
});
