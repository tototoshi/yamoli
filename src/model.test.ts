import { expect, test } from 'vitest';
import { OutlineStore } from './model';

type Tree = (string | [string, Tree])[];
function tree(s: OutlineStore, id = s.rootId): Tree {
  return s.node(id).children.map((c) => (s.node(c).children.length ? [s.node(c).text, tree(s, c)] : s.node(c).text));
}

test('add, indent, outdent, move', () => {
  const s = OutlineStore.create();
  const a = s.addChild(s.rootId, -1, 'a');
  const b = s.addSiblingAfter(a.id, 'b');
  const c = s.addSiblingAfter(b.id, 'c');
  expect(s.indent(a.id)).toBe(false);
  expect(s.indent(b.id)).toBe(true);
  expect(s.indent(c.id)).toBe(true);
  expect(tree(s)).toEqual([['a', ['b', 'c']]]);
  expect(s.move(c.id, -1)).toBe(true);
  expect(tree(s)).toEqual([['a', ['c', 'b']]]);
  // outdent is blocked at the zoom boundary
  expect(s.outdent(c.id, a.id)).toBe(false);
  expect(s.outdent(c.id)).toBe(true);
  expect(tree(s)).toEqual([['a', ['b']], 'c']);
  expect(s.path(b.id)).toEqual([s.rootId, a.id, b.id]);
});

test('visible respects collapsed but not on the view root', () => {
  const s = OutlineStore.create();
  const a = s.addChild(s.rootId, -1, 'a');
  const b = s.addChild(a.id, -1, 'b');
  s.setCollapsed(a.id, true);
  expect(s.visible(s.rootId)).toEqual([a.id]);
  expect(s.visible(a.id)).toEqual([b.id]);
});

test('remove deletes subtree; merge moves meta', () => {
  const s = OutlineStore.create();
  const a = s.addChild(s.rootId, -1, 'a');
  const b = s.addChild(a.id, -1, 'b');
  const c = s.addSiblingAfter(a.id, 'c');
  s.addField(c.id, 'k', 'v');
  s.addBlock(c.id, 'memo', 'markdown', '# hi');
  s.mergeInto(c.id, a.id);
  expect(a.text).toBe('ac');
  expect(s.fieldValue(a.id, 'k')).toBe('v');
  expect(s.field(a.id, 'memo')?.format).toBe('markdown');
  expect(s.get(c.id)).toBeUndefined();
  s.remove(a.id);
  expect(s.get(b.id)).toBeUndefined();
  expect(s.node(s.rootId).children).toEqual([]);
});

test('JSON round trip and normalization', () => {
  const s = OutlineStore.create();
  const a = s.addChild(s.rootId, -1, 'a');
  s.addField(a.id, 'status', 'done');
  s.addBlock(a.id, 'note', 'markdown', '# hi');
  const back = OutlineStore.fromJSON(JSON.parse(JSON.stringify(s.toJSON())));
  expect(back.toJSON()).toEqual(s.toJSON());
  const loose = OutlineStore.fromJSON({ rootId: 'r', nodes: { r: { children: ['x', 'missing'] }, x: { text: 'x' } } });
  expect(loose.node('r').children).toEqual(['x']);
  expect(loose.node('x').key).toBeNull();
  expect(loose.node('x').completed).toBe(false);
  expect(() => OutlineStore.fromJSON({})).toThrow();
});

test('moveTo places a subtree before a sibling or at the end, never inside itself', () => {
  const s = OutlineStore.create();
  const a = s.addChild(s.rootId, -1, 'a');
  const a1 = s.addChild(a.id, -1, 'a1');
  const b = s.addChild(s.rootId, -1, 'b');
  const c = s.addChild(s.rootId, -1, 'c');
  s.setCollapsed(a.id, true);

  expect(s.moveTo(c.id, s.rootId, a.id)).toBe(true);
  expect(tree(s)).toEqual(['c', ['a', ['a1']], 'b']);
  // Into a collapsed node expands it.
  expect(s.moveTo(b.id, a.id, null)).toBe(true);
  expect(tree(s)).toEqual(['c', ['a', ['a1', 'b']]]);
  expect(s.node(a.id).collapsed).toBe(false);
  // Same position, into itself, into a descendant: refused.
  expect(s.moveTo(b.id, a.id, null)).toBe(false);
  expect(s.moveTo(a1.id, a.id, b.id)).toBe(false);
  expect(s.moveTo(a.id, a.id, null)).toBe(false);
  expect(s.moveTo(a.id, a1.id, null)).toBe(false);
  // Reordering within the same parent.
  expect(s.moveTo(b.id, a.id, a1.id)).toBe(true);
  expect(tree(s)).toEqual(['c', ['a', ['b', 'a1']]]);
  expect(s.parentOf(b.id)).toBe(a.id);
});

test('duplicate copies a subtree after the original and relinks inside it', () => {
  const s = OutlineStore.create();
  const p = s.addChild(s.rootId, -1, 'project');
  const other = s.addChild(s.rootId, -1, 'other');
  const a = s.addChild(p.id, -1, 'a');
  const b = s.addChild(p.id, -1, 'b');
  s.addField(b.id, 'after', `[[${a.id}]], [[${other.id}]]`);
  s.addBlock(a.id, 'note', 'markdown', 'note');

  const copy = s.duplicate(p.id)!;
  expect(s.node(s.rootId).children).toEqual([p.id, copy.id, other.id]);
  expect(copy.text).toBe('project');
  expect(s.descendantCount(copy.id)).toBe(4); // a, its note, b and b's `after` field
  const [a2, b2] = copy.children;
  expect(a2).not.toBe(a.id);
  expect(s.parentOf(b2)).toBe(copy.id);
  expect(s.fieldValue(b2, 'after')).toBe(`[[${a2}]], [[${other.id}]]`);
  expect(s.field(a2, 'note')).toMatchObject({ text: 'note', format: 'markdown' });
  expect(s.field(a2, 'note')!.id).not.toBe(s.field(a.id, 'note')!.id);
  // The original is untouched.
  expect(s.fieldValue(b.id, 'after')).toBe(`[[${a.id}]], [[${other.id}]]`);
  expect(s.duplicate(s.rootId)).toBeNull();
});

test('fields: rows with a key, nested objects and lists, kept above sub-items', () => {
  const s = OutlineStore.create();
  const p = s.addChild(s.rootId, -1, 'project').id;
  const task = s.addChild(p, -1, 'design').id;
  s.addField(p, 'start', '2026-11-09');
  const budget = s.addField(p, 'budget').id;
  s.addField(budget, 'amount', '1200000');
  const links = s.addField(p, 'links').id;
  const link = s.addChild(links, -1, 'https://example.com').id;

  expect(s.node(p).children).toEqual([s.field(p, 'start')!.id, budget, links, task]);
  expect(s.items(p)).toEqual([task]);
  expect(s.fieldValue(p, ' START ')).toBe('2026-11-09');
  expect(s.fieldAt(p, ['budget', 'amount'])?.text).toBe('1200000');
  expect(s.fieldTexts(links)).toEqual(['', '', 'https://example.com']);
  expect([s.isData(task), s.isData(budget), s.isData(link)]).toEqual([false, true, true]);
  expect(s.owner(link)).toBe(p);
});

test('attributes from older files become field rows', () => {
  const s = OutlineStore.fromJSON({
    rootId: 'r',
    nodes: {
      r: { children: ['a'] },
      a: { text: 'a', children: ['b'], attributes: [{ id: 'x', key: 'due', value: '2026-12-01' }] },
      b: { text: 'b' },
    },
  });
  const [f, b] = s.node('a').children;
  expect(b).toBe('b');
  expect(s.node(f)).toMatchObject({ key: 'due', text: '2026-12-01' });
  expect(s.fieldValue('a', 'due')).toBe('2026-12-01');
});

test('data blocks from older files become blocks; JSON becomes fields', () => {
  const s = OutlineStore.fromJSON({
    rootId: 'r',
    nodes: {
      r: { children: ['a'] },
      a: {
        text: 'a',
        children: ['b'],
        key: null,
        data: [
          { id: 'd1', format: 'markdown', content: '# memo', collapsed: true },
          { id: 'd2', format: 'markdown', content: 'more' },
          { id: 'd3', format: 'json', content: '{"theme":"auto","size":15,"tags":["x","y"],"opt":{"on":true}}' },
          { id: 'd4', format: 'json', content: '{broken' },
        ],
      },
      b: { text: 'b' },
    },
  });
  const a = s.node('a');
  expect(a.children.map((c) => s.node(c).key)).toEqual(['markdown', 'markdown2', 'json', 'json2', null]);
  expect(s.field('a', 'markdown')).toMatchObject({ text: '# memo', format: 'markdown', collapsed: true });
  expect(s.field('a', 'json2')).toMatchObject({ text: '{broken', format: 'code' });
  const json = s.field('a', 'json')!;
  expect(json.format).toBeNull();
  expect(s.fieldValue(json.id, 'size')).toBe('15');
  expect(s.fieldTexts(s.field(json.id, 'tags')!.id)).toEqual(['', '', 'x', '', 'y']);
  expect(s.fieldAt('a', ['json', 'opt', 'on'])?.text).toBe('true');
  expect('data' in a).toBe(false);
});
