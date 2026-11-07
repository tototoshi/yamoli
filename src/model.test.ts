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
  s.addAttribute(c.id, 'k', 'v');
  s.addData(c.id, 'json', '{}');
  s.mergeInto(c.id, a.id);
  expect(a.text).toBe('ac');
  expect(a.attributes[0].key).toBe('k');
  expect(a.data[0].format).toBe('json');
  expect(s.get(c.id)).toBeUndefined();
  s.remove(a.id);
  expect(s.get(b.id)).toBeUndefined();
  expect(s.node(s.rootId).children).toEqual([]);
});

test('JSON round trip and normalization', () => {
  const s = OutlineStore.create();
  const a = s.addChild(s.rootId, -1, 'a');
  s.addAttribute(a.id, 'status', 'done');
  s.addData(a.id, 'markdown', '# hi');
  const back = OutlineStore.fromJSON(JSON.parse(JSON.stringify(s.toJSON())));
  expect(back.toJSON()).toEqual(s.toJSON());
  const loose = OutlineStore.fromJSON({ rootId: 'r', nodes: { r: { children: ['x', 'missing'] }, x: { text: 'x' } } });
  expect(loose.node('r').children).toEqual(['x']);
  expect(loose.node('x').attributes).toEqual([]);
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
  s.addAttribute(b.id, 'after', `[[${a.id}]], [[${other.id}]]`);
  s.addData(a.id, 'markdown', 'note');

  const copy = s.duplicate(p.id)!;
  expect(s.node(s.rootId).children).toEqual([p.id, copy.id, other.id]);
  expect(copy.text).toBe('project');
  expect(s.descendantCount(copy.id)).toBe(2);
  const [a2, b2] = copy.children;
  expect(a2).not.toBe(a.id);
  expect(s.parentOf(b2)).toBe(copy.id);
  expect(s.node(b2).attributes[0].value).toBe(`[[${a2}]], [[${other.id}]]`);
  expect(s.node(a2).data[0].content).toBe('note');
  expect(s.node(a2).data[0].id).not.toBe(s.node(a.id).data[0].id);
  // The original is untouched.
  expect(s.node(b.id).attributes[0].value).toBe(`[[${a.id}]], [[${other.id}]]`);
  expect(s.duplicate(s.rootId)).toBeNull();
});
