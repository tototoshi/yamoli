// @vitest-environment jsdom
import { expect, test } from 'vitest';
import { getFormat, parseCsv, renderFormat } from './formats';

test('markdown is rendered and sanitized', () => {
  const html = renderFormat(
    'markdown',
    '# T\n\n- a\n  - b\n- [x] done\n\n**bold** `<x>` [l](javascript:alert(1)) [ok](https://example.com)\n\n<script>alert(1)</script><img src=x onerror=alert(1)>'
  );
  expect(html).toMatch(/<h1>T<\/h1>/);
  expect(html).toMatch(/<li>a\s*<ul>\s*<li>b<\/li>/);
  expect(html).toMatch(/checked/);
  expect(html).toMatch(/<strong>bold<\/strong>/);
  expect(html).toMatch(/<code>&lt;x&gt;<\/code>/);
  expect(html).toMatch(/<a href="https:\/\/example.com" target="_blank" rel="noopener noreferrer">ok<\/a>/);
  expect(html).not.toMatch(/javascript:/);
  expect(html).not.toMatch(/<script/);
  expect(html).not.toMatch(/onerror/);
});

test('json / csv / fallback formats', () => {
  expect(renderFormat('json', '{"a":1}')).toMatch(/j-key/);
  expect(renderFormat('json', '{bad')).toMatch(/fmt-error/);
  expect(renderFormat('csv', 'a,b\n1,2')).toMatch(/<td>2<\/td>/);
  expect(parseCsv('a,"b,""c"""\n1,2\n')).toEqual([
    ['a', 'b,"c"'],
    ['1', '2'],
  ]);
  expect(getFormat('nope').name).toBe('text');
});
