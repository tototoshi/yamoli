/*
 * A document from an outline: the zoomed item's rows as a bulleted list,
 * nested as they are, with what is written as Markdown drawn as such. Nothing
 * is guessed from how the rows are laid out.
 *
 *   # 見出し / ## … / ###          a heading; the rows under it follow it
 *                                    (its section), not nested. One inside a
 *                                    list ends it, as in Markdown: it and the
 *                                    rows after it in its place come out after
 *   any other row                   an item of the list, the rows under it nested
 *   a task ([ ] / done)             an item with a checkbox
 *   a block (Markdown, CSV, image …) drawn where it is: prose goes in one
 *   embed: [[item]] diagram         that item's diagram there (or `mindmap`,
 *                                    else its Gantt chart; no link: the row's own)
 *
 * Other fields are left out, but for the zoomed item's `description`, which
 * leads the document.
 */
import { refIds } from './links';
import type { OutlineStore } from './model';

/** `# ` to `### ` at the start of a row's text: a heading. */
const HEADING = /^(#{1,3})[ 　]+/;

/** A heading row's level (1 for `# `) and how long its `#`s and space are; null for other text. */
export function headingOf(text: string): { level: 1 | 2 | 3; prefix: number } | null {
  const m = text.match(HEADING);
  return m ? { level: m[1].length as 1 | 2 | 3, prefix: m[0].length } : null;
}

/** text with a heading's `#`s set to level (0: none, a plain row). */
export function withHeading(text: string, level: 0 | 1 | 2 | 3): string {
  const rest = text.slice(headingOf(text)?.prefix ?? 0);
  return level ? '#'.repeat(level) + ' ' + rest : rest;
}

/** What an `embed` draws. */
export type EmbedAs = 'gantt' | 'diagram' | 'mindmap';

/** A block or an embedded drawing, among the rows. */
export type Extra = { kind: 'data'; id: string } | { kind: 'embed'; id: string; as: EmbedAs };

export interface DocItem {
  id: string;
  /** Marked as a task (or completed): drawn with a checkbox. */
  task: boolean;
  items: DocItem[];
  extras: Extra[];
}

export type DocPart =
  | { kind: 'heading'; id: string; level: 1 | 2 | 3 }
  /** Rows side by side, as a bulleted list. */
  | { kind: 'list'; items: DocItem[] }
  | Extra;

export interface Doc {
  /** The zoomed item's `description`. */
  lead?: string;
  parts: DocPart[];
}

/** Fields that set up the views, not what the document says. */
const QUIET = new Set(['views', 'description']);

export function buildDoc(store: OutlineStore, rootId: string, { showCompleted = true } = {}): Doc {
  const rows = (id: string) => store.items(id).filter((c) => showCompleted || !store.node(c).completed);
  const embedOf = (id: string): Extra | null => {
    const value = store.fieldValue(id, 'embed');
    if (!value) return null;
    const words = value.replace(/\[\[[^\]]*\]\]/g, '');
    const as: EmbedAs = /mindmap|マインドマップ/i.test(words) ? 'mindmap' : /diagram|図/i.test(words) ? 'diagram' : 'gantt';
    const target = refIds(value).length ? refIds(value).find((r) => store.get(r)) : id;
    return target ? { kind: 'embed', id: target, as } : null;
  };
  /** id's blocks, and what its `embed` draws (no link: its rows, drawn instead of written out). */
  const extrasOf = (id: string): Extra[] => {
    const blocks: Extra[] = store
      .node(id)
      .children.filter((c) => store.node(c).format !== null && !QUIET.has(store.node(c).key!.trim().toLowerCase()))
      .map((c) => ({ kind: 'data', id: c }));
    const embed = embedOf(id);
    return embed ? [...blocks, embed] : blocks;
  };
  const rowsOf = (id: string) => (embedOf(id)?.id === id ? [] : rows(id));
  const isHeading = (id: string) => headingOf(store.node(id).text) !== null;
  /** id as a list item; a heading among the rows under it, and those after it, go to out (to come after the list). */
  const item = (id: string, out: string[]): DocItem => {
    const kids = rowsOf(id);
    const at = kids.findIndex(isHeading);
    const items = (at < 0 ? kids : kids.slice(0, at)).map((c) => item(c, out));
    if (at >= 0) out.push(...kids.slice(at));
    return { id, task: store.node(id).task || store.node(id).completed, items, extras: extrasOf(id) };
  };

  const parts: DocPart[] = [];
  let run: DocItem[] = [];
  const flush = () => {
    if (run.length) parts.push({ kind: 'list', items: run });
    run = [];
  };
  /** Rows in their place: a heading ends the list before it, and its rows come after it. */
  const write = (ids: string[]) => {
    for (const c of ids) {
      const h = headingOf(store.node(c).text);
      if (h) {
        flush();
        parts.push({ kind: 'heading', id: c, level: h.level }, ...extrasOf(c));
        write(rowsOf(c));
        flush();
        continue;
      }
      const out: string[] = [];
      run.push(item(c, out));
      if (out.length) {
        flush();
        write(out);
      }
    }
  };
  parts.push(...extrasOf(rootId));
  write(rowsOf(rootId));
  flush();
  const lead = rootId !== store.rootId ? store.fieldValue(rootId, 'description') : undefined;
  return { ...(lead && { lead }), parts };
}

/** A document's contents: its `#` and `##` headings, in order, their text without markup. */
export const docContents = (store: OutlineStore, parts: DocPart[]): { id: string; level: 1 | 2; text: string }[] =>
  parts.flatMap((p) =>
    p.kind === 'heading' && p.level < 3
      ? [{ id: p.id, level: p.level as 1 | 2, text: withHeading(store.node(p.id).text, 0).replace(/[`*~]/g, '') }]
      : []
  );
