// @vitest-environment jsdom
import { expect, test } from 'vitest';
import type { Box } from './diagram';
import { aroundBoxes } from './DiagramView';

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
