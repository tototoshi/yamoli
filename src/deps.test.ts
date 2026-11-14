import { expect, test } from 'vitest';
import {
  addDependency,
  blockers,
  dependencies,
  dependents,
  depStatus,
  findCycles,
  missingDependencies,
  removeDependency,
  wouldCycle,
} from './deps';
import { OutlineStore } from './model';

function project() {
  const s = OutlineStore.create();
  const design = s.addChild(s.rootId, -1, 'design');
  const api = s.addChild(s.rootId, -1, 'api');
  const ui = s.addChild(s.rootId, -1, 'ui');
  const release = s.addChild(s.rootId, -1, 'release');
  s.addField(api.id, 'after', `[[${design.id}]]`);
  s.addField(ui.id, 'After ', `[[${design.id}]]`); // key match ignores case/spaces
  s.addField(release.id, 'after', `[[${api.id}]], [[${ui.id}]]`);
  s.addField(release.id, 'after', `[[${api.id}]] [[missing]] [[${release.id}]]`);
  s.addField(release.id, 'note', `[[${design.id}]]`); // not a dependency
  return { s, design, api, ui, release };
}

test('dependencies and dependents', () => {
  const { s, design, api, ui, release } = project();
  expect(dependencies(s, release.id)).toEqual([api.id, ui.id]);
  expect(dependencies(s, design.id)).toEqual([]);
  expect(dependents(s, design.id).sort()).toEqual([api.id, ui.id].sort());
  expect(dependents(s, release.id)).toEqual([]);
});

test('status follows completion of dependencies', () => {
  const { s, design, api, ui, release } = project();
  const st = (id: string) => depStatus(s, id, findCycles(s));
  expect(st(design.id)).toBe('none');
  expect(st(api.id)).toBe('blocked');
  expect(st(release.id)).toBe('blocked');
  s.setCompleted(design.id, true);
  expect(st(api.id)).toBe('ready');
  s.setCompleted(api.id, true);
  expect(blockers(s, release.id)).toEqual([ui.id]);
  s.setCompleted(ui.id, true);
  expect(st(release.id)).toBe('ready');
});

test('cycles are detected', () => {
  const { s, design, api, ui, release } = project();
  expect(findCycles(s).size).toBe(0);
  s.addField(design.id, 'after', `[[${release.id}]]`); // design -> release -> api -> design
  const cycles = findCycles(s);
  expect(cycles).toEqual(new Set([design.id, api.id, ui.id, release.id]));
  expect(depStatus(s, api.id, cycles)).toBe('cycle');
});

test('links in `after` to deleted items are reported, not silently ignored', () => {
  const { s, design, api, release } = project();
  expect(missingDependencies(s, api.id)).toEqual([]);
  s.remove(design.id);
  expect(dependencies(s, api.id)).toEqual([]);
  expect(missingDependencies(s, api.id)).toEqual([design.id]);
  expect(missingDependencies(s, release.id)).toEqual([]);
});

test('a dependency is added to `after` and taken out again, inline or in a list', () => {
  const s = OutlineStore.create();
  const [a, b, c, x] = ['a', 'b', 'c', 'x'].map((t) => s.addChild(s.rootId, -1, t).id);
  addDependency(s, x, a);
  expect(s.fieldValue(x, 'after')).toBe(`[[${a}]]`);
  addDependency(s, x, b);
  addDependency(s, x, b); // once
  expect(s.fieldValue(x, 'after')).toBe(`[[${a}]], [[${b}]]`);
  s.setText(s.field(x, 'after')!.id, `[[${a}]] once approved, [[${b}]]`);
  removeDependency(s, x, a);
  expect(s.fieldValue(x, 'after')).toBe(`[[${b}]]`);
  removeDependency(s, x, b);
  expect(s.field(x, 'after')).toBeUndefined(); // nothing left

  const list = s.addField(c, 'after');
  s.addChild(list.id, -1, `[[${a}]]`);
  addDependency(s, c, b);
  expect(s.node(list.id).children.map((r) => s.node(r).text)).toEqual([`[[${a}]]`, `[[${b}]]`]);
  removeDependency(s, c, a);
  expect(dependencies(s, c)).toEqual([b]);
  removeDependency(s, c, b);
  expect(s.field(c, 'after')).toBeUndefined();
});

test('a dependency that would close a cycle is told apart', () => {
  const s = OutlineStore.create();
  const [a, b, c] = ['a', 'b', 'c'].map((t) => s.addChild(s.rootId, -1, t).id);
  addDependency(s, b, a);
  addDependency(s, c, b);
  expect(wouldCycle(s, a, c)).toBe(true); // c waits for b, which waits for a
  expect(wouldCycle(s, c, a)).toBe(false);
  expect(wouldCycle(s, a, a)).toBe(true);
});
