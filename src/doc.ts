/*
 * A document from an outline: the zoomed item read top to bottom as prose.
 *
 *   a row with rows under it (or      a heading (H2 to H4; deeper, a paragraph
 *     blocks, or an embed)            with its rows listed under it)
 *   …ending in 。 or ： (a sentence    a paragraph: its rows paragraphs after it,
 *     leading into what is under it)   not indented (after 。, or if any of them
 *                                     is a sentence), else listed under it
 *   a row                             one paragraph at most: its sentences are
 *                                     written in it, not in rows of their own
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
  /** Its items are paragraphs after it (else a list under it). */
  text: boolean;
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
  | Extra;

export interface Doc {
  /** The zoomed item's `description`. */
  lead?: string;
  parts: DocPart[];
}

/** Text ending a sentence, or leading into what follows (`…は次のとおり：`). */
const ENDS_SENTENCE = /[。．.!?！？]\s*$/;
const LEADS_IN = /[。．:：]\s*$/;
/** Text leading into a list (`…は次のとおり：`). */
const LEADS_TO = /[:：]\s*$/;
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
  /** Whether rows read as sentences, rather than as a list of words. */
  const sentences = (ids: string[]) => ids.some((r) => ENDS_SENTENCE.test(store.node(r).text));
  /**
   * How the rows under id are written: as `doc` on it says; else a list
   * after a lead-in (`…次のとおり：`), paragraphs under a sentence or when any
   * of them is one (so a row does not turn a list item while typed in).
   */
  const styleUnder = (id: string, kids: string[]): DocStyle => {
    const text = store.node(id).text;
    return docStyleOf(store, id) ?? (!LEADS_TO.test(text) && (ENDS_SENTENCE.test(text) || sentences(kids)) ? 'text' : 'list');
  };
  const item = (id: string): DocItem => {
    const kids = drawsOwnRows(id) ? [] : rows(id);
    return { id, task: store.isTask(id), items: kids.map(item), text: styleUnder(id, kids) === 'text', extras: extrasOf(id) };
  };
  /** A row as a paragraph (no headings in it): the rows under it listed under it, or paragraphs after it. */
  const paragraph = (id: string, auto: DocRole): DocPart[] => {
    const kids = drawsOwnRows(id) ? [] : rows(id);
    const own: DocPart[] = [{ kind: 'para', id, auto }, ...extrasOf(id)];
    if (!kids.length) return own;
    const style = styleUnder(id, kids);
    return [...own, { kind: 'rows', under: id, style, auto: !docStyleOf(store, id), items: kids.map(item), listed: true }];
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
        parts.push(...paragraph(c, auto));
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

/** A document's contents: its headings two levels deep, in order, their text without markup. */
export const docContents = (store: OutlineStore, parts: DocPart[]): { id: string; level: 2 | 3; text: string }[] =>
  parts.flatMap((p) =>
    p.kind === 'heading' && p.level < 4 ? [{ id: p.id, level: p.level as 2 | 3, text: store.node(p.id).text.replace(/[`*~]/g, '') }] : []
  );

/**
 * Whether id, written out in the document of rootId, is a heading or body text
 * now and with no `doc` on it; null where it can't be made either (a row
 * listed inside another, or one not in the document).
 */
export function docRoleAt(store: OutlineStore, rootId: string, id: string): { now: DocRole; auto: DocRole } | null {
  for (const p of buildDoc(store, rootId).parts) {
    if ((p.kind === 'heading' || p.kind === 'para') && p.id === id) return { now: p.kind === 'heading' ? 'heading' : 'body', auto: p.auto };
    if (p.kind === 'rows' && !p.listed && p.items.some((it) => it.id === id)) return { now: 'body', auto: 'body' };
  }
  return null;
}

/** Make id a heading or body text in the document of rootId; false where it can't be. */
export function setDocRole(store: OutlineStore, rootId: string, id: string, to: DocRole): boolean {
  const at = docRoleAt(store, rootId, id);
  if (!at || at.now === to) return false;
  setDoc(store, id, 'role', to === at.auto ? null : to);
  return true;
}
