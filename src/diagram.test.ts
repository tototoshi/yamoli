import { expect, test } from 'vitest';
import { buildDiagram, layout, type Box } from './diagram';
import { OutlineStore } from './model';

/** The system from the README: a user, a CDN, and a VPC with subnets. */
function system() {
  const s = OutlineStore.create();
  const sys = s.addChild(s.rootId, -1, 'System').id;
  const add = (parent: string, text: string) => s.addChild(parent, -1, text).id;
  const user = add(sys, 'User');
  const cdn = add(sys, 'CDN');
  const vpc = add(sys, 'VPC');
  const pub = add(vpc, 'Public');
  const alb = add(pub, 'ALB');
  const priv = add(vpc, 'Private');
  const web = add(priv, 'Web');
  const api = add(priv, 'API');
  const db = add(priv, 'DB');
  s.addField(user, 'shape', 'actor');
  s.addField(user, 'to', `[[${cdn}]] HTTPS`);
  s.addField(cdn, 'to', `[[${alb}]]`);
  s.addField(alb, 'to', `[[${web}]]`);
  s.addField(web, 'tech', 'Next.js');
  s.addField(web, 'to', `[[${api}]] gRPC`);
  s.addField(api, 'calls', `[[${db}]]`);
  s.addField(db, 'shape', 'db');
  return { s, sys, user, cdn, vpc, pub, alb, priv, web, api, db };
}

test('rows become boxes, rows with rows under them frames, links in fields arrows', () => {
  const { s, sys, user, cdn, vpc, priv, web, api, db, alb } = system();
  const d = buildDiagram(s, sys);
  expect(d.kind).toBe('flow');
  expect(d.top).toEqual([user, cdn, vpc]);
  expect(d.nodes.get(priv)!.children).toEqual([web, api, db]);
  expect(d.nodes.get(user)!.shape).toBe('actor');
  expect(d.nodes.get(db)!.shape).toBe('db');
  // Fields drawn as arrows or shapes are not repeated in the box.
  expect(d.nodes.get(web)!.props).toEqual(['tech: Next.js']);
  expect(d.edges).toMatchObject([
    { from: user, to: cdn, label: 'HTTPS' },
    { from: cdn, to: alb, label: '' },
    { from: alb, to: web, label: '' },
    { from: web, to: api, label: 'gRPC' },
    { from: api, to: db, label: 'calls' }, // no words after the link: the field's name
  ]);
});

test('`after` arrows run from the dependency to the item waiting for it', () => {
  const s = OutlineStore.create();
  const p = s.addChild(s.rootId, -1, 'Plan').id;
  const a = s.addChild(p, -1, 'Design').id;
  const b = s.addChild(p, -1, 'Build').id;
  s.addField(b, 'after', '^');
  const d = buildDiagram(s, p);
  expect(d.edges).toMatchObject([{ from: a, to: b, label: '' }]);
});

test('a link to a field or to a row inside a hidden part points at the drawn row holding it', () => {
  const s = OutlineStore.create();
  const p = s.addChild(s.rootId, -1, 'P').id;
  const a = s.addChild(p, -1, 'A').id;
  const b = s.addChild(p, -1, 'B').id;
  const port = s.addField(b, 'port', '80');
  s.addField(a, 'to', `[[${port.id}]]`);
  expect(buildDiagram(s, p).edges).toMatchObject([{ from: a, to: b, label: '' }]);
});

test('without arrows it is a mind map from the zoomed item; direction and kind can be set', () => {
  const s = OutlineStore.create();
  const p = s.addChild(s.rootId, -1, 'Topic').id;
  const a = s.addChild(p, -1, 'A').id;
  s.addChild(a, -1, 'A1');
  const d = buildDiagram(s, p);
  expect(d.kind).toBe('tree');
  expect(d.top).toEqual([p]);
  const L = layout(d);
  expect(L.branches.length).toBe(2);
  const [root, child] = [L.boxes.get(p)!, L.boxes.get(a)!];
  expect(child.x).toBeGreaterThan(root.x + root.w);

  s.addField(p, 'direction', 'TB');
  const L2 = layout(buildDiagram(s, p));
  expect(L2.boxes.get(a)!.y).toBeGreaterThan(L2.boxes.get(p)!.y + L2.boxes.get(p)!.h);
  s.addField(p, 'diagram', 'flow');
  expect(buildDiagram(s, p).kind).toBe('flow');
});

const inside = (inner: Box, outer: Box) =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
const overlap = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test('a flow goes along the arrows, with frames around their rows and nothing overlapping', () => {
  const { s, sys, user, cdn, vpc, pub, alb, priv, web, api, db } = system();
  const d = buildDiagram(s, sys);
  const L = layout(d);
  const box = (id: string) => L.boxes.get(id)!;
  // Left to right along the arrows, also through frames.
  expect(box(user).x + box(user).w).toBeLessThan(box(cdn).x);
  expect(box(cdn).x + box(cdn).w).toBeLessThan(box(vpc).x);
  expect(box(pub).x + box(pub).w).toBeLessThan(box(priv).x);
  expect(box(web).x + box(web).w).toBeLessThan(box(api).x);
  expect(box(api).x + box(api).w).toBeLessThan(box(db).x);
  // Frames hold their rows.
  for (const id of [pub, priv]) expect(inside(box(id), box(vpc))).toBe(true);
  expect(inside(box(alb), box(pub))).toBe(true);
  for (const id of [web, api, db]) expect(inside(box(id), box(priv))).toBe(true);
  // Siblings never overlap.
  for (const n of d.nodes.values()) {
    const kids = n.children.map(box);
    kids.forEach((a, i) => kids.slice(i + 1).forEach((b) => expect(overlap(a, b)).toBe(false)));
  }
  expect(L.width).toBeGreaterThanOrEqual(box(vpc).x + box(vpc).w);
});

test('a loop of arrows still gets a layout', () => {
  const s = OutlineStore.create();
  const p = s.addChild(s.rootId, -1, 'P').id;
  const a = s.addChild(p, -1, 'A').id;
  const b = s.addChild(p, -1, 'B').id;
  s.addField(a, 'to', `[[${b}]]`);
  s.addField(b, 'to', `[[${a}]]`);
  const L = layout(buildDiagram(s, p));
  expect(L.boxes.get(a)!.x).toBeLessThan(L.boxes.get(b)!.x);
});

test('the architecture sample draws as a flow, and the guide embeds it and the project', async () => {
  const { addDiagramSample, addGuideSlides, addScheduleSample } = await import('./sample');
  const { buildDeck } = await import('./slides');
  const s = OutlineStore.create();
  // The diagram sample comes first, so the guide must not take it for the project.
  const sys = addDiagramSample(s, s.rootId);
  const proj = addScheduleSample(s, s.rootId);
  const d = buildDiagram(s, sys);
  expect(d.kind).toBe('flow');
  expect(d.edges.length).toBe(10);
  expect(d.edges.every((e) => d.nodes.has(e.from) && d.nodes.has(e.to))).toBe(true);
  const L = layout(d);
  for (const n of d.nodes.values()) {
    const kids = n.children.map((c) => L.boxes.get(c)!);
    kids.forEach((a, i) => kids.slice(i + 1).forEach((b) => expect(overlap(a, b)).toBe(false)));
  }

  const deck = addGuideSlides(s, s.rootId);
  const embeds = buildDeck(s, deck).slides.filter((x) => x.embed).map((x) => [x.embed, x.embedAs]);
  expect(embeds).toEqual([
    [proj, 'gantt'],
    [sys, 'diagram'],
  ]);
});

test('a line looks as its field name says, and `lines` on the zoomed item says more', () => {
  const s = OutlineStore.create();
  const p = s.addChild(s.rootId, -1, 'P').id;
  const [a, b, c, d, e] = ['A', 'B', 'C', 'D', 'E'].map((x) => s.addChild(p, -1, x).id);
  s.addField(a, 'to', `[[${b}]]`);
  s.addField(a, 'async', `[[${c}]] events`);
  s.addField(b, 'both', `[[${d}]]`);
  s.addField(c, 'link', `[[${d}]]`);
  s.addField(d, 'calls', `[[${e}]]`);
  const looks = () => buildDiagram(s, p).edges.map((x) => [x.label, x.style]);
  expect(looks()).toEqual([
    ['', { dash: 'solid', ends: 'arrow' }],
    ['events', { dash: 'dashed', ends: 'arrow' }],
    ['', { dash: 'solid', ends: 'both' }],
    ['', { dash: 'solid', ends: 'none' }],
    ['calls', { dash: 'solid', ends: 'arrow' }],
  ]);
  const lines = s.addField(p, 'lines').id;
  s.addField(lines, 'calls', 'dotted red');
  s.addField(lines, 'async', 'both');
  expect(looks()[4][1]).toEqual({ dash: 'dotted', ends: 'arrow', color: '#d9534f' });
  expect(looks()[1][1]).toEqual({ dash: 'dashed', ends: 'both' }); // still dashed, now with both ends
  expect(buildDiagram(s, p).nodes.get(a)!.props).toEqual([]); // `lines` is not a box
});

test('icons, emoji and frame styles; an unknown icon is left out', async () => {
  const { iconOf } = await import('./icons');
  expect(iconOf('server')).toHaveProperty('path');
  expect(iconOf('DB')).toEqual(iconOf('database'));
  expect(iconOf('🔥')).toEqual({ text: '🔥' });
  expect(iconOf('no-such-icon')).toBeUndefined();

  const s = OutlineStore.create();
  const p = s.addChild(s.rootId, -1, 'P').id;
  const g = s.addChild(p, -1, 'Region').id;
  const a = s.addChild(g, -1, 'Application server').id; // wider than a box's least width
  s.addField(g, 'shape', 'solid');
  s.addField(a, 'icon', 'server');
  s.addField(p, 'diagram', 'flow');
  const d = buildDiagram(s, p);
  expect(d.nodes.get(g)!.frame).toBe('solid');
  expect(d.nodes.get(a)!.frame).toBe('dashed');
  expect(d.nodes.get(a)!.icon).toBe('server');
  expect(d.nodes.get(a)!.props).toEqual([]);
  // The icon makes room for itself.
  const plain = layout(buildDiagram(s, p)).boxes.get(a)!.w;
  s.setText(s.field(a, 'icon')!.id, 'nope');
  expect(layout(buildDiagram(s, p)).boxes.get(a)!.w).toBeLessThan(plain);
});
