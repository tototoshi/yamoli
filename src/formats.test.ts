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

test('an image block shows its picture and caption; kept images load from the server', () => {
  const ref = 'files/' + 'a'.repeat(64) + '.png';
  const html = renderFormat('image', `${ref}\nThe login screen <b>`);
  expect(html).toContain(`<img src="./api/${ref}" alt="The login screen &lt;b&gt;">`);
  expect(html).toContain('<figcaption>The login screen &lt;b&gt;</figcaption>');
  expect(renderFormat('image', 'https://example.com/a.png')).toContain('src="https://example.com/a.png"');
  // In Markdown too.
  expect(renderFormat('markdown', `![shot](${ref})`)).toContain(`src="./api/${ref}"`);
  // A quote in the reference stays inside src.
  const box = document.createElement('div');
  box.innerHTML = renderFormat('image', '" onerror="alert(1)');
  expect(box.querySelector('img')!.getAttributeNames()).toEqual(['src', 'alt']);
});

test('a file block links to the file, downloaded under its own name, with its size', () => {
  const box = document.createElement('div');
  box.innerHTML = renderFormat('file', `files/${'b'.repeat(64)}.pdf\n報告書 Q3.pdf\n1536000\nfrom the board`);
  const a = box.querySelector('a')!;
  expect(a.getAttribute('href')).toBe(`./api/files/${'b'.repeat(64)}.pdf?name=${encodeURIComponent('報告書 Q3.pdf')}`);
  expect(a.getAttribute('download')).toBe('報告書 Q3.pdf');
  expect(a.textContent).toBe('報告書 Q3.pdf1.5 MB');
  expect(box.querySelector('.file-note')!.textContent).toBe('from the board');
  // Markdown links to kept files work too.
  expect(renderFormat('markdown', '[minutes](files/x.pdf)')).toContain('href="./api/files/x.pdf"');
});
