/*
 * Inline formatting for row text shown outside the editor.
 *
 * Supported: `code`, **bold**, *italic*, ~~strike~~, [label](https://…),
 * bare https:// URLs and #tags. Markup characters are hidden; every segment
 * remembers where its text starts in the source so a click can be mapped
 * back to a caret position.
 */
import type { Term } from './search';

export type SegKind = 'text' | 'code' | 'strong' | 'em' | 'del' | 'link' | 'tag';

export interface Seg {
  kind: SegKind;
  text: string;
  /** Offset of `text` within the source string. */
  start: number;
  href?: string;
}

const INLINE =
  /`([^`]+)`|\*\*([^*]+)\*\*|~~([^~]+)~~|\*([^*\s][^*]*)\*|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s<>()]+)|(^|\s)(#[^\s#.,!?、。]+)/g;

export function parseInline(src: string): Seg[] {
  const out: Seg[] = [];
  let last = 0;
  const push = (kind: SegKind, text: string, start: number, href?: string) => out.push({ kind, text, start, href });
  for (const m of src.matchAll(INLINE)) {
    const i = m.index! + (m[8]?.length ?? 0); // a #tag's leading space stays plain text
    if (i > last) push('text', src.slice(last, i), last);
    if (m[1] !== undefined) push('code', m[1], i + 1);
    else if (m[2] !== undefined) push('strong', m[2], i + 2);
    else if (m[3] !== undefined) push('del', m[3], i + 2);
    else if (m[4] !== undefined) push('em', m[4], i + 1);
    else if (m[5] !== undefined) push('link', m[5], i + 1, m[6]);
    else if (m[7] !== undefined) push('link', m[7], i, m[7]);
    else push('tag', m[9], i);
    last = m.index! + m[0].length;
  }
  if (last < src.length) push('text', src.slice(last), last);
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
