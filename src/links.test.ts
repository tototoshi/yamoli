import { expect, test } from 'vitest';
import { findBacklinks, linkCandidates, nodeLabel, pickerQueryAt, refIds } from './links';
import { OutlineStore } from './model';

function sample() {
  const s = OutlineStore.create();
  const design = s.addChild(s.rootId, -1, '**設計** レビュー');
  const api = s.addChild(s.rootId, -1, 'API 実装');
  const test = s.addChild(api.id, -1, `テスト ([[${api.id}]] の後)`);
  s.addField(test.id, 'after', `[[${design.id}]], [[${api.id}]]`);
  s.addChild(s.rootId, -1, '');
  return { s, design, api, test };
}

test('refIds extracts every [[id]]', () => {
  expect(refIds('a [[x1]] b [[y2]] [[ not a ref ]]')).toEqual(['x1', 'y2']);
});

test('findBacklinks finds links in text and attribute values', () => {
  const { s, design, api, test } = sample();
  expect(findBacklinks(s, api.id)).toEqual([
    { nodeId: test.id, via: null },
    { nodeId: test.id, via: 'after' },
  ]);
  expect(findBacklinks(s, design.id)).toEqual([{ nodeId: test.id, via: 'after' }]);
  expect(findBacklinks(s, test.id)).toEqual([]);
});

test('nodeLabel resolves links and strips markup', () => {
  const { s, design, test } = sample();
  expect(nodeLabel(s, design.id)).toBe('設計 レビュー');
  expect(nodeLabel(s, test.id)).toBe('テスト (API 実装 の後)');
  expect(nodeLabel(s, 'missing')).toBe('');
});

test('linkCandidates ranks prefix matches first and skips self, root and empty rows', () => {
  const { s, design, api, test } = sample();
  expect(linkCandidates(s, '', test.id)).toEqual([api.id, design.id]); // its parent is nearer
  expect(linkCandidates(s, 'api', design.id)).toEqual([api.id, test.id]);
  expect(linkCandidates(s, 'ＡＰＩ', design.id)[0]).toBe(api.id);
  expect(linkCandidates(s, 'nothing', design.id)).toEqual([]);
});

test('linkCandidates puts nearby items first, those above before those below', () => {
  const s = OutlineStore.create();
  const add = (parent: string, text: string) => s.addChild(parent, -1, text).id;
  const far = add(s.rootId, 'far');
  const phase = add(s.rootId, 'phase');
  const a = add(phase, 'a');
  const b = add(phase, 'b');
  const kid = add(b, 'kid');
  const c = add(phase, 'c');
  const after = s.addField(b, 'after', '[[').id;
  // From the field: its item b is excluded; its parent and child are one step away.
  expect(linkCandidates(s, '', after)).toEqual([phase, kid, a, c, far]);
  // As dependencies, b's own parent and child are left out.
  expect(linkCandidates(s, '', after, { deps: true })).toEqual([a, c, far]);
});

test('pickerQueryAt detects an open [[ before the caret', () => {
  expect(pickerQueryAt('see [[設計', 8)).toEqual({ from: 4, query: '設計' });
  expect(pickerQueryAt('see [[', 6)).toEqual({ from: 4, query: '' });
  expect(pickerQueryAt('see [[x]] ok', 12)).toBeNull();
  expect(pickerQueryAt('no link', 7)).toBeNull();
});
