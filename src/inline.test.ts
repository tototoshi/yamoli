import { expect, test } from 'vitest';
import { colorMark, highlight, linkAt, markupSpans, parseInline, toggleMark } from './inline';
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

test('[words]{colour} is a stretch in a colour word or #hex; other words in braces stay text', () => {
  expect(parseInline('a [hot]{red} b [x]{#3b6fd8}')).toEqual([
    { kind: 'text', text: 'a ', start: 0 },
    { kind: 'color', text: 'hot', start: 3, color: 'red' },
    { kind: 'text', text: ' b ', start: 12 },
    { kind: 'color', text: 'x', start: 16, color: '#3b6fd8' },
  ]);
  expect(parseInline('[x]{wavy}').map((s) => s.kind)).toEqual(['text']);
  expect(markupSpans('[**hot** day]{red}!')).toEqual([
    { text: '[', cls: 'mk' },
    { text: '**', cls: 'mk', color: 'red' },
    { text: 'hot', cls: 'strong', color: 'red' },
    { text: '**', cls: 'mk', color: 'red' },
    { text: ' day', cls: 'color', color: 'red' },
    { text: ']{red}', cls: 'mk' },
    { text: '!' },
  ]);
});

test('a shortcut puts a mark around the selection, or takes it away when it is marked so', () => {
  // Wrapped, spaces at its ends left out; the selection stays on the words.
  expect(toggleMark('a big one', 1, 6, 'strong')).toEqual({ text: 'a **big** one', start: 4, end: 7 });
  // Again, just inside the marks or with them: unwrapped.
  expect(toggleMark('a **big** one', 4, 7, 'strong')).toEqual({ text: 'a big one', start: 2, end: 5 });
  expect(toggleMark('a **big** one', 2, 9, 'strong')).toEqual({ text: 'a big one', start: 2, end: 5 });
  // Italic inside bold is wrapped, not taken for half of the bold.
  expect(toggleMark('**big**', 2, 5, 'em').text).toBe('***big***');
  expect(toggleMark('*big*', 1, 4, 'em').text).toBe('big');
  expect(toggleMark('x', 1, 1, 'code')).toEqual({ text: 'x``', start: 2, end: 2 });
  expect(toggleMark('gone', 0, 4, 'del').text).toBe('~~gone~~');
});

test('a colour goes around the selection, changes on a coloured stretch, and comes off with none', () => {
  expect(colorMark('a hot day', 2, 5, 'red')).toEqual({ text: 'a [hot]{red} day', start: 3, end: 6 });
  expect(colorMark('a [hot]{red} day', 3, 6, 'blue')).toEqual({ text: 'a [hot]{blue} day', start: 3, end: 6 });
  expect(colorMark('a [hot]{red} day', 2, 12, 'green').text).toBe('a [hot]{green} day');
  expect(colorMark('a [hot]{red} day', 3, 6, null)).toEqual({ text: 'a hot day', start: 2, end: 5 });
  expect(colorMark('a hot day', 2, 5, null).text).toBe('a hot day');
});

test('marks inside marks: a colour inside bold, bold inside a colour', () => {
  expect(markupSpans('**[hot]{red}**').filter((s) => s.text === 'hot')).toEqual([
    { text: 'hot', cls: 'color', within: ['strong'], color: 'red' },
  ]);
  expect(parseInline('**[hot]{red}**')).toEqual([{ kind: 'strong', text: '[hot]{red}', start: 2 }]);
});
