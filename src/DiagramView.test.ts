// @vitest-environment jsdom
import { expect, test } from 'vitest';
import { buildDiagram, estimate, layout, type Box } from './diagram';
import { aroundBoxes, route, routeAll, Taken } from './DiagramView';
import { OutlineStore } from './model';

const box = (x: number, y: number, w = 100, h = 50): Box => ({ x, y, w, h, frame: false });

test('a pinned arrow goes around the boxes in its way, at right angles, clear of them', () => {
  // From the bottom of A to the bottom of B, with C sitting between them.
  const [a, b, c] = [box(0, 0), box(400, 0), box(200, -20, 100, 120)];
  const r = aroundBoxes({ p: [50, 50], out: [0, 1] }, { p: [450, 50], out: [0, 1] }, [a, b, c])!;
  expect(r.ends).toEqual([
    [50, 50],
    [450, 50],
  ]);
  r.pts.slice(1).forEach((p, i) => {
    const q = r.pts[i];
    expect(p[0] === q[0] || p[1] === q[1]).toBe(true); // straight across or down
    // No stretch runs through C.
    const [x1, x2, y1, y2] = [Math.min(p[0], q[0]), Math.max(p[0], q[0]), Math.min(p[1], q[1]), Math.max(p[1], q[1])];
    expect(x2 > c.x && x1 < c.x + c.w && y2 > c.y && y1 < c.y + c.h).toBe(false);
  });
  expect(r.pts.length).toBe(4); // down, across under C, up
});

test('a second line going round the same box keeps off the first, side by side rather than on top', () => {
  const [a, b, c] = [box(0, 0), box(400, 0), box(200, -20, 100, 120)];
  const taken = new Taken();
  const go = () => aroundBoxes({ p: [50, 50], out: [0, 1] }, { p: [450, 50], out: [0, 1] }, [a, b, c], taken)!;
  const first = go();
  taken.add(first.pts);
  const second = go();
  const under = (r: typeof first) => Math.max(...r.pts.map((p) => p[1]));
  expect(Math.abs(under(second) - under(first))).toBeGreaterThanOrEqual(7);
  expect(taken.free([0, under(first)], [500, under(first)])).toBe(false);
  expect(taken.free([0, under(first) + 8], [500, under(first) + 8])).toBe(true);
});

test('lines crossing are counted, lines only touching are not', () => {
  const taken = new Taken();
  taken.add([
    [100, 0],
    [100, 100],
  ]);
  expect(
    taken.crossings([
      [0, 50],
      [200, 50],
    ])
  ).toBe(1);
  expect(
    taken.crossings([
      [0, 100],
      [200, 100],
    ])
  ).toBe(0);
  expect(
    taken.crossings([
      [0, 150],
      [200, 150],
    ])
  ).toBe(0);
});

test('a line going around a box takes a little longer way rather than cross another', () => {
  const [a, b, c] = [box(0, 0), box(400, 0), box(200, -20, 100, 120)];
  const go = (taken?: Taken) => aroundBoxes({ p: [50, 50], out: [0, 1] }, { p: [450, 50], out: [0, 1] }, [a, b, c], taken)!;
  const under = (r: ReturnType<typeof go>) => Math.max(...r.pts.map((p) => p[1]));
  const near = under(go());
  // A short line down the page, across the way it went under C.
  const taken = new Taken();
  taken.add([
    [150, near - 16],
    [150, near + 12],
  ]);
  const r = go(taken);
  expect(taken.crossings(r.trace)).toBe(0);
  expect(under(r)).toBeGreaterThan(near + 12 - 1);
});

test('an arrow with a box in its way picks the lane round it that crosses no other line', () => {
  const [a, b, c] = [box(0, 0), box(400, 0), box(200, -30, 100, 90)];
  const lane = (r: ReturnType<typeof route>) => r.pts[2][1];
  // Under C is nearer the straight line.
  const free = route(a, b, 'LR', [a, b, c]);
  expect(lane(free)).toBeGreaterThan(60);
  // A line down the page under C: over it, then.
  const taken = new Taken();
  taken.add([
    [250, 64],
    [250, 120],
  ]);
  const r = route(a, b, 'LR', [a, b, c], 0, undefined, undefined, taken);
  expect(lane(r)).toBeLessThan(-30);
});

test('a frame between two boxes is in the way of a line between them, not of one into it', () => {
  const s = OutlineStore.create();
  const sys = s.addChild(s.rootId, -1, 'sys').id;
  const a = s.addChild(sys, -1, 'A').id;
  const f = s.addChild(sys, -1, 'F').id;
  s.addField(f, 'shape', 'frame');
  const inner = s.addChild(f, -1, 'in').id;
  const c = s.addChild(sys, -1, 'C').id;
  s.addField(a, 'to', `[[${f}]], [[${c}]], [[${inner}]]`);
  s.addField(f, 'to', `[[${c}]]`);
  const d = buildDiagram(s, sys);
  const L = layout(d);
  const { routes } = routeAll(d, L, estimate);
  const frame = L.boxes.get(f)!;
  // Along each stretch, not only at the corners.
  const through = (r: { trace: [number, number][] }) =>
    r.trace.slice(1).some((q, i) => {
      const p = r.trace[i];
      return Array.from({ length: 21 }, (_, k) => k / 20).some((t) => {
        const [x, y] = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
        return x > frame.x + 2 && x < frame.x + frame.w - 2 && y > frame.y + 2 && y < frame.y + frame.h - 2;
      });
    });
  const edge = (to: string) => routes.get(d.edges.find((e) => e.from === a && e.to === to)!)!;
  expect(through(edge(c))).toBe(false);
  expect(through(edge(inner))).toBe(true);
});
