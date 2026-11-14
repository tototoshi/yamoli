import { expect, test } from 'vitest';
import { arrangeOf, buildDiagram, descLines, estimate, frameDesc, layout, wrap, type Box } from './diagram';
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
  for (const f of [vpc, pub, priv]) s.addField(f, 'shape', 'frame');
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
  s.addField(b, 'after', `[[${a}]]`);
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

test('a flow unless a mind map is asked for, which grows from the zoomed item; direction can be set', () => {
  const s = OutlineStore.create();
  const p = s.addChild(s.rootId, -1, 'Topic').id;
  const a = s.addChild(p, -1, 'A').id;
  s.addChild(a, -1, 'A1');
  // Without arrows too: a flow, unless drawn as a mind map.
  expect(buildDiagram(s, p).kind).toBe('flow');
  const d = buildDiagram(s, p, { kind: 'tree' });
  expect(d.kind).toBe('tree');
  expect(d.top).toEqual([p]);
  const L = layout(d);
  expect(L.branches.length).toBe(2);
  const [root, child] = [L.boxes.get(p)!, L.boxes.get(a)!];
  expect(child.x).toBeGreaterThan(root.x + root.w);

  s.addField(p, 'direction', 'TB');
  const L2 = layout(buildDiagram(s, p, { kind: 'tree' }));
  expect(L2.boxes.get(a)!.y).toBeGreaterThan(L2.boxes.get(p)!.y + L2.boxes.get(p)!.h);
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

test('the samples draw without overlaps, and the guide embeds them and its own rows', async () => {
  const { addDfdSample, addDiagramSample, addGuideSlides, addMindMapSample, addScheduleSample } = await import('./sample');
  const { buildDeck } = await import('./slides');
  const s = OutlineStore.create();
  // The diagram sample comes first, so the guide must not take it for the project.
  const sys = addDiagramSample(s, s.rootId);
  const proj = addScheduleSample(s, s.rootId);
  const dfd = addDfdSample(s, s.rootId);
  const map = addMindMapSample(s, s.rootId);
  const drawn = (id: string, kind: 'flow' | 'tree' = 'flow') => {
    const d = buildDiagram(s, id, { kind });
    expect(d.edges.every((e) => d.nodes.has(e.from) && d.nodes.has(e.to))).toBe(true);
    const L = layout(d);
    for (const n of [...d.nodes.values(), { children: d.top }]) {
      const kids = n.children.map((c) => L.boxes.get(c)!);
      kids.forEach((a, i) => kids.slice(i + 1).forEach((b) => expect(overlap(a, b)).toBe(false)));
    }
    return d;
  };
  expect(drawn(sys).edges.length).toBe(11);
  const flows = drawn(dfd);
  expect(flows.edges.length).toBe(7);
  expect([...flows.nodes.values()].map((n) => n.shape).sort()).toEqual(
    ['box', 'box', 'process', 'process', 'process', 'store', 'store'].sort()
  );
  expect(drawn(map, 'tree').top.length).toBe(1);

  const deck = addGuideSlides(s, s.rootId);
  const slides = buildDeck(s, deck).slides.filter((x) => x.embed);
  expect(slides.map((x) => [x.embed, x.embedAs])).toEqual([
    [proj, 'gantt'],
    [sys, 'diagram'],
    [map, 'mindmap'],
    [slides[3].id, 'diagram'],
  ]);
  // No sample was added twice.
  expect(s.items(s.rootId).length).toBe(5);
  expect(drawn(slides[3].id).edges.length).toBe(2);
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

test('only `shape: frame` makes a frame; under other rows, the rows are listed in the box and their arrows are its', () => {
  const s = OutlineStore.create();
  const p = s.addChild(s.rootId, -1, 'P').id;
  const api = s.addChild(p, -1, 'API').id;
  const auth = s.addChild(api, -1, 'auth').id;
  s.addChild(auth, -1, 'JWT'); // deeper rows are not listed
  const logs = s.addChild(api, -1, 'logs').id;
  const db = s.addChild(p, -1, 'DB').id;
  s.addField(auth, 'to', `[[${db}]] read`);
  s.addField(logs, 'to', `[[${db}]] write`);
  const group = s.addChild(p, -1, 'Empty group').id;
  s.addField(group, 'shape', 'frame solid');

  const d = buildDiagram(s, p);
  expect(d.top).toEqual([api, db, group]);
  expect(d.nodes.get(api)).toMatchObject({ isFrame: false, children: [], props: ['• auth', '• logs'] });
  expect(d.nodes.has(auth)).toBe(false);
  expect(d.edges).toMatchObject([{ from: api, to: db, label: 'read, write' }]); // alike lines become one
  expect(d.nodes.get(group)).toMatchObject({ isFrame: true, frame: 'solid' });
  // An empty frame is still drawn as one.
  expect(layout(d).boxes.get(group)!.frame).toBe(true);

  // A mind map draws every row, frames or not.
  expect(buildDiagram(s, p, { kind: 'tree' }).nodes.has(auth)).toBe(true);
});

test('a frame is drawn around its rows, without arrows too', () => {
  const s = OutlineStore.create();
  const p = s.addChild(s.rootId, -1, 'P').id;
  const g = s.addChild(p, -1, 'Group').id;
  s.addChild(g, -1, 'A');
  s.addField(g, 'shape', 'frame');
  const d = buildDiagram(s, p);
  expect(d.kind).toBe('flow');
  expect(layout(d).boxes.get(g)!.frame).toBe(true);
});

test('a frame with a note makes room for it above its rows', () => {
  const s = OutlineStore.create();
  const p = s.addChild(s.rootId, -1, 'P').id;
  const g = s.addChild(p, -1, 'Group').id;
  const a = s.addChild(g, -1, 'A').id;
  s.addField(g, 'shape', 'frame');
  const before = layout(buildDiagram(s, p));
  s.addField(g, 'note', 'Everything the users never see directly');
  const d = buildDiagram(s, p);
  expect(d.nodes.get(g)!.desc).toBe('Everything the users never see directly');
  const L = layout(d);
  expect(L.boxes.get(g)!.h).toBeGreaterThan(before.boxes.get(g)!.h);
  expect(L.boxes.get(a)!.y - L.boxes.get(g)!.y).toBeGreaterThan(before.boxes.get(a)!.y - before.boxes.get(g)!.y);
});

test('a note or description is shown as text under the name, also from a block', () => {
  const s = OutlineStore.create();
  const p = s.addChild(s.rootId, -1, 'P').id;
  const a = s.addChild(p, -1, 'API').id;
  const b = s.addChild(p, -1, 'Worker').id;
  const c = s.addChild(p, -1, 'Cache').id;
  s.addField(a, 'description', 'Serves the **app**');
  s.addField(a, 'tech', 'Go');
  s.addBlock(b, 'note', 'markdown', '# Jobs\n\n- sends [mail](https://x.example)\n- cleans up');
  const d = buildDiagram(s, p);
  expect(d.nodes.get(a)).toMatchObject({ desc: 'Serves the app', props: ['tech: Go'] });
  expect(d.nodes.get(b)!.desc).toBe('Jobs sends mail cleans up');
  // The text makes the box taller.
  const L = layout(d);
  expect(L.boxes.get(a)!.h).toBeGreaterThan(L.boxes.get(c)!.h);
});

test('descriptions wrap between words and phrases, and are cut after a few lines', () => {
  expect(wrap('one two three four', 42, 10, estimate)).toEqual(['one two', 'three', 'four']);
  // Japanese breaks between words, a particle or mark staying with the word before it.
  expect(wrap('認証とセッション管理', 50, 10, estimate)).toEqual(['認証と', 'セッション', '管理']);
  expect(wrap('メール送信や集計など、時間のかかる処理', 70, 10, estimate)).toEqual(['メール送信や', '集計など、', '時間のかかる', '処理']);
  // A word wider than a line is broken where it must.
  expect(wrap('セッションセッション', 50, 10, estimate)).toEqual(['セッション', 'セッション']);
  const long = wrap('a '.repeat(200), 30, 10, estimate, 4);
  expect(long.length).toBe(4);
  expect(long[3].endsWith('…')).toBe(true);
});

test('a long description is shown in full, in a wider box before a taller one', () => {
  const s = OutlineStore.create();
  const node = (desc: string) => ({ ...buildDiagram(s, s.rootId).nodes.values().next().value, desc }) as never;
  s.addChild(s.rootId, -1, 'A');
  const text = 'word '.repeat(60).trim();
  const lines = descLines(node(text), estimate);
  expect(lines.join(' ')).toBe(text);
  expect(lines.length).toBeGreaterThan(4);
  // Short text keeps to the narrow width; longer text spreads out first.
  const width = (t: string) => Math.max(...descLines(node(t), estimate).map((l) => estimate(l, 11)));
  expect(width('word '.repeat(4).trim())).toBeLessThanOrEqual(140);
  expect(width(text)).toBeGreaterThan(200);
});

test("a frame's description runs across the frame", () => {
  const n = { desc: 'Everything here is backed up every night and read from replicas' } as never;
  expect(frameDesc(n, 400, estimate).length).toBeLessThan(descLines(n, estimate).length);
  expect(frameDesc(n, 400, estimate).join(' ')).toBe('Everything here is backed up every night and read from replicas');
});

test('the lines of a description come out about even', () => {
  const lines = descLines({ desc: 'メール送信や集計など、時間のかかる処理' } as never, estimate);
  const lengths = lines.map((l) => [...l].length);
  expect(lines.join('')).toBe('メール送信や集計など、時間のかかる処理');
  expect(Math.max(...lengths) - Math.min(...lengths)).toBeLessThanOrEqual(4);
});

test('a layout value: row, column or grid (with columns), in English or Japanese', () => {
  expect(arrangeOf('row')).toEqual({ kind: 'row' });
  expect(arrangeOf('縦')).toEqual({ kind: 'column' });
  expect(arrangeOf('Grid 3')).toEqual({ kind: 'grid', columns: 3 });
  expect(arrangeOf('格子')).toEqual({ kind: 'grid', columns: 0 });
  expect(arrangeOf('center')).toBeUndefined(); // a slide's layout
  expect(arrangeOf(undefined)).toBeUndefined();
});

/** A frame holding boxes a…f, the last arrow-linked back to the first, laid out as `layout` says. */
function lined(value: string, direction?: string) {
  const s = OutlineStore.create();
  const p = s.addChild(s.rootId, -1, 'P').id;
  if (direction) s.addField(p, 'direction', direction);
  const frame = s.addChild(p, -1, 'Frame').id;
  s.addField(frame, 'shape', 'frame');
  s.addField(frame, 'layout', value);
  const ids = ['a', 'b', 'c', 'd', 'e', 'f'].map((t) => s.addChild(frame, -1, t).id);
  s.addField(ids[5], 'to', `[[${ids[0]}]]`); // arrows don't reorder lined-up boxes
  const L = layout(buildDiagram(s, p));
  return { boxes: ids.map((id) => L.boxes.get(id)!), frame: L.boxes.get(frame)! };
}
const centre = (b: Box) => [b.x + b.w / 2, b.y + b.h / 2];

test('layout lines up the boxes in a frame in outline order, whatever the direction', () => {
  for (const dir of [undefined, 'TB']) {
    const row = lined('row', dir);
    row.boxes.slice(1).forEach((b, i) => {
      expect(b.x).toBeGreaterThan(row.boxes[i].x + row.boxes[i].w); // left to right
      expect(centre(b)[1]).toBe(centre(row.boxes[0])[1]); // on one line
    });
    const column = lined('column', dir);
    column.boxes.slice(1).forEach((b, i) => {
      expect(b.y).toBeGreaterThan(column.boxes[i].y + column.boxes[i].h); // top to bottom
      expect(centre(b)[0]).toBe(centre(column.boxes[0])[0]);
    });
    for (const { boxes, frame } of [row, column]) for (const b of boxes) expect(inside(b, frame)).toBe(true);
  }
});

test('a grid wraps into rows: as square as it gets, or the columns asked for', () => {
  const xs = (bs: Box[]) => new Set(bs.map((b) => centre(b)[0])).size;
  const ys = (bs: Box[]) => new Set(bs.map((b) => centre(b)[1])).size;
  const auto = lined('grid').boxes; // 6 boxes: 3 across, 2 down
  expect([xs(auto), ys(auto)]).toEqual([3, 2]);
  expect(auto[3].y).toBeGreaterThan(auto[0].y + auto[0].h); // the 4th starts the next row
  const two = lined('grid 2').boxes;
  expect([xs(two), ys(two)]).toEqual([2, 3]);
  for (const bs of [auto, two]) bs.forEach((a, i) => bs.slice(i + 1).forEach((b) => expect(overlap(a, b)).toBe(false)));
});

test('layout on the zoomed item lines up the top boxes, and asks for a flow', () => {
  const s = OutlineStore.create();
  const p = s.addChild(s.rootId, -1, 'P').id;
  s.addField(p, 'layout', 'row'); // left to right, boxes without arrows would go down the page
  const [a, b] = ['a', 'b'].map((t) => s.addChild(p, -1, t).id);
  const d = buildDiagram(s, p);
  expect(d.kind).toBe('flow');
  const L = layout(d);
  expect(L.boxes.get(b)!.x).toBeGreaterThan(L.boxes.get(a)!.x + L.boxes.get(a)!.w);
});

test('a process and a data store, for data flow diagrams: a process is roomier, for its ellipse', () => {
  const s = OutlineStore.create();
  const p = s.addChild(s.rootId, -1, 'P').id;
  const [a, b, c] = ['Check order', 'Check order', 'Orders'].map((x) => s.addChild(p, -1, x).id);
  s.addField(a, 'shape', 'process');
  s.addField(c, 'shape', 'store');
  const d = buildDiagram(s, p);
  expect([a, b, c].map((id) => d.nodes.get(id)!.shape)).toEqual(['process', 'box', 'store']);
  const L = layout(d);
  const [pa, pb] = [L.boxes.get(a)!, L.boxes.get(b)!];
  expect(pa.w).toBeGreaterThan(pb.w);
  expect(pa.h).toBeGreaterThan(pb.h);
});
