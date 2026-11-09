import { expect, test } from 'vitest';
import { highlight, linkAt, markupSpans, parseInline } from './inline';
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

test('[[id]] becomes a ref segment', () => {
  const segs = parseInline('see [[abc123]] and [[ x ]]');
  expect(segs.map((s) => [s.kind, s.text, s.refId])).toEqual([
    ['text', 'see ', undefined],
    ['ref', '[[abc123]]', 'abc123'],
    ['text', ' and [[ x ]]', undefined],
  ]);
});

test('markupSpans keeps every character and marks the markup', () => {
  const src = 'see **bold** [docs](https://ex.com/a) and [[abc123]] #tag';
  const spans = markupSpans(src);
  expect(spans.map((s) => s.text).join('')).toBe(src);
  expect(spans.filter((s) => s.cls === 'mk').map((s) => s.text)).toEqual(['**', '**', '[', '](https://ex.com/a)', '[[', ']]']);
  expect(spans.find((s) => s.cls === 'link')?.text).toBe('docs');
  expect(spans.find((s) => s.cls === 'tag')?.text).toBe('#tag');
});

test('linkAt finds the link around the caret', () => {
  const src = 'a [docs](https://ex.com) b https://x.io c [[abc]] **d**';
  expect(linkAt(src, 0)).toBeNull();
  expect(linkAt(src, 4)).toEqual({ kind: 'link', start: 2, end: 24, label: 'docs', href: 'https://ex.com' });
  expect(linkAt(src, 24)?.kind).toBe('link'); // right after it
  expect(linkAt(src, 30)).toEqual({ kind: 'url', start: 27, end: 39, href: 'https://x.io' });
  expect(linkAt(src, 46)).toEqual({ kind: 'ref', start: 42, end: 49, refId: 'abc' });
  expect(linkAt(src, 54)).toBeNull(); // bold is not a link
});
