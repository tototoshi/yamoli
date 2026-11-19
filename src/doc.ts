/*
 * A document from an outline: the zoomed item read top to bottom as prose,
 * from how its rows are laid out and what `doc` says, not from their wording
 * (no punctuation read, no empty rows needed).
 *
 *   a row with rows (or an embed)    a heading (two levels; deeper, or with
 *     under it, only such after it     rows holding nothing after it, a line
 *                                      of the body). Rows before it in the
 *                                      same place are its section's opening
 *   the other rows side by side      a bulleted list; a paragraph each under
 *                                     `doc: text`, which holds for the
 *                                     sections under that row too
 *   rows under a line of the body    a list nested under it
 *   a task                           a checkbox, either way
 *   a block (Markdown, CSV, image …) drawn where it is
 *   embed: [[item]] diagram          that item's diagram there (or `mindmap`,
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
  /** Marked as a task (or completed): drawn with a checkbox. */
  task: boolean;
  items: DocItem[];
  /** Its items are paragraphs after it (else a list under it). */
  text: boolean;
  extras: Extra[];
  /** What the row would be with no `heading` or `body` on it (said of the rows side by side, not nested ones). */
  auto: DocRole;
}

export type DocPart =
  /** auto: what the row would be with no `heading` or `body` on it. */
  | { kind: 'heading'; id: string; level: 2 | 3 | 4; auto: DocRole }
  /** Rows side by side, as a list or as paragraphs (as style says); under is the item `doc` is set on for them. */
  | { kind: 'rows'; under: string; style: DocStyle; auto: boolean; items: DocItem[] }
  | Extra;

export interface Doc {
  /** The zoomed item's `description`. */
  lead?: string;
  parts: DocPart[];
}

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
  const rowsOf = (id: string) => (drawsOwnRows(id) ? [] : rows(id));
  /** A row as a line of the body, the rows under it a list nested in it (or paragraphs after it, as `doc` says). */
  const item = (id: string, auto: DocRole = 'body'): DocItem => ({
    id,
    task: store.node(id).task || store.node(id).completed,
    items: rowsOf(id).map((c) => item(c)),
    text: docStyleOf(store, id) === 'text',
    extras: extrasOf(id),
    auto,
  });

  const parts: DocPart[] = [];
  /** The rows under parent, from depth (0: right under the document); styled: a `doc` style from a row above. */
  const write = (parent: string, depth: number, styled?: DocStyle) => {
    const set = docStyleOf(store, parent);
    const kids = rows(parent);
    // Headings of themselves: the rows holding rows (or a drawing) at the end, with nothing but such rows after them,
    // two levels deep. A row holding only blocks is a paragraph with them.
    const auto = new Map<string, DocRole>();
    // (What comes after a heading is its section's, so only what a row is followed by in its own place counts.)
    const can = depth <= 1 && set !== 'list';
    let sections = can;
    for (const c of [...kids].reverse()) {
      const own: DocRole = sections && (rowsOf(c).length > 0 || embedOf(c) !== null) ? 'heading' : 'body';
      auto.set(c, own);
      sections = can && (docRoleOf(store, c) ?? own) === 'heading';
    }
    let run: DocItem[] = [];
    const flush = () => {
      if (run.length) parts.push({ kind: 'rows', under: parent, style: set ?? styled ?? 'list', auto: !set, items: run });
      run = [];
    };
    for (const c of kids) {
      if ((docRoleOf(store, c) ?? auto.get(c)) !== 'heading') {
        run.push(item(c, auto.get(c)));
        continue;
      }
      flush();
      parts.push({ kind: 'heading', id: c, level: Math.min(depth + 2, 4) as 2 | 3 | 4, auto: auto.get(c)! });
      parts.push(...extrasOf(c));
      if (!drawsOwnRows(c)) write(c, depth + 1, set ?? styled);
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
 * nested in another, or one not in the document).
 */
export function docRoleAt(store: OutlineStore, rootId: string, id: string): { now: DocRole; auto: DocRole } | null {
  for (const p of buildDoc(store, rootId).parts) {
    if (p.kind === 'heading' && p.id === id) return { now: 'heading', auto: p.auto };
    const it = p.kind === 'rows' ? p.items.find((i) => i.id === id) : undefined;
    if (it) return { now: 'body', auto: it.auto };
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
