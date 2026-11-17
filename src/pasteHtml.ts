/*
 * Text copied from a web page, its links kept as Markdown links
 * (`[words](https://…)`): a line for each block (paragraph, heading, row of a
 * table …), and list items as `- ` lines indented under the item they are in,
 * which a paste then reads as rows.
 */

/** Elements that start and end a line of their own. */
const BLOCKS = new Set(
  'ADDRESS ARTICLE ASIDE BLOCKQUOTE DD DETAILS DIV DL DT FIGCAPTION FIGURE FOOTER FORM H1 H2 H3 H4 H5 H6 HEADER HR MAIN NAV P PRE SECTION SUMMARY TABLE TR'.split(
    ' '
  )
);
const SKIPPED = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT']);
const LINKABLE = /^(?:https?:|mailto:)/i;

/** The copied HTML as lines of text with its links in, or null when it has no links to keep. */
export function linkedText(html: string): string | null {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  if (![...doc.querySelectorAll('a[href]')].some((a) => LINKABLE.test(a.getAttribute('href')!.trim()))) return null;
  const lines: string[] = [];
  let line = '';
  /** What the next line starts with: a list item's mark, indented by how deep its list is. */
  let lead = '';
  let depth = -1;
  const flush = () => {
    const text = line.replace(/\s+/g, ' ').trim();
    if (text) lines.push(lead + text);
    line = '';
    lead = '';
  };
  const walk = (n: Node) => {
    if (n.nodeType === Node.TEXT_NODE) {
      line += n.textContent;
      return;
    }
    if (n.nodeType !== Node.ELEMENT_NODE) return;
    const el = n as Element;
    const tag = el.tagName;
    if (SKIPPED.has(tag)) return;
    if (tag === 'BR') return flush();
    if (tag === 'A') {
      const href = el.getAttribute('href')?.trim() ?? '';
      const words = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (LINKABLE.test(href) && words) {
        line += words === href ? href : `[${words}](${href.replace(/\s/g, '%20')})`;
        return;
      }
    }
    const children = () => el.childNodes.forEach(walk);
    if (tag === 'UL' || tag === 'OL') {
      flush();
      depth++;
      children();
      flush();
      depth--;
    } else if (tag === 'LI') {
      flush();
      lead = '  '.repeat(Math.max(depth, 0)) + '- ';
      children();
      flush();
    } else if (BLOCKS.has(tag)) {
      flush();
      children();
      flush();
    } else {
      children();
      if (tag === 'TD' || tag === 'TH') line += ' ';
    }
  };
  walk(doc.body);
  flush();
  return lines.join('\n');
}
