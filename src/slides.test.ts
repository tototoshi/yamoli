import { expect, test } from 'vitest';
import { OutlineStore } from './model';
import { buildDeck, splitColumns } from './slides';

test('a deck: title slide, one slide per item, fields as settings', () => {
  const s = OutlineStore.create();
  const deck = s.addChild(s.rootId, -1, '提案').id;
  s.addField(deck, 'subtitle', '2026 年度');
  s.addField(deck, 'theme', 'dark');
  const a = s.addChild(deck, -1, '課題').id;
  const a1 = s.addChild(a, -1, '問い合わせが多い').id;
  const a11 = s.addChild(a1, -1, '月 40 時間').id;
  const notes = s.addField(a, 'notes').id;
  s.addChild(notes, -1, '現場の声');
  s.addChild(notes, -1, '数字の出典');
  const b = s.addChild(deck, -1, '計画').id;
  s.addField(b, 'layout', 'two-column');
  s.addField(b, 'embed', `[[${a}]]`);
  const c = s.addChild(deck, -1, 'まとめ').id;
  s.addField(c, 'layout', 'sideways');

  const d = buildDeck(s, deck);
  expect(d.theme).toBe('dark');
  expect(d.slides.map((x) => [x.id, x.layout])).toEqual([
    [deck, 'title'],
    [a, 'default'],
    [b, 'two-column'],
    [c, 'default'], // unknown layout
  ]);
  expect(d.slides[0].subtitle).toBe('2026 年度');
  expect(d.slides[1].bullets).toEqual([{ id: a1, children: [{ id: a11, children: [] }] }]);
  expect(d.slides[1].notes).toBe('現場の声\n数字の出典');
  expect(d.slides[2].embed).toBe(a);
  expect(d.slides[2].embedAs).toBe('gantt');
  s.setText(s.field(b, 'embed')!.id, `[[${a}]] 図`);
  expect(buildDeck(s, deck).slides[2].embedAs).toBe('diagram');
  // Home is not a slide of its own.
  expect(buildDeck(s, s.rootId).slides.map((x) => x.id)).toEqual([deck]);
});

test('two columns split by length', () => {
  const b = (id: string, n = 0) => ({ id, children: Array.from({ length: n }, (_, i) => ({ id: id + i, children: [] })) });
  expect(splitColumns([b('a'), b('b'), b('c'), b('d')]).map((c) => c.map((x) => x.id))).toEqual([['a', 'b'], ['c', 'd']]);
  expect(splitColumns([b('a', 3), b('b'), b('c')]).map((c) => c.map((x) => x.id))).toEqual([['a'], ['b', 'c']]);
  expect(splitColumns([b('a')]).map((c) => c.length)).toEqual([1, 0]);
});
