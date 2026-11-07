import { expect, test } from 'vitest';
import { blockers, dependencies, dependents, depStatus, findCycles } from './deps';
import { OutlineStore } from './model';

function project() {
  const s = OutlineStore.create();
  const design = s.addChild(s.rootId, -1, 'design');
  const api = s.addChild(s.rootId, -1, 'api');
  const ui = s.addChild(s.rootId, -1, 'ui');
  const release = s.addChild(s.rootId, -1, 'release');
  s.addAttribute(api.id, 'after', `[[${design.id}]]`);
  s.addAttribute(ui.id, 'After ', `[[${design.id}]]`); // key match ignores case/spaces
  s.addAttribute(release.id, 'after', `[[${api.id}]], [[${ui.id}]]`);
  s.addAttribute(release.id, 'after', `[[${api.id}]] [[missing]] [[${release.id}]]`);
  s.addAttribute(release.id, 'note', `[[${design.id}]]`); // not a dependency
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
  s.addAttribute(design.id, 'after', `[[${release.id}]]`); // design -> release -> api -> design
  const cycles = findCycles(s);
  expect(cycles).toEqual(new Set([design.id, api.id, ui.id, release.id]));
  expect(depStatus(s, api.id, cycles)).toBe('cycle');
});
