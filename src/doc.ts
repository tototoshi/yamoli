/*
 * A document from an outline: the zoomed item read top to bottom as prose.
 *
 *   a row with rows under it (or      a heading (H2 to H4; deeper, a paragraph
 *     blocks, or an embed)            with its rows listed under it)
 *   …ending in 。 or ： (a sentence    a paragraph: its rows listed under it, or
 *     leading into what is under it)   (are any of them sentences) its next
 *                                     sentences, all one paragraph
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
  /**
   * A paragraph; more: the rows under it (and theirs) written on in it, as
   * the sentences after its own, which `doc` on it can make a list instead
   * (auto: as nothing set there says).
   */
  | { kind: 'para'; id: string; auto: DocRole; more?: { ids: string[]; auto: boolean } }
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

/** The row whose paragraph id's sentence is written in, when rows under it are written on in it (else null). */
export function joinedParagraph(store: OutlineStore, rootId: string, id: string, opts: { showCompleted?: boolean } = {}): string | null {
  const p = buildDoc(store, rootId, opts).parts.find((p) => p.kind === 'para' && p.more && (p.id === id || p.more.ids.includes(id)));
  return p?.kind === 'para' ? p.id : null;
}

/**
 * Break head's paragraph before at, one of the rows written on in it: at
 * becomes a paragraph of its own right after head, the sentences after it
 * written on in it (the rows they are moved under it, as they hang). It is
 * made body text, unless it ends a sentence anyway: else, holding rows and
 * not yet ending in 。 (as when just made to type in), it would be a heading.
 */
export function splitParagraph(store: OutlineStore, head: string, at: string) {
  const later: string[] = [];
  for (let r = at; r !== head; r = store.parentOf(r)!) {
    const sibs = store.items(store.parentOf(r)!);
    later.push(...sibs.slice(sibs.indexOf(r) + 1));
  }
  const parent = store.parentOf(head)!;
  const kids = store.node(parent).children;
  store.moveTo(at, parent, kids[kids.indexOf(head) + 1] ?? null);
  for (const r of later) store.moveTo(r, at, null);
  if (store.items(at).length && !LEADS_IN.test(store.node(at).text) && !docRoleOf(store, at)) setDoc(store, at, 'role', 'body');
}

/**
 * The row of the paragraph right before the one id's row starts, nothing
 * between them (no heading, list or block); null when there is none, or id
 * starts no paragraph.
 */
export function paragraphBefore(store: OutlineStore, rootId: string, id: string, opts: { showCompleted?: boolean } = {}): string | null {
  let prev: string | null = null;
  for (const p of buildDoc(store, rootId, opts).parts) {
    const heads = p.kind === 'para' ? [p.id] : p.kind === 'rows' && p.style === 'text' ? p.items.map((it) => it.id) : null;
    if (!heads) {
      prev = null;
      continue;
    }
    for (const h of heads) {
      if (h === id) return prev;
      prev = h;
    }
  }
  return null;
}

/**
 * Join id's paragraph on to prev's (Backspace at its start): its row, and the
 * rows under it, go last under prev's, written on in it. An empty row goes,
 * its rows moved for it. prev's paragraph stays one (not a heading for the
 * rows it now holds, nor a list of them). Returns the row the caret goes to,
 * at its start, or (id gone) the sentence it went on from, at its end.
 */
export function joinParagraph(store: OutlineStore, rootId: string, prev: string, id: string, opts: { showCompleted?: boolean } = {}) {
  let last = prev;
  while (store.items(last).length) last = store.items(last).at(-1)!;
  const empty = !store.node(id).text;
  for (const r of empty ? store.items(id) : [id]) store.moveTo(r, prev, null);
  if (empty) store.remove(id);
  else if (docRoleOf(store, id) === 'body') setDoc(store, id, 'role', null);
  const part = () => buildDoc(store, rootId, opts).parts.find((p) => (p.kind === 'heading' || p.kind === 'para') && p.id === prev);
  if (part()?.kind === 'heading') setDoc(store, prev, 'role', 'body');
  if (store.items(prev).length && joinedParagraph(store, rootId, prev, opts) !== prev) setDoc(store, prev, 'style', 'text');
  return empty ? { id: last, at: 'end' as const } : { id, at: 0 };
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
  /** The rows under id and theirs, in order (but those an embed draws). */
  const within = (id: string): string[] => (drawsOwnRows(id) ? [] : rows(id).flatMap((k) => [k, ...within(k)]));
  /** A row as a paragraph (no headings in it): the rows under it listed under it, or written on in it as its sentences. */
  const paragraph = (id: string, auto: DocRole): DocPart[] => {
    const kids = drawsOwnRows(id) ? [] : rows(id);
    const set = docStyleOf(store, id);
    if (!kids.length) return [{ kind: 'para', id, auto }, ...extrasOf(id)];
    if ((set ?? (sentences(kids) ? 'text' : 'list')) === 'list')
      return [
        { kind: 'para', id, auto },
        ...extrasOf(id),
        { kind: 'rows', under: id, style: 'list', auto: !set, items: kids.map(item), listed: true },
      ];
    const more = within(id);
    return [{ kind: 'para', id, auto, more: { ids: more, auto: !set } }, ...[id, ...more].flatMap(extrasOf)];
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
