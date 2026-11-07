/*
 * Inline formatting for row text shown outside the editor.
 *
 * Supported: `code`, **bold**, *italic*, ~~strike~~, [label](https://…),
 * bare https:// URLs, #tags and [[id]] links to other items. Markup characters are hidden; every segment
 * remembers where its text starts in the source so a click can be mapped
 * back to a caret position.
 */
import type { Term } from './search';

export type SegKind = 'text' | 'code' | 'strong' | 'em' | 'del' | 'link' | 'tag' | 'ref';

export interface Seg {
  kind: SegKind;
  text: string;
  /** Offset of `text` within the source string. */
  start: number;
  href?: string;
  /** Target node id of a 'ref' segment (whose text is the raw `[[id]]`). */
  refId?: string;
}

const INLINE = new RegExp(
  [
    /\[\[(?<ref>[^[\]\s]+)\]\]/,
    /`(?<code>[^`]+)`/,
    /\*\*(?<strong>[^*]+)\*\*/,
    /~~(?<del>[^~]+)~~/,
    /\*(?<em>[^*\s][^*]*)\*/,
    /\[(?<label>[^\]]+)\]\((?<href>https?:\/\/[^)\s]+)\)/,
    /(?<url>https?:\/\/[^\s<>()]+)/,
    /(?<pre>^|\s)(?<tag>#[^\s#.,!?、。]+)/,
  ]
    .map((r) => r.source)
    .join('|'),
  'g'
);

export function parseInline(src: string): Seg[] {
  const out: Seg[] = [];
  let last = 0;
  const push = (seg: Seg) => out.push(seg);
  for (const m of src.matchAll(INLINE)) {
    const g = m.groups!;
    const i = m.index! + (g.pre?.length ?? 0); // a #tag's leading space stays plain text
    if (i > last) push({ kind: 'text', text: src.slice(last, i), start: last });
    if (g.ref !== undefined) push({ kind: 'ref', text: m[0], start: i, refId: g.ref });
    else if (g.code !== undefined) push({ kind: 'code', text: g.code, start: i + 1 });
    else if (g.strong !== undefined) push({ kind: 'strong', text: g.strong, start: i + 2 });
    else if (g.del !== undefined) push({ kind: 'del', text: g.del, start: i + 2 });
    else if (g.em !== undefined) push({ kind: 'em', text: g.em, start: i + 1 });
    else if (g.label !== undefined) push({ kind: 'link', text: g.label, start: i + 1, href: g.href });
    else if (g.url !== undefined) push({ kind: 'link', text: g.url, start: i, href: g.url });
    else push({ kind: 'tag', text: g.tag, start: i });
    last = m.index! + m[0].length;
  }
  if (last < src.length) push({ kind: 'text', text: src.slice(last), start: last });
  return out;
}

export interface Piece {
  text: string;
  /** Offset of `text` within the segment. */
  offset: number;
  mark: boolean;
}

/** Split text into pieces, marking occurrences of the (positive, text) search terms. */
export function highlight(text: string, terms: Term[]): Piece[] {
  const words = terms.filter((t) => !t.negate && t.key === undefined && t.value).map((t) => t.value);
  if (!words.length) return [{ text, offset: 0, mark: false }];

  // Normalize per character, remembering which source index each output char came from.
  let norm = '';
  const map: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const n = text[i].normalize('NFKC').toLowerCase();
    norm += n;
    for (let k = 0; k < n.length; k++) map.push(i);
  }

  const ranges: [number, number][] = [];
  for (const w of words) {
    for (let j = norm.indexOf(w); j !== -1; j = norm.indexOf(w, j + 1)) {
      ranges.push([map[j], map[j + w.length - 1] + 1]);
    }
  }
  if (!ranges.length) return [{ text, offset: 0, mark: false }];
  ranges.sort((a, b) => a[0] - b[0]);

  const pieces: Piece[] = [];
  let pos = 0;
  for (const [s, e] of ranges) {
    if (e <= pos) continue;
    const from = Math.max(s, pos);
    if (from > pos) pieces.push({ text: text.slice(pos, from), offset: pos, mark: false });
    pieces.push({ text: text.slice(from, e), offset: from, mark: true });
    pos = e;
  }
  if (pos < text.length) pieces.push({ text: text.slice(pos), offset: pos, mark: false });
  return pieces;
}
