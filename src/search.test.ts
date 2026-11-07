import { expect, test } from 'vitest';
import { OutlineStore } from './model';
import { matchNode, parseQuery, searchTree, wantsCompleted } from './search';

test('parseQuery handles words, phrases, attributes and negation', () => {
  expect(parseQuery('foo  -bar "two words" status:進行中 due: -tag:x')).toEqual([
    { negate: false, key: undefined, value: 'foo' },
    { negate: true, key: undefined, value: 'bar' },
    { negate: false, key: undefined, value: 'two words' },
    { negate: false, key: 'status', value: '進行中' },
    { negate: false, key: 'due', value: '' },
    { negate: true, key: 'tag', value: 'x' },
  ]);
  expect(parseQuery('   ')).toEqual([]);
  expect(parseQuery('ＡＢＣ')).toEqual([{ negate: false, key: undefined, value: 'abc' }]);
});

test('matchNode looks at text, attributes and data', () => {
  const s = OutlineStore.create();
  const n = s.addChild(s.rootId, -1, 'Buy Milk');
  s.addAttribute(n.id, 'Status', '進行中');
  s.addData(n.id, 'markdown', '# memo\nsecret word');
  const m = (q: string) => matchNode(n, parseQuery(q));
  expect(m('milk')).toBe(true);
  expect(m('ｍｉｌｋ')).toBe(true);
  expect(m('secret')).toBe(true);
  expect(m('進行')).toBe(true);
  expect(m('status:進行中')).toBe(true);
  expect(m('status:')).toBe(true);
  expect(m('status:完了')).toBe(false);
  expect(m('milk -secret')).toBe(false);
  expect(m('"buy milk"')).toBe(true);
  expect(m('"milk buy"')).toBe(false);
});

test('searchTree returns matches with their ancestors, inside collapsed nodes too', () => {
  const s = OutlineStore.create();
  const a = s.addChild(s.rootId, -1, 'a');
  const b = s.addChild(a.id, -1, 'b');
  const hit = s.addChild(b.id, -1, 'target');
  const other = s.addChild(s.rootId, -1, 'other');
  s.setCollapsed(a.id, true);
  const r = searchTree(s, s.rootId, parseQuery('target'));
  expect([...r.matches]).toEqual([hit.id]);
  expect(r.shown).toEqual(new Set([a.id, b.id, hit.id]));
  expect(r.shown.has(other.id)).toBe(false);
  // Scoped to the zoomed node: ancestors above the view are not included.
  expect(searchTree(s, b.id, parseQuery('target')).shown).toEqual(new Set([hit.id]));
});

test('is:done matches completed rows', () => {
  const s = OutlineStore.create();
  const n = s.addChild(s.rootId, -1, 'task');
  expect(matchNode(n, parseQuery('is:done'))).toBe(false);
  expect(matchNode(n, parseQuery('-is:done'))).toBe(true);
  s.setCompleted(n.id, true);
  expect(matchNode(n, parseQuery('is:done task'))).toBe(true);
  expect(matchNode(n, parseQuery('is:完了'))).toBe(true);
});

test('wantsCompleted only for a positive is:done term', () => {
  expect(wantsCompleted(parseQuery('task is:done'))).toBe(true);
  expect(wantsCompleted(parseQuery('-is:done'))).toBe(false);
  expect(wantsCompleted(parseQuery('task'))).toBe(false);
});
