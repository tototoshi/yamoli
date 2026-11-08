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

test('search looks at text and fields (also nested, and blocks)', () => {
  const s = OutlineStore.create();
  const n = s.addChild(s.rootId, -1, 'Buy Milk');
  const status = s.addField(n.id, 'Status', '進行中');
  const budget = s.addField(n.id, 'budget');
  s.addField(budget.id, 'amount', '1200');
  const memo = s.addBlock(n.id, 'memo', 'markdown', '# memo\nsecret word');
  const found = (q: string) => [...searchTree(s, s.rootId, parseQuery(q)).matches];
  expect(found('milk')).toEqual([n.id]);
  expect(found('ｍｉｌｋ')).toEqual([n.id]);
  expect(found('secret')).toEqual([memo.id]); // like any field value, the block row itself
  expect(found('memo:secret')).toEqual([n.id]);
  expect(found('進行')).toEqual([status.id]); // the field row itself
  expect(found('status:進行中')).toEqual([n.id]); // the item that has the field
  expect(found('status:')).toEqual([n.id]);
  expect(found('status:完了')).toEqual([]);
  expect(found('budget.amount:12')).toEqual([n.id]);
  expect(found('budget:1200')).toEqual([n.id]); // a value anywhere inside the object
  expect(found('milk -memo:secret')).toEqual([]);
  expect(found('"buy milk"')).toEqual([n.id]);
  expect(found('"milk buy"')).toEqual([]);
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

test('is:ready / is:blocked / is:cycle use dependency status', () => {
  const s = OutlineStore.create();
  const a = s.addChild(s.rootId, -1, 'a');
  const b = s.addChild(s.rootId, -1, 'b');
  const c = s.addChild(s.rootId, -1, 'c');
  s.addField(b.id, 'after', `[[${a.id}]]`);
  const ids = (q: string) => [...searchTree(s, s.rootId, parseQuery(q)).matches];
  expect(ids('is:blocked')).toEqual([b.id]);
  expect(ids('is:ready')).toEqual([]);
  s.setCompleted(a.id, true);
  expect(ids('is:ready')).toEqual([b.id]);
  expect(ids('is:着手可')).toEqual([b.id]);
  s.setCompleted(b.id, true);
  expect(ids('is:ready')).toEqual([]); // completed rows are neither ready nor blocked
  s.addField(a.id, 'after', `[[${c.id}]]`);
  s.addField(c.id, 'after', `[[${a.id}]]`);
  expect(ids('is:cycle')).toEqual([a.id, c.id]);
});
