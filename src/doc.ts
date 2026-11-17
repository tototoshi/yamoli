/*
 * A document from an outline: the zoomed item read top to bottom as prose.
 *
 *   a row with rows under it (or      a heading (H2 to H4; deeper, a paragraph
 *     blocks, or an embed)            with its rows listed under it)
 *   …ending in 。 or ： (a sentence    a paragraph, its rows under it: a list,
 *     leading into what is under it)   or (are any of them sentences) paragraphs
 *                                     indented under it, and so on down
 *   rows with nothing under them      side by side, a bulleted list when none
 *                                     ends a sentence (。.!? …), else a
 *                                     paragraph each
 *   a task                            a checkbox in a list, either way
 *   a block (Markdown, CSV, image …)  drawn where it is
 *   embed: [[item]] diagram           that item's diagram there (or `mindmap`,
 *                                     else its Gantt chart; no link: the row's own)
 *
 * A row's `doc` field decides instead: `heading` (`見出し`) or `body`
 * (`本文`) for the row itself, `list` (`箇条書き`) or `text` (`段落`) for the
 * rows under it, one of each at most (`doc: heading, list`). Other fields are
 * left out, but for the zoomed item's `description`, which leads the document.
 */
import { refIds } from './links';
import type { OutlineStore } from './model';

export const DOC_KEY = 'doc';

/** How the rows under an item are written out: as a list, or as paragraphs. */
export type DocStyle = 'list' | 'text';
/** Whether a row is a heading, or a line of the body under one. */
export type DocRole = 'heading' | 'body';
type DocWord = DocStyle | DocRole;
const WORDS: Record<string, DocWord> = {
  list: 'list',
  箇条書き: 'list',
  text: 'text',
  段落: 'text',
  heading: 'heading',
  見出し: 'heading',
  body: 'body',
  本文: 'body',
};
const STYLE_WORDS: DocWord[] = ['list', 'text'];

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
  /** auto: what the row would be with no `heading` or `body` on it. */
  | { kind: 'heading'; id: string; level: 2 | 3 | 4; auto: DocRole }
  | { kind: 'para'; id: string; auto: DocRole }
  /**
   * Rows written out as a list (or paragraphs, as style says); under is the
   * item whose rows they are, which `doc` is set on. Listed under a lead-in,
   * they stay in its list (a heading among them would not be one).
   */
  | { kind: 'rows'; under: string; style: DocStyle; auto: boolean; items: DocItem[]; listed?: true }
  /** The rows under a paragraph as paragraphs, indented under it (each with its own, further in). */
  | { kind: 'indent'; under: string; auto: boolean; parts: DocPart[] }
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

/** What id's `doc` field says. */
const docWords = (store: OutlineStore, id: string): DocWord[] =>
  (store.fieldValue(id, DOC_KEY) ?? '')
    .toLowerCase()
    .split(/[\s,、]+/)
    .flatMap((w) => WORDS[w] ?? []);

/** The style `doc` sets on id, if it does. */
export const docStyleOf = (store: OutlineStore, id: string): DocStyle | undefined =>
  docWords(store, id).find((w): w is DocStyle => STYLE_WORDS.includes(w));

/** Whether `doc` makes id a heading or a body line, if it does. */
export const docRoleOf = (store: OutlineStore, id: string): DocRole | undefined =>
  docWords(store, id).find((w): w is DocRole => !STYLE_WORDS.includes(w));

/**
 * Write what `doc` says of id: its role (heading or body) or the style of its
 * rows, the other kept; null takes it off (and the field, left empty).
 */
export function setDoc(store: OutlineStore, id: string, kind: 'role' | 'style', word: DocWord | null) {
  const kept = kind === 'role' ? docStyleOf(store, id) : docRoleOf(store, id);
  const words = kind === 'role' ? [word, kept] : [kept, word];
  const value = words.filter(Boolean).join(', ');
  const f = store.field(id, DOC_KEY);
  if (value) store.setField(id, DOC_KEY, value);
  else if (f) store.remove(f.id);
}

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

  /** Whether rows read as sentences, rather than as a list of words. */
  const sentences = (ids: string[]) => ids.some((r) => ENDS_SENTENCE.test(store.node(r).text));
  /** The rows under a paragraph (which put no headings there): a list, or paragraphs indented under it. */
  const under = (parent: string): DocPart[] => {
    const kids = drawsOwnRows(parent) ? [] : rows(parent);
    if (!kids.length) return [];
    const set = docStyleOf(store, parent);
    if ((set ?? (sentences(kids) ? 'text' : 'list')) === 'list')
      return [{ kind: 'rows', under: parent, style: 'list', auto: !set, items: kids.map(item), listed: true }];
    const inner = kids.flatMap((k): DocPart[] => [{ kind: 'para', id: k, auto: 'body' }, ...extrasOf(k), ...under(k)]);
    return [{ kind: 'indent', under: parent, auto: !set, parts: inner }];
  };

  const parts: DocPart[] = [];
  /** The rows under parent, from depth (0: right under the document). */
  const write = (parent: string, depth: number) => {
    const set = docStyleOf(store, parent);
    let run: string[] = [];
    const flush = () => {
      if (!run.length) return;
      const style = set ?? (sentences(run) ? 'text' : 'list');
      parts.push({ kind: 'rows', under: parent, style, auto: !set, items: run.map(item) });
      run = [];
    };
    for (const c of rows(parent)) {
      const holds = (!drawsOwnRows(c) && rows(c).length > 0) || extrasOf(c).length > 0;
      const role = docRoleOf(store, c);
      // Of itself: a heading when it holds more, in its own place (not one of a list), and is no lead-in or too deep.
      const auto: DocRole = holds && set !== 'list' && !LEADS_IN.test(store.node(c).text) && depth <= 2 ? 'heading' : 'body';
      if (role !== 'heading' && (!holds || (!role && set === 'list'))) {
        run.push(c);
        continue;
      }
      flush();
      if ((role ?? auto) === 'body') {
        // A sentence leading into its rows, or deeper than headings go: they are under it.
        parts.push({ kind: 'para', id: c, auto }, ...extrasOf(c), ...under(c));
        continue;
      }
      parts.push({ kind: 'heading', id: c, level: Math.min(depth + 2, 4) as 2 | 3 | 4, auto });
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
