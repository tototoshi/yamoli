import { expect, test } from 'vitest';
import { findBacklinks, keyCandidates, linkCandidates, nodeLabel, pickerQueryAt, refIds, valueCandidates } from './links';
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

test('field names in use are offered by prefix, then by how often they are used', () => {
  const s = OutlineStore.create();
  for (const t of ['a', 'b', 'c']) {
    const id = s.addChild(s.rootId, -1, t).id;
    s.addField(id, 'status', 'active');
  }
  const x = s.addChild(s.rootId, -1, 'x').id;
  s.addField(x, 'start', '2026-11-10');
  s.addField(x, 'first', '1');
  s.addField(x, 'last', '1');
  expect(keyCandidates(s, 'st')).toEqual(['status', 'start', 'first', 'last']);
  expect(keyCandidates(s, 'status')).toEqual([]);
  expect(keyCandidates(s, '')[0]).toBe('status');
});

test('values a field name already has are offered, leaving out links and nested fields', () => {
  const s = OutlineStore.create();
  const add = (text: string, status: string) => s.addField(s.addChild(s.rootId, -1, text).id, 'status', status);
  add('a', '進行中');
  add('b', '完了');
  add('c', '完了');
  add('d', '[[a]]');
  const nested = add('e', '');
  s.addField(nested.id, 'detail', 'x');
  expect(valueCandidates(s, 'status', '')).toEqual(['完了', '進行中']);
  expect(valueCandidates(s, 'Status', '進')).toEqual(['進行中']);
  expect(valueCandidates(s, 'status', '完了')).toEqual([]);
});
