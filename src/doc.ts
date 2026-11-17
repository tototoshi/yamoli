/*
 * A document from an outline: the zoomed item read top to bottom as prose.
 *
 *   a row with rows under it (or      a heading (H2 to H4; deeper, a paragraph
 *     blocks, or an embed)            with its rows listed under it)
 *   …ending in 。 or ： (a sentence    a paragraph, its rows a bulleted list
 *     leading into what is under it)
 *   rows with nothing under them      side by side, a bulleted list when none
 *                                     ends a sentence (。.!? …), else a
 *                                     paragraph each
 *   a task                            a checkbox in a list, either way
 *   a block (Markdown, CSV, image …)  drawn where it is
 *   embed: [[item]] diagram           that item's diagram there (or `mindmap`,
 *                                     else its Gantt chart; no link: the row's own)
 *
 * `doc: list` (`箇条書き`) or `doc: text` (`段落`) on a row decides for the
 * rows under it instead. Other fields are left out, but for the zoomed
 * item's `description`, which leads the document.
 */
import { refIds } from './links';
import type { OutlineStore } from './model';

export const DOC_KEY = 'doc';

/** How the rows under an item are written out: as a list, or as paragraphs. */
export type DocStyle = 'list' | 'text';
const STYLES: Record<string, DocStyle> = { list: 'list', 箇条書き: 'list', text: 'text', 段落: 'text' };

/** What an `embed` draws. */
export type EmbedAs = 'gantt' | 'diagram' | 'mindmap';

/** A block or an embedded drawing, among the rows. */
export type Extra = { kind: 'data'; id: string } | { kind: 'embed'; id: string; as: EmbedAs };

export interface DocItem {
  id: string;
  /** A task: drawn with a checkbox. */
  task: boolean;
  items: DocItem[];
  extras: Extra[];
}

export type DocPart =
  | { kind: 'heading'; id: string; level: 2 | 3 | 4 }
  | { kind: 'para'; id: string }
  /** Rows written out as a list (or paragraphs, as style says); under is the item whose rows they are, which `doc` is set on. */
  | { kind: 'rows'; under: string; style: DocStyle; auto: boolean; items: DocItem[] }
  | Extra;

export interface Doc {
  /** The zoomed item's `description`. */
  lead?: string;
  parts: DocPart[];
}

/** Text ending a sentence, or leading into what follows (`…は次のとおり：`). */
const ENDS_SENTENCE = /[。．.!?！？]\s*$/;
const LEADS_IN = /[。．:：]\s*$/;
/** Fields that set up the views, not what the document says. */
const QUIET = new Set(['views', DOC_KEY, 'description']);

/** The style `doc` sets on id, if it does. */
export const docStyleOf = (store: OutlineStore, id: string): DocStyle | undefined =>
  STYLES[store.fieldValue(id, DOC_KEY)?.toLowerCase() ?? ''];

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
  const drawsOwnRows = (id: string) => embedOf(id)?.id === id;
  const item = (id: string): DocItem => ({
    id,
    task: store.isTask(id),
    items: drawsOwnRows(id) ? [] : rows(id).map(item),
    extras: extrasOf(id),
  });

  const parts: DocPart[] = [];
  /** The rows under parent, from depth (0: right under the document). */
  const write = (parent: string, depth: number) => {
    const set = docStyleOf(store, parent);
    let run: string[] = [];
    const flush = () => {
      if (!run.length) return;
      const style = set ?? (run.some((r) => ENDS_SENTENCE.test(store.node(r).text)) ? 'text' : 'list');
      parts.push({ kind: 'rows', under: parent, style, auto: !set, items: run.map(item) });
      run = [];
    };
    for (const c of rows(parent)) {
      const under = drawsOwnRows(c) ? [] : rows(c);
      if ((!under.length && !extrasOf(c).length) || set === 'list') {
        run.push(c);
        continue;
      }
      flush();
      const text = store.node(c).text;
      if (LEADS_IN.test(text) || depth > 2) {
        // A sentence leading into its rows, or deeper than headings go: they are listed under it.
        parts.push({ kind: 'para', id: c });
        parts.push(...extrasOf(c));
        if (docStyleOf(store, c) === 'text' && !drawsOwnRows(c)) write(c, depth + 1);
        else if (under.length) parts.push({ kind: 'rows', under: c, style: 'list', auto: !docStyleOf(store, c), items: under.map(item) });
        continue;
      }
      parts.push({ kind: 'heading', id: c, level: (depth + 2) as 2 | 3 | 4 });
      parts.push(...extrasOf(c));
      if (!drawsOwnRows(c)) write(c, depth + 1);
    }
    flush();
  };
  parts.push(...extrasOf(rootId));
  if (!drawsOwnRows(rootId)) write(rootId, 0);
  const lead = rootId !== store.rootId ? store.fieldValue(rootId, 'description') : undefined;
  return { ...(lead && { lead }), parts };
}
