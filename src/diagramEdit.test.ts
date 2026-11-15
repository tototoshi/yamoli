import { expect, test } from 'vitest';
import { buildDiagram, layout } from './diagram';
import {
  boxAt,
  canConnect,
  connect,
  descOf,
  disconnect,
  dropAt,
  labelOf,
  lineKindOf,
  lineKinds,
  moveBox,
  neighbour,
  reconnect,
  setColor,
  setFontColor,
  setDesc,
  setLabel,
  setLineColor,
  lineColorOf,
  setLineKind,
  setShape,
  setSide,
  toggleBorder,
  group,
  ungroup,
} from './diagramEdit';
import { OutlineStore } from './model';

/** A zoomed item P with a box A, a frame F (lined up as `arrange` says) holding X, Y, Z, and a box B. */
function drawing(arrange?: string) {
  const s = OutlineStore.create();
  const p = s.addChild(s.rootId, -1, 'P').id;
  const add = (parent: string, text: string) => s.addChild(parent, -1, text).id;
  const a = add(p, 'A');
  const f = add(p, 'F');
  s.addField(f, 'shape', 'frame');
  if (arrange) s.addField(f, 'layout', arrange);
  const [x, y, z] = ['X', 'Y', 'Z'].map((t) => add(f, t));
  const b = add(p, 'B');
  const draw = () => {
    const d = buildDiagram(s, p);
    return { d, L: layout(d) };
  };
  return { s, p, a, f, x, y, z, b, draw };
}
const centre = (L: ReturnType<typeof layout>, id: string): [number, number] => {
  const b = L.boxes.get(id)!;
  return [b.x + b.w / 2, b.y + b.h / 2];
};

test('shape and colour are set as fields, and a plain box or no colour takes them away', () => {
  const { s, a } = drawing();
  setShape(s, a, 'db');
  setColor(s, a, 'blue');
  expect([s.fieldValue(a, 'shape'), s.fieldValue(a, 'color')]).toEqual(['db', 'blue']);
  setShape(s, a, 'frame');
  expect(s.fieldValue(a, 'shape')).toBe('frame');
  setShape(s, a, 'box');
  setColor(s, a, null);
  expect(s.node(a).children).toEqual([]);
});

test('a border word turns on and off, in place of one saying the same thing', () => {
  const { s, a, b } = drawing();
  toggleBorder(s, a, 'dashed');
  toggleBorder(s, a, 'thick');
  expect(s.fieldValue(a, 'border')).toBe('dashed thick');
  toggleBorder(s, a, 'dotted');
  expect(s.fieldValue(a, 'border')).toBe('thick dotted');
  toggleBorder(s, a, 'none');
  expect(s.fieldValue(a, 'border')).toBe('thick none');
  toggleBorder(s, a, 'none');
  toggleBorder(s, a, 'thick');
  expect(s.field(a, 'border')).toBeUndefined();
  // Written in Japanese, with a colour: the same word in English turns it off, the rest stay.
  s.addField(b, '枠線', '太 赤 red');
  toggleBorder(s, b, 'thick');
  expect(s.fieldValue(b, '枠線')).toBe('赤 red');
});

test('lining up a frame keeps it drawn as it was; a plain box lined up is unseen', () => {
  const { s, a } = drawing();
  setShape(s, a, 'row');
  expect(s.fieldValue(a, 'shape')).toBe('row');
  s.setField(a, 'shape', 'frame solid');
  setShape(s, a, 'column');
  expect(s.fieldValue(a, 'shape')).toBe('column frame solid');
  setShape(s, a, 'grid');
  expect(s.fieldValue(a, 'shape')).toBe('grid frame solid');
});

test('an arrow drawn is a link in `to`; removing it takes out the links it is drawn from', () => {
  const { s, a, b, x, draw } = drawing();
  connect(s, a, b);
  connect(s, a, b); // once
  connect(s, a, x);
  expect(s.fieldValue(a, 'to')).toBe(`[[${b}]], [[${x}]]`);
  const edge = draw().d.edges.find((e) => e.from === a && e.to === b)!;
  disconnect(s, edge);
  expect(s.fieldValue(a, 'to')).toBe(`[[${x}]]`);
  // An `after` arrow comes out of `after`.
  s.addField(b, 'after', `[[${a}]]`);
  disconnect(
    s,
    draw().d.edges.find((e) => e.from === a && e.to === b)!
  );
  expect(s.field(b, 'after')).toBeUndefined();
});

test('arrows join boxes, not a box and the frame around it', () => {
  const { a, f, x, y, draw } = drawing();
  const { d } = draw();
  expect(canConnect(d, x, y)).toBe(true);
  expect(canConnect(d, a, f)).toBe(true);
  expect(canConnect(d, x, f)).toBe(false);
  expect(canConnect(d, f, x)).toBe(false);
  expect(canConnect(d, x, x)).toBe(false);
});

test('the box under a point is the smallest: a box in a frame rather than the frame', () => {
  const { f, x, draw } = drawing();
  const { L } = draw();
  expect(boxAt(L, centre(L, x))).toBe(x);
  const fb = L.boxes.get(f)!;
  expect(boxAt(L, [fb.x + 2, fb.y + 2])).toBe(f);
  expect(boxAt(L, [-50, -50])).toBeNull();
});

test('a box dropped in a lined-up frame goes in where it falls; elsewhere, before the box it is on', () => {
  const row = drawing('row');
  let { d, L } = row.draw();
  // Between X and Y: before Y.
  const between: [number, number] = [(centre(L, row.x)[0] + centre(L, row.y)[0]) / 2, centre(L, row.x)[1]];
  expect(dropAt(d, L, row.p, row.a, between)).toEqual({ parent: row.f, before: row.y });
  expect(moveBox(row.s, row.a, dropAt(d, L, row.p, row.a, between)!)).toBe(true);
  expect(row.s.items(row.f)).toEqual([row.x, row.a, row.y, row.z]);

  // Past the last: at the end. Dropped on itself or where it is: no move.
  ({ d, L } = row.draw());
  const fb = L.boxes.get(row.f)!;
  expect(dropAt(d, L, row.p, row.y, [fb.x + fb.w - 4, centre(L, row.z)[1]])).toEqual({ parent: row.f, before: null });
  expect(dropAt(d, L, row.p, row.y, centre(L, row.y))).toBeNull(); // back on itself

  // Outside any frame: to the zoomed item, before the box it is dropped on the edge of.
  const free = drawing();
  ({ d, L } = free.draw());
  const bb = L.boxes.get(free.b)!;
  expect(dropAt(d, L, free.p, free.x, [bb.x + 4, bb.y + bb.h / 2])).toEqual({ parent: free.p, before: free.b });
  // In empty space of the frame it is already in (laid out along arrows): stays.
  const fb2 = L.boxes.get(free.f)!;
  expect(dropAt(d, L, free.p, free.x, [fb2.x + 4, fb2.y + fb2.h - 4])).toBeNull();
  // A frame isn't dropped into itself.
  expect(dropAt(d, L, free.p, free.f, centre(L, free.x))).toBeNull();
  // Into another frame, laid out along arrows: at its end.
  const other = drawing();
  const g = other.s.addChild(other.p, -1, 'G').id;
  other.s.addField(g, 'shape', 'frame');
  ({ d, L } = other.draw());
  const gb = L.boxes.get(g)!;
  expect(dropAt(d, L, other.p, other.x, [gb.x + gb.w / 2, gb.y + gb.h - 4])).toEqual({ parent: g, before: null });
});

test('a grid takes a box before the one it falls on the left of, row by row', () => {
  const g = drawing('grid 2'); // X Y / Z
  const { d, L } = g.draw();
  const [zx, zy] = centre(L, g.z);
  expect(dropAt(d, L, g.p, g.a, [zx - 20, zy])).toEqual({ parent: g.f, before: g.z });
  const [yx, yy] = centre(L, g.y);
  expect(dropAt(d, L, g.p, g.a, [yx + 30, yy])).toEqual({ parent: g.f, before: g.z }); // after Y: the next row's first
});

test('a box dropped on the middle of a plain box goes inside it, which becomes a container until it is empty', () => {
  const { s, p, a, b, x, draw } = drawing();
  let { d, L } = draw();
  const drop = dropAt(d, L, p, a, centre(L, b))!;
  expect(drop).toEqual({ parent: b, before: null, nest: true });
  expect(moveBox(s, a, drop)).toBe(true);
  expect(s.items(b)).toEqual([a]);
  expect(s.fieldValue(b, 'shape')).toBe('container');
  ({ d, L } = draw());
  expect(d.nodes.get(b)).toMatchObject({ isFrame: true, frame: 'box', children: [a] });
  const inner = L.boxes.get(a)!;
  const outer = L.boxes.get(b)!;
  expect(inner.x > outer.x && inner.x + inner.w < outer.x + outer.w).toBe(true);
  // Not into a box inside the one dragged, nor into a database.
  expect(dropAt(d, L, p, b, centre(L, a))).toBeNull();
  s.setField(x, 'shape', 'db');
  ({ d, L } = draw());
  expect(dropAt(d, L, p, a, centre(L, x))?.nest).toBeUndefined();

  // Moved out again: a box once more.
  expect(moveBox(s, a, { parent: p, before: null })).toBe(true);
  expect(s.field(b, 'shape')).toBeFalsy();
});

test('a description is written to the field it is read from, else a note; lines make a text block', () => {
  const { s, a, b } = drawing();
  setDesc(s, a, 'Sends mail');
  expect(s.fieldValue(a, 'note')).toBe('Sends mail');
  setDesc(s, a, 'Sends mail\nat night');
  expect(s.field(a, 'note')).toMatchObject({ format: 'text', text: 'Sends mail\nat night' });
  expect(descOf(s, a)).toBe('Sends mail\nat night');
  setDesc(s, a, '  ');
  expect(s.field(a, 'note')).toBeFalsy();

  s.addField(b, 'description', 'old');
  setDesc(s, b, 'new');
  expect(s.fieldValue(b, 'description')).toBe('new');
  expect(s.field(b, 'note')).toBeFalsy();
});

test('an arrow is joined to another box: the link points there, or moves there with its words', () => {
  const { s, a, b, x, y, draw } = drawing();
  s.addField(a, 'to', `[[${b}]] HTTPS`);
  const edge = (from: string, to: string) => draw().d.edges.find((e) => e.from === from && e.to === to)!;

  // The head: the link now points to X, words and all.
  expect(reconnect(s, draw().d, edge(a, b), 'to', x)).toBe(true);
  expect(s.fieldValue(a, 'to')).toBe(`[[${x}]] HTTPS`);
  // The tail: the link moves to Y's `to`, and A is left without one.
  expect(reconnect(s, draw().d, edge(a, x), 'from', y)).toBe(true);
  expect(s.field(a, 'to')).toBeFalsy();
  expect(s.fieldValue(y, 'to')).toBe(`[[${x}]] HTTPS`);
  // Onto a box already linked: the old link goes rather than doubling.
  s.addField(b, 'to', `[[${x}]], [[${a}]]`);
  expect(reconnect(s, draw().d, edge(b, a), 'to', x)).toBe(true);
  expect(s.fieldValue(b, 'to')).toBe(`[[${x}]]`);
  // Where it is: nothing to do.
  expect(reconnect(s, draw().d, edge(b, x), 'to', x)).toBe(false);
});

test('a dependency arrow moves its `after`, unless it would go round', () => {
  const { s, a, b, x, draw } = drawing();
  s.addField(b, 'after', `[[${a}]]`); // A → B
  s.addField(a, 'after', `[[${x}]]`); // X → A
  const edge = (from: string, to: string) => draw().d.edges.find((e) => e.from === from && e.to === to)!;
  // Its head to X: X after A, which is after X.
  expect(reconnect(s, draw().d, edge(a, b), 'to', x)).toBe(false);
  expect(s.fieldValue(b, 'after')).toBe(`[[${a}]]`);
  // Its tail to X: B after X instead.
  expect(reconnect(s, draw().d, edge(a, b), 'from', x)).toBe(true);
  expect(s.fieldValue(b, 'after')).toBe(`[[${x}]]`);
});

test("an arrow's kind is the field it is written in: changing it moves the link, words and all", () => {
  const { s, p, a, b, x, draw } = drawing();
  s.addField(a, 'to', `[[${b}]] HTTPS, [[${x}]]`);
  const lines = s.addField(p, 'lines').id;
  s.addChild(lines, -1, 'dotted red').key = 'calls';
  expect(lineKinds(s, p)).toEqual(['to', 'async', 'both', 'link', 'calls']);
  const edge = () => draw().d.edges.find((e) => e.to === b)!;
  expect(lineKindOf(s, edge())).toBe('to');

  expect(setLineKind(s, edge(), 'async')).toBe(true);
  expect(s.fieldValue(a, 'to')).toBe(`[[${x}]]`);
  expect(s.fieldValue(a, 'async')).toBe(`[[${b}]] HTTPS`);
  expect(edge().style.dash).toBe('dashed');
  expect(setLineKind(s, edge(), 'async')).toBe(false);

  // A dependency stays one.
  s.addField(x, 'after', `[[${b}]]`);
  const dep = draw().d.edges.find((e) => e.from === b && e.to === x)!;
  expect(lineKindOf(s, dep)).toBe('after');
  expect(setLineKind(s, dep, 'to')).toBe(false);
});

test('in a mind map the arrow keys go along the branches, turned with the direction', () => {
  const s = OutlineStore.create();
  const p = s.addChild(s.rootId, -1, 'P').id;
  const [a, b] = ['A', 'B'].map((x) => s.addChild(p, -1, x).id);
  const a1 = s.addChild(a, -1, 'A1').id;
  const d = buildDiagram(s, p, { kind: 'tree' });
  expect(neighbour(d, p, 'ArrowRight')).toBe(a);
  expect(neighbour(d, a, 'ArrowDown')).toBe(b);
  expect(neighbour(d, b, 'ArrowUp')).toBe(a);
  expect(neighbour(d, a, 'ArrowRight')).toBe(a1);
  expect(neighbour(d, a1, 'ArrowLeft')).toBe(a);
  expect(neighbour(d, p, 'ArrowLeft')).toBeNull();
  expect(neighbour(d, b, 'ArrowDown')).toBeNull();
  s.addField(p, 'direction', 'TB');
  const down = buildDiagram(s, p, { kind: 'tree' });
  expect(neighbour(down, p, 'ArrowDown')).toBe(a);
  expect(neighbour(down, a, 'ArrowRight')).toBe(b);
});

test("an arrow's label is the words beside its link: written there, a comma kept from splitting the field", () => {
  const { s, a, b, x, draw } = drawing();
  s.addField(a, 'to', `[[${b}]] HTTPS, [[${x}]]`);
  const edge = (to: string) => draw().d.edges.find((e) => e.from === a && e.to === to)!;
  expect(labelOf(s, edge(b))).toBe('HTTPS');
  expect(setLabel(s, edge(b), 'gRPC, TLS')).toBe(true);
  expect(s.fieldValue(a, 'to')).toBe(`[[${b}]] gRPC、TLS, [[${x}]]`);
  expect(edge(b).label).toBe('gRPC、TLS');
  expect(setLabel(s, edge(x), 'events')).toBe(true);
  expect(s.fieldValue(a, 'to')).toBe(`[[${b}]] gRPC、TLS, [[${x}]] events`);
  // Cleared: no words, and a field's own name shows again.
  s.addField(b, 'calls', `[[${x}]] sync`);
  const calls = () => draw().d.edges.find((e) => e.from === b)!;
  expect(setLabel(s, calls(), '')).toBe(true);
  expect(s.fieldValue(b, 'calls')).toBe(`[[${x}]]`);
  expect(calls().label).toBe('calls');
  expect(labelOf(s, calls())).toBe('');
});

test('boxes selected together go into a line-up where the first was, in outline order, and come out again', () => {
  const { s, p, a, f, x, z, b } = drawing();
  const texts = (id: string) => s.items(id).map((c) => s.node(c).text);
  // Picked in any order, and Z twice over (with its frame): the frame takes it along.
  const g = group(s, [b, z, a, f], 'column', 'Column')!;
  expect(texts(p)).toEqual(['Column']);
  expect(texts(g)).toEqual(['A', 'F', 'B']);
  expect(s.fieldValue(g, 'shape')).toBe('column');
  expect(s.items(f)).toContain(z);
  expect(group(s, [x], 'row', 'Row')).toBeNull(); // one box is no line-up
  expect(group(s, [x], 'frame', 'Group')).not.toBeNull(); // but can be framed

  ungroup(s, g);
  expect(texts(p)).toEqual(['A', 'F', 'B']);
});

test('the ends of an arrow are pinned to sides beside its link, kept by its label and dropped when moved', () => {
  const { s, a, b, x, draw } = drawing();
  s.addField(a, 'to', `[[${b}]] HTTPS`);
  const edge = (from: string, to: string) => draw().d.edges.find((e) => e.from === from && e.to === to)!;
  expect(setSide(s, edge(a, b), 'to', 'top')).toBe(true);
  expect(s.fieldValue(a, 'to')).toMatch(/^\[\[\w+\]\] HTTPS @(上|top)$/);
  expect(edge(a, b)).toMatchObject({ label: 'HTTPS', sides: { to: 'top' } });
  setSide(s, edge(a, b), 'from', 'bottom');
  expect(edge(a, b).sides).toEqual({ from: 'bottom', to: 'top' });
  // A new label keeps the sides; the label read back is without them.
  setLabel(s, edge(a, b), 'gRPC');
  expect(labelOf(s, edge(a, b))).toBe('gRPC');
  expect(edge(a, b)).toMatchObject({ label: 'gRPC', sides: { from: 'bottom', to: 'top' } });
  // Joined to another box, that end faces it again; the other stays pinned.
  reconnect(s, draw().d, edge(a, b), 'to', x);
  expect(edge(a, x).sides).toEqual({ from: 'bottom' });
  setSide(s, edge(a, x), 'from', null);
  expect(s.fieldValue(a, 'to')).toBe(`[[${x}]] gRPC`);
});

test('an arrow has a look of its own in braces beside its link: a colour set there, kept by its label and sides', () => {
  const { s, a, b, x, draw } = drawing();
  s.addField(a, 'to', `[[${b}]] HTTPS, [[${x}]] {dashed}`);
  s.addField(a, 'async', `[[${b}]] events`);
  const edges = () => draw().d.edges;
  const edge = (to: string, label = '') => edges().find((e) => e.to === to && (!label || e.label === label))!;
  expect(edge(x).style).toEqual({ dash: 'dashed', ends: 'arrow' });
  expect(edge(x).label).toBe('');
  expect(setLineColor(s, edge(b, 'HTTPS'), 'red')).toBe(true);
  expect(s.fieldValue(a, 'to')).toBe(`[[${b}]] HTTPS {red}, [[${x}]] {dashed}`);
  expect(edge(b, 'HTTPS').style).toEqual({ dash: 'solid', ends: 'arrow', color: '#d9534f' });
  expect(lineColorOf(edge(b, 'HTTPS'))).toBe('red');
  // Over its kind's look: an async arrow stays dashed in blue.
  setLineColor(s, edge(b, 'events'), 'blue');
  expect(edge(b, 'events').style).toMatchObject({ dash: 'dashed', color: '#3b6fd8' });
  // A new colour replaces the old, and other look words stay.
  setLineColor(s, edge(x), 'green');
  expect(s.fieldValue(a, 'to')).toBe(`[[${b}]] HTTPS {red}, [[${x}]] {dashed green}`);
  // The label and sides keep it.
  setLabel(s, edge(b, 'HTTPS'), 'gRPC');
  setSide(s, edge(b, 'gRPC'), 'to', 'top');
  expect(edge(b, 'gRPC').look).toBe('red');
  // Its kind's colour again: the braces go when nothing is left in them.
  setLineColor(s, edge(b, 'gRPC'), null);
  setLineColor(s, edge(x), null);
  expect(s.fieldValue(a, 'to')).toMatch(new RegExp(`^\\[\\[${b}\\]\\] gRPC @(上|top), \\[\\[${x}\\]\\] \\{dashed\\}$`));
  expect(lineColorOf(edge(x))).toBeUndefined();
});

test("a box's text is coloured from font (or 文字色, where it has that), its description and fields paler", () => {
  const { s, a, b, draw } = drawing();
  const font = (id: string) => draw().d.nodes.get(id)!.font;
  setFontColor(s, a, 'red');
  expect(s.fieldValue(a, 'font')).toBe('red');
  expect(font(a)).toEqual({
    name: '#d9534f',
    desc: 'color-mix(in srgb, #d9534f 80%, var(--bg))',
    props: 'color-mix(in srgb, #d9534f 55%, var(--bg))',
  });
  expect(draw().d.nodes.get(a)!.props).toEqual([]);
  setFontColor(s, a, null);
  expect(s.node(a).children).toEqual([]);
  s.addField(b, '文字色', '#123456');
  expect(font(b)!.name).toBe('#123456');
  setFontColor(s, b, 'blue');
  expect(s.fieldValue(b, '文字色')).toBe('blue');
});
