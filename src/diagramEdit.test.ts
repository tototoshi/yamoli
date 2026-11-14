import { expect, test } from 'vitest';
import { buildDiagram, layout } from './diagram';
import { boxAt, canConnect, connect, disconnect, dropAt, moveBox, setColor, setShape } from './diagramEdit';
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

  // Outside any frame: to the zoomed item, before the box it is dropped on.
  const free = drawing();
  ({ d, L } = free.draw());
  expect(dropAt(d, L, free.p, free.x, centre(L, free.b))).toEqual({ parent: free.p, before: free.b });
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
