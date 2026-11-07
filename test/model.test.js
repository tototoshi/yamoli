const test = require('node:test');
const assert = require('node:assert/strict');
const { OutlineStore } = require('../model.js');
const { Formats, markdown, parseCsv } = require('../formats.js');

function tree(s, id = s.rootId) {
  const n = s.get(id);
  return n.children.map((c) => (s.get(c).children.length ? [s.get(c).text, tree(s, c)] : s.get(c).text));
}

test('add, indent, outdent, move', () => {
  const s = OutlineStore.create();
  const a = s.addChild(s.rootId, -1, 'a');
  const b = s.addSiblingAfter(a.id, 'b');
  const c = s.addSiblingAfter(b.id, 'c');
  assert.equal(s.indent(a.id), false);
  assert.ok(s.indent(b.id));
  assert.ok(s.indent(c.id));
  assert.deepEqual(tree(s), [['a', ['b', 'c']]]);
  assert.ok(s.move(c.id, -1));
  assert.deepEqual(tree(s), [['a', ['c', 'b']]]);
  // outdent is blocked at the zoom boundary
  assert.equal(s.outdent(c.id, a.id), false);
  assert.ok(s.outdent(c.id));
  assert.deepEqual(tree(s), [['a', ['b']], 'c']);
  assert.deepEqual(s.path(b.id), [s.rootId, a.id, b.id]);
});

test('visible respects collapsed but not on the view root', () => {
  const s = OutlineStore.create();
  const a = s.addChild(s.rootId, -1, 'a');
  const b = s.addChild(a.id, -1, 'b');
  s.setCollapsed(a.id, true);
  assert.deepEqual(s.visible(s.rootId), [a.id]);
  assert.deepEqual(s.visible(a.id), [b.id]);
});

test('remove deletes subtree; merge moves meta', () => {
  const s = OutlineStore.create();
  const a = s.addChild(s.rootId, -1, 'a');
  const b = s.addChild(a.id, -1, 'b');
  const c = s.addSiblingAfter(a.id, 'c');
  s.addAttribute(c.id, 'k', 'v');
  s.addData(c.id, 'json', '{}');
  s.mergeInto(c.id, a.id);
  assert.equal(a.text, 'ac');
  assert.equal(a.attributes[0].key, 'k');
  assert.equal(a.data[0].format, 'json');
  assert.equal(s.get(c.id), undefined);
  s.remove(a.id);
  assert.equal(s.get(b.id), undefined);
  assert.deepEqual(s.get(s.rootId).children, []);
});

test('JSON round trip and normalization', () => {
  const s = OutlineStore.create();
  const a = s.addChild(s.rootId, -1, 'a');
  s.addAttribute(a.id, 'status', 'done');
  s.addData(a.id, 'markdown', '# hi');
  const back = OutlineStore.fromJSON(JSON.parse(JSON.stringify(s.toJSON())));
  assert.deepEqual(back.toJSON(), s.toJSON());
  const loose = OutlineStore.fromJSON({ rootId: 'r', nodes: { r: { children: ['x', 'missing'] }, x: { text: 'x' } } });
  assert.deepEqual(loose.get('r').children, ['x']);
  assert.deepEqual(loose.get('x').attributes, []);
  assert.throws(() => OutlineStore.fromJSON({}));
});

test('markdown rendering and escaping', () => {
  const html = markdown('# T\n\n- a\n  - b\n- [x] done\n\n**bold** `<x>` [l](javascript:alert(1)) <script>');
  assert.match(html, /<h1>T<\/h1>/);
  assert.match(html, /<li>a<ul><li>b<\/li><\/ul><\/li>/);
  assert.match(html, /checked/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<code>&lt;x&gt;<\/code>/);
  assert.match(html, /href="#"/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(markdown('|a|b|\n|-|-:|\n|1|2|'.replace(/-/g, '---')), /<td style="text-align:right">2<\/td>/);
});

test('json / csv formats', () => {
  assert.match(Formats.render('json', '{"a":1}'), /j-key/);
  assert.match(Formats.render('json', '{bad'), /fmt-error/);
  assert.deepEqual(parseCsv('a,"b,""c"""\n1,2\n'), [['a', 'b,"c"'], ['1', '2']]);
  assert.equal(Formats.get('nope').name, 'text');
});
