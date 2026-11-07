import { expect, test } from 'vitest';
import { highlight, parseInline } from './inline';
import { parseQuery } from './search';

test('parseInline splits formatting and keeps source offsets', () => {
  const src = 'a **b** `c` *d* ~~e~~ [f](https://x.io) https://y.io #tag';
  const segs = parseInline(src);
  expect(segs.map((s) => [s.kind, s.text])).toEqual([
    ['text', 'a '],
    ['strong', 'b'],
    ['text', ' '],
    ['code', 'c'],
    ['text', ' '],
    ['em', 'd'],
    ['text', ' '],
    ['del', 'e'],
    ['text', ' '],
    ['link', 'f'],
    ['text', ' '],
    ['link', 'https://y.io'],
    ['text', ' '],
    ['tag', '#tag'],
  ]);
  // Every segment's text sits at its recorded offset in the source.
  for (const s of segs) expect(src.slice(s.start, s.start + s.text.length)).toBe(s.text);
  expect(segs.find((s) => s.text === 'f')?.href).toBe('https://x.io');
});

test('only http(s) links and real tags are recognized', () => {
  expect(parseInline('[x](javascript:alert(1))').every((s) => s.kind === 'text')).toBe(true);
  expect(parseInline('issue#12').every((s) => s.kind === 'text')).toBe(true);
  expect(parseInline('#一番目 です').map((s) => s.kind)).toEqual(['tag', 'text']);
  expect(parseInline('')).toEqual([]);
});

test('highlight marks search words, ignoring case and width', () => {
  const pieces = highlight('Buy ＭＩＬＫ and milk', parseQuery('milk -buy status:x'));
  expect(pieces).toEqual([
    { text: 'Buy ', offset: 0, mark: false },
    { text: 'ＭＩＬＫ', offset: 4, mark: true },
    { text: ' and ', offset: 8, mark: false },
    { text: 'milk', offset: 13, mark: true },
  ]);
  expect(highlight('abc', [])).toEqual([{ text: 'abc', offset: 0, mark: false }]);
});
