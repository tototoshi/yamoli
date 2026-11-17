// @vitest-environment jsdom
import { expect, test } from 'vitest';
import { linkedText } from './pasteHtml';

test('text copied from a page keeps its links as Markdown links, a line for each block', () => {
  const html = `<meta charset="utf-8"><h2>Docs</h2>
    <p>See the <a href="https://example.com/guide">user
      guide</a> or <a href="#top">top</a>.<br>Mail <a href="mailto:a@example.com">us</a>.</p>
    <p><a href="https://example.com">https://example.com</a></p><script>x()</script>`;
  expect(linkedText(html)).toBe(
    ['Docs', 'See the [user guide](https://example.com/guide) or top.', 'Mail [us](mailto:a@example.com).', 'https://example.com'].join(
      '\n'
    )
  );
});

test('lists become list lines, indented under the item they are in', () => {
  const html = `<ul><li><a href="https://a.example">A</a><ul><li>A1</li></ul></li><li>B</li></ul>`;
  expect(linkedText(html)).toBe('- [A](https://a.example)\n  - A1\n- B');
});

test('without links there is nothing to keep, and the plain text is pasted as before', () => {
  expect(linkedText('<p>Just <b>words</b></p>')).toBeNull();
  expect(linkedText('<a href="/relative">here</a>')).toBeNull();
  expect(linkedText('')).toBeNull();
});
