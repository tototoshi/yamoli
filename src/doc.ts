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
 *   a row marked as a paragraph     a paragraph instead (Backspace at the start
 *                                    of an item; `- ` typed makes it one again),
 *                                    the rows under it a list after it
 *   a task ([ ] / done)             an item with a checkbox
 *   a block (Markdown, code, image …) drawn where it is among the rows (```
 *                                    typed on a row makes it a code block)
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
  kind: 'item';
  id: string;
  /** Marked as a task (or completed): drawn with a checkbox. */
  task: boolean;
  /** A paragraph, not a list item. */
  para: boolean;
  /** The rows under it, and the blocks among them. */
  items: (DocItem | Extra)[];
  /** What its `embed` draws, after its line. */
  extras: Extra[];
}

export type DocPart =
  | { kind: 'heading'; id: string; level: 1 | 2 | 3 }
  /** Rows side by side: list items, and paragraphs among them. */
  | { kind: 'rows'; items: (DocItem | Extra)[] }
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
  /** What id's `embed` draws (no link: its rows, drawn instead of written out). */
  const extrasOf = (id: string): Extra[] => {
    const embed = embedOf(id);
    return embed ? [embed] : [];
  };
  const isBlock = (c: string) => store.node(c).format !== null && !QUIET.has(store.node(c).key!.trim().toLowerCase());
  /** The rows under id and the blocks among them, in order (only the blocks, where its embed draws its rows). */
  const rowsOf = (id: string) => {
    const shown = new Set(embedOf(id)?.id === id ? [] : rows(id));
    return store.node(id).children.filter((c) => shown.has(c) || isBlock(c));
  };
  const isHeading = (id: string) => store.node(id).key === null && headingOf(store.node(id).text) !== null;
  const block = (id: string): Extra => ({ kind: 'data', id });
  /** id as a list item; a heading among the rows under it, and those after it, go to out (to come after the list). */
  const item = (id: string, out: string[]): DocItem => {
    const kids = rowsOf(id);
    const at = kids.findIndex(isHeading);
    const items = (at < 0 ? kids : kids.slice(0, at)).map((c) => (isBlock(c) ? block(c) : item(c, out)));
    if (at >= 0) out.push(...kids.slice(at));
    const n = store.node(id);
    return { kind: 'item', id, task: n.task || n.completed, para: n.paragraph, items, extras: extrasOf(id) };
  };

  const parts: DocPart[] = [];
  let run: (DocItem | Extra)[] = [];
  const flush = () => {
    if (run.length) parts.push({ kind: 'rows', items: run });
    run = [];
  };
  /** Rows in their place: a heading ends the list before it, and its rows come after it. */
  const write = (ids: string[]) => {
    for (const c of ids) {
      if (isBlock(c)) {
        run.push(block(c)); // among the rows it is with
        continue;
      }
      const h = isHeading(c) ? headingOf(store.node(c).text) : null;
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
