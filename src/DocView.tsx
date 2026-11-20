/*
 * Document view: the zoomed item written out (see doc.ts): its rows as a
 * bulleted list (rows marked so as paragraphs among them), `#` rows as
 * headings, its blocks and embedded drawings among them. Text can be selected and copied across lines; a click (not a drag)
 * edits the line's row right there, as in the outline (Enter a new row after
 * it, Tab under the one above, and so on). It can also show an outline of its
 * own, only to be read (the guide). With a few headings, their contents go at
 * the side, the one being read marked.
 */
import { createContext, type ComponentChildren } from 'preact';
import { useContext, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useCtl } from './context';
import { DiagramView } from './DiagramView';
import { buildDoc, docContents, type DocItem, type DocPart, type Extra } from './doc';
import DOMPurify from 'dompurify';
import { formatArg, getFormat, markdown } from './formats';
import { toDocMarkdown } from './serialize';
import { GanttView } from './GanttView';
import { t } from './i18n';
import { BlockBody, LangInput, NodeText, useRendered } from './App';
import { fText } from './focus';
import { useFlowEditor } from './flowEditor';
import { InlineText } from './InlineText';
import { setStyle, type OutlineStore } from './model';
import { headingOf, lineAt, occurrences, replaceIn, withHeading } from './doc';
import type { Controller } from './controller';

/** The outline written out, and whether it is only to be read (none: the one being edited). */
const Source = createContext<{ store: OutlineStore; readOnly: boolean } | null>(null);

/** The outline the document is of, and whether its lines can be edited. */
function useSource() {
  const ctl = useCtl();
  const src = useContext(Source);
  return { store: src?.store ?? ctl.store, readOnly: !!src?.readOnly, ctl };
}

/** Contents at the side from this many headings; fewer, the document alone. */
const CONTENTS_FROM = 3;

/**
 * A document, written out from the zoomed item; or from rootId of store, only
 * to be read, under a title of its own and with aside above its contents.
 */
export function DocView({
  store,
  rootId,
  title,
  aside,
}: { store?: OutlineStore; rootId?: string; title?: string; aside?: ComponentChildren } = {}) {
  const ctl = useCtl();
  const from = store ?? ctl.store;
  const doc = buildDoc(from, rootId ?? ctl.zoomId, { showCompleted: store ? true : ctl.prefs.showCompleted });
  const contents = docContents(from, doc.parts);
  const withContents = contents.length >= CONTENTS_FROM;
  const body = (
    <div class={'doc-page' + (withContents || aside ? ' with-contents' : '') + (store ? ' read-only' : '')}>
      {(withContents || aside) && (
        <nav class="doc-toc" aria-label={t('目次', 'Contents')}>
          {aside}
          {withContents && <Contents items={contents} />}
        </nav>
      )}
      <div class="doc-main" onClick={store ? undefined : (e) => toLineAt(e, ctl)}>
        {!store && (doc.lead || doc.parts.length > 0) && <CopyDoc />}
        {title && <h1 class="doc-title">{title}</h1>}
        <DocBody lead={doc.lead} parts={doc.parts} />
      </div>
    </div>
  );
  if (store) return <Source.Provider value={{ store, readOnly: true }}>{body}</Source.Provider>;
  return (
    <>
      <DocFind />
      {body}
    </>
  );
}

/** An occurrence found in the document: row id's k-th, of count in its text as drawn, and where it is drawn. */
interface Hit {
  id: string;
  k: number;
  count: number;
  range: Range;
}

/** Where query is in the rows drawn in main (not in an embedded drawing's), top to bottom. */
function findHits(main: Element, query: string): Hit[] {
  const hits: Hit[] = [];
  for (const el of main.querySelectorAll<HTMLElement>('.text-view[data-id]')) {
    if (el.closest('.doc-embed')) continue;
    // The row's text nodes, and where each starts in its text.
    const nodes: [Text, number][] = [];
    let text = '';
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode() as Text | null; n; n = walk.nextNode() as Text | null) {
      nodes.push([n, text.length]);
      text += n.data;
    }
    const at = occurrences(text, query);
    const point = (i: number, end: boolean): [Text, number] => {
      // The node it falls in: for an end, the one it closes (not the next, starting there).
      let j = nodes.length - 1;
      while (j > 0 && (end ? nodes[j][1] >= i : nodes[j][1] > i)) j--;
      return [nodes[j][0], i - nodes[j][1]];
    };
    at.forEach((i, k) => {
      const range = document.createRange();
      range.setStart(...point(i, false));
      range.setEnd(...point(i + query.length, true));
      hits.push({ id: el.dataset.id!, k, count: at.length, range });
    });
  }
  return hits;
}

/**
 * The Document view's find bar (⌘F): the text found marked where it is drawn, Enter / Shift+Enter going from one to
 * the next, and what it is replaced by, one at a time or all at once (as one undo step). A place whose row is written
 * otherwise than drawn (a link's label) is left as it is.
 */
function DocFind() {
  const ctl = useCtl();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [by, setBy] = useState('');
  const [at, setAt] = useState(0);
  const [hits, setHits] = useState<Hit[]>([]);
  const [note, setNote] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const jump = useRef(false);
  const asked = ctl.findAsked;
  useEffect(() => {
    if (!asked) return;
    setOpen(true);
    requestAnimationFrame(() => (input.current?.focus(), input.current?.select()));
  }, [asked]);
  // The places found, again whenever the document is drawn anew.
  useEffect(() => {
    const main = document.querySelector('.doc-main');
    if (!open || !query || !main) return setHits([]);
    let frame = 0;
    const scan = () => {
      frame = 0;
      setHits(findHits(main, query));
    };
    scan();
    const watch = new MutationObserver(() => (frame ||= requestAnimationFrame(scan)));
    watch.observe(main, { subtree: true, childList: true, characterData: true });
    return () => (watch.disconnect(), cancelAnimationFrame(frame));
  }, [open, query]);
  const cur = hits.length ? Math.min(at, hits.length - 1) : -1;
  useEffect(() => {
    const marks = typeof CSS !== 'undefined' ? CSS.highlights : undefined;
    if (!marks || !hits.length) return;
    marks.set('doc-find', new Highlight(...hits.map((h) => h.range)));
    if (cur >= 0) marks.set('doc-find-at', new Highlight(hits[cur].range));
    if (cur >= 0 && jump.current) reveal(hits[cur].range);
    jump.current = false;
    return () => (marks.delete('doc-find'), marks.delete('doc-find-at'));
  }, [hits, cur]);
  if (!open) return null;

  const go = (i: number) => {
    if (!hits.length) return;
    jump.current = true;
    setAt((i + hits.length) % hits.length);
    if (i % hits.length === cur) reveal(hits[cur].range);
  };
  const { store } = ctl;
  /** The caret back in the bar from a button, which (nothing found any more) may be turned off and lose it. */
  const keep = () => document.activeElement?.tagName === 'BUTTON' && input.current?.focus();
  /** Whether the row's text, as written, has query where it is drawn (so the k-th there is the k-th drawn). */
  const same = (h: Hit) => occurrences(store.node(h.id).text, query).length === h.count;
  const replaceOne = () => {
    const h = hits[cur];
    if (!h) return;
    if (!same(h)) return setNote(t('ここは置き換えられません（リンクなど）', "This one can't be replaced (a link …)"));
    store.setText(h.id, replaceIn(store.node(h.id).text, query, by, h.k));
    jump.current = true;
    // Past what was put in, when it has the text found in it too.
    if (by.toLowerCase().includes(query.toLowerCase())) setAt(cur + 1);
    setNote('');
    ctl.commit();
    keep();
  };
  const replaceAll = () => {
    let done = 0;
    let left = 0;
    for (const id of new Set(hits.map((h) => h.id))) {
      const h = hits.find((x) => x.id === id)!;
      if (!same(h)) {
        left += h.count;
        continue;
      }
      store.setText(id, replaceIn(store.node(id).text, query, by, null));
      done += h.count;
    }
    if (done) ctl.commit();
    keep();
    setNote(
      t(`${done} 件置き換えました`, `Replaced ${done}`) +
        (left ? t(`（${left} 件はリンクなどで残しました）`, ` (${left} left: links …)`) : '')
    );
  };
  const close = () => {
    setOpen(false);
    setNote('');
  };
  return (
    <div
      class="doc-find"
      role="search"
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') close();
      }}
    >
      <input
        ref={input}
        class="doc-find-query"
        value={query}
        placeholder={t('文書内を検索', 'Find in document')}
        onInput={(e) => {
          setQuery(e.currentTarget.value);
          setAt(0);
          setNote('');
          jump.current = true;
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || e.isComposing) return;
          e.preventDefault();
          go(cur + (e.shiftKey ? -1 : 1));
        }}
      />
      <span class="doc-find-count">{query ? (hits.length ? `${cur + 1} / ${hits.length}` : t('なし', 'None')) : ''}</span>
      <button class="mini" title={t('前へ（Shift+Enter）', 'Previous (Shift+Enter)')} disabled={!hits.length} onClick={() => go(cur - 1)}>
        ↑
      </button>
      <button class="mini" title={t('次へ（Enter）', 'Next (Enter)')} disabled={!hits.length} onClick={() => go(cur + 1)}>
        ↓
      </button>
      <input
        class="doc-find-by"
        value={by}
        placeholder={t('置換後', 'Replace with')}
        onInput={(e) => setBy(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || e.isComposing) return;
          e.preventDefault();
          replaceOne();
        }}
      />
      <button class="mini" disabled={!hits.length} onClick={replaceOne}>
        {t('置換', 'Replace')}
      </button>
      <button class="mini" disabled={!hits.length} onClick={replaceAll}>
        {t('すべて置換', 'Replace all')}
      </button>
      <button class="mini" title={t('閉じる（Esc）', 'Close (Esc)')} onClick={close}>
        ×
      </button>
      {note && <span class="doc-find-note">{note}</span>}
    </div>
  );
}

/** Scroll the place found into the middle of the window, unless it is in sight already. */
function reveal(range: Range) {
  const r = range.getBoundingClientRect();
  if (r.top < 100 || r.bottom > innerHeight - 40) scrollBy({ top: r.top - innerHeight / 2, behavior: 'smooth' });
}

/**
 * A click in the document away from any text (beside a line, between lines, below the last): the caret goes into the
 * line at that height, at its start when left of its text, else at its end; below them all, at the end of the last.
 */
function toLineAt(e: MouseEvent, ctl: Controller) {
  const main = e.currentTarget as HTMLElement;
  const hit = e.target as Element;
  const own = '.text-view, .rich, a, button, input, select, textarea, label, .doc-block, .doc-code, .doc-embed, .doc-rule, .doc-lead';
  if (hit.closest(own) || document.getSelection()?.toString()) return;
  // Each line's text as far down the page as it goes (the one being typed in too; an embedded drawing's own left out).
  const lines = [...main.querySelectorAll<HTMLElement>('.text-view[data-id], textarea[data-fk^="text:"]')]
    .filter((v) => !v.closest('.doc-embed'))
    .map((v) => {
      const rs = [...v.getClientRects()];
      const box = v.getBoundingClientRect();
      const id = v.dataset.id ?? v.dataset.fk!.slice('text:'.length);
      return { id, top: rs[0]?.top ?? box.top, bottom: rs.at(-1)?.bottom ?? box.bottom, left: rs[0]?.left ?? box.left };
    });
  const line = lineAt(lines, e.clientX, e.clientY);
  if (!line) return;
  const text = ctl.store.node(line.id).text;
  const start = ctl.store.node(line.id).key === null ? (headingOf(text)?.prefix ?? 0) : 0;
  ctl.focus(fText(line.id, line.start ? start : 'end'));
}

/**
 * Copies the document: formatted (headings, lists, code, tables) for pasting into mail or other documents, and as
 * Markdown where only plain text goes.
 */
function CopyDoc() {
  const ctl = useCtl();
  const [copied, setCopied] = useState(false);
  const copy = () => {
    const text = toDocMarkdown(ctl.store, ctl.zoomId, (id) => ctl.shownChildren(id));
    const html = DOMPurify.sanitize(markdown(text));
    const blob = (s: string, type: string) => new Blob([s], { type });
    navigator.clipboard
      .write([new ClipboardItem({ 'text/html': blob(html, 'text/html'), 'text/plain': blob(text, 'text/plain') })])
      .catch(() => navigator.clipboard.writeText(text))
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      });
  };
  return (
    <div class="doc-tools">
      <button
        class="mini"
        title={t('書式付きでコピー（プレーンテキストの貼り先には Markdown）', 'Copy formatted (Markdown where only plain text goes)')}
        onClick={copy}
      >
        {copied ? t('コピーしました', 'Copied') : t('文書をコピー', 'Copy document')}
      </button>
    </div>
  );
}

/** The headings to go to, the one being read marked. */
function Contents({ items }: { items: { id: string; level: 1 | 2; text: string }[] }) {
  const [at, setAt] = useState<string | null>(null);
  const ids = items.map((h) => h.id).join(' ');
  useEffect(() => {
    // The section being read: the last heading above the top of the window (under the top bar).
    let frame = 0;
    const update = () => {
      frame = 0;
      let now: string | null = null;
      for (const id of ids.split(' ')) {
        const el = document.querySelector(`[data-doc-id="${id}"]`);
        if (el && el.getBoundingClientRect().top <= 96) now = id;
        else if (el) break;
      }
      setAt(now);
    };
    const onScroll = () => (frame ||= requestAnimationFrame(update));
    update();
    addEventListener('scroll', onScroll, { passive: true });
    return () => {
      removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
    };
  }, [ids]);
  return (
    <>
      {items.map((h) => (
        <button
          key={h.id}
          class={'doc-toc-item level-' + (h.level + 1) + (h.id === at ? ' at' : '')}
          onClick={() => document.querySelector(`[data-doc-id="${h.id}"]`)?.scrollIntoView({ behavior: 'smooth' })}
        >
          {h.text}
        </button>
      ))}
    </>
  );
}

function DocBody({ lead, parts }: { lead?: string; parts: DocPart[] }) {
  const doc = { lead, parts };
  if (!doc.lead && !doc.parts.length) {
    return (
      <p class="doc-empty">
        {t('まだ何も書かれていません。行を足すと、ここに文書として出ます。', 'Nothing written yet. Rows added show here as a document.')}
      </p>
    );
  }
  return (
    <article class="doc">
      {doc.lead && (
        <p class="doc-lead">
          <InlineText text={doc.lead} />
        </p>
      )}
      {doc.parts.map((p, i) => (
        <Part key={i} part={p} />
      ))}
    </article>
  );
}

/** A row's text, edited in place when clicked (the outline's own row editor); only to be read, drawn. */
function Text({ id }: { id: string }) {
  const { store, readOnly } = useSource();
  if (readOnly) {
    return (
      <span class="text text-view">
        <InlineText text={withHeading(store.node(id).text, 0)} />
      </span>
    );
  }
  return <NodeText node={store.node(id)} />;
}

function Part({ part }: { part: DocPart }) {
  if (part.kind === 'heading') return <Heading id={part.id} level={part.level} />;
  if (part.kind === 'rows') return <Rows items={part.items} />;
  return <ExtraView extra={part} />;
}

/** A `#` row; its `#`s show only while it is typed in. */
function Heading({ id, level }: { id: string; level: 1 | 2 | 3 }) {
  const H = `h${level + 1}` as 'h2';
  return (
    <H class="doc-line" data-doc-id={id}>
      <Text id={id} />
    </H>
  );
}

/** A task's checkbox, which completes it (or opens it again). */
function Check({ id }: { id: string }) {
  const { store, readOnly, ctl } = useSource();
  const n = store.node(id);
  if (!n.task && !n.completed) return null;
  return <input type="checkbox" class="doc-check" checked={n.completed} disabled={readOnly} onChange={() => ctl.toggleComplete(id)} />;
}

/** Rows side by side, with the switch making them all paragraphs (or all list items) at their side. */
function Rows({ items }: { items: (DocItem | Extra)[] }) {
  const { ctl, readOnly } = useSource();
  const rows = items.filter((it): it is DocItem => it.kind === 'item');
  const para = !rows.every((it) => it.para);
  return (
    <div class="doc-rows">
      {!readOnly && rows.length > 0 && (
        <button
          class="mini doc-style"
          title={t(
            '行のまとまりを段落 / 箇条書きにする（1 行だけなら、行の先頭で Backspace か - ）',
            'Make these rows paragraphs or a list (one row: Backspace at its start, or - )'
          )}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            for (const it of rows) setStyle(ctl.store.node(it.id), para ? 'paragraph' : 'list');
            ctl.commit(null);
          }}
        >
          {para ? t('段落にする', 'Paragraphs') : t('箇条書きにする', 'List')}
        </button>
      )}
      <Flow items={items} />
    </div>
  );
}

/** How a row is drawn among its neighbours: rows drawn the same way one after another go together (but paragraphs). */
const runOf = (it: DocItem) => (it.rule ? 'rule' : it.para ? 'p' : it.quote ? 'quote' : it.numbered ? 'ol' : 'ul');

/** Rows in order: list items together in a list (numbered ones in a numbered list), quotations together, paragraphs,
 * dividing lines and blocks between. */
function Flow({ items }: { items: (DocItem | Extra)[] }) {
  const runs: (DocItem[] | Extra)[] = [];
  for (const it of items) {
    const last = runs.at(-1);
    if (it.kind !== 'item') runs.push(it);
    else if (Array.isArray(last) && runOf(it) === runOf(last[0]) && !['p', 'rule'].includes(runOf(it))) last.push(it);
    else runs.push([it]);
  }
  return (
    <>
      {runs.map((r) => {
        if (!Array.isArray(r)) return <ExtraView key={r.id} extra={r} />;
        const run = runOf(r[0]);
        if (run === 'rule') return <Rule key={r[0].id} id={r[0].id} />;
        if (run === 'p') return <Paragraph key={r[0].id} item={r[0]} />;
        if (run === 'quote')
          return (
            <blockquote key={r[0].id} class="doc-quote">
              {r.map((it) => (
                <Paragraph key={it.id} item={it} />
              ))}
            </blockquote>
          );
        return <List key={r[0].id} items={r} numbered={run === 'ol'} />;
      })}
    </>
  );
}

/** A dividing line (a `---` row): its `---` shows only while it is typed in. */
function Rule({ id }: { id: string }) {
  const { readOnly, ctl } = useSource();
  const ref = useRef<HTMLDivElement>(null);
  useFlowEditor(ref);
  return (
    <div
      ref={ref}
      class="doc-line doc-p doc-rule"
      onClick={(e) => !readOnly && !(e.target as Element).closest('.rich') && ctl.focus(fText(id, 'end'))}
    >
      <Text id={id} />
    </div>
  );
}

/** A row as a paragraph; the rows under it come after it. */
function Paragraph({ item }: { item: DocItem }) {
  const { store } = useSource();
  const ref = useRef<HTMLDivElement>(null);
  useFlowEditor(ref);
  return (
    <>
      {/* A div, not a p: the row editor in it is one. */}
      <div ref={ref} class={'doc-line doc-p' + (store.node(item.id).completed ? ' done' : '')}>
        <Check id={item.id} />
        <Text id={item.id} />
      </div>
      {item.extras.map((x, i) => (
        <ExtraView key={i} extra={x} />
      ))}
      <Flow items={item.items} />
    </>
  );
}

function List({ items, numbered }: { items: DocItem[]; numbered: boolean }) {
  const { store } = useSource();
  const L = numbered ? 'ol' : 'ul';
  return (
    <L class={items.every((it) => it.task) ? 'doc-tasks' : undefined}>
      {items.map((it) => (
        <ListItem key={it.id} item={it} done={store.node(it.id).completed} />
      ))}
    </L>
  );
}

function ListItem({ item, done }: { item: DocItem; done: boolean }) {
  const ref = useRef<HTMLLIElement>(null);
  useFlowEditor(ref);
  return (
    <li ref={ref} class={(item.task ? 'task' : '') + (done ? ' done' : '')}>
      <span class="doc-line">
        <Check id={item.id} />
        <Text id={item.id} />
      </span>
      {item.extras.map((x, i) => (
        <ExtraView key={i} extra={x} />
      ))}
      <Flow items={item.items} />
    </li>
  );
}

function ExtraView({ extra }: { extra: Extra }) {
  if (extra.kind === 'data') return <Block id={extra.id} />;
  return (
    <div class={'doc-embed embed-' + extra.as}>
      {extra.as === 'gantt' ? (
        <GanttView rootId={extra.id} embedded edit />
      ) : (
        <DiagramView rootId={extra.id} embedded edit zoomable kind={extra.as === 'mindmap' ? 'tree' : 'flow'} />
      )}
    </div>
  );
}

/** A block as its format draws it, edited in place when clicked (folded in the outline or not). */
function Block({ id }: { id: string }) {
  const { store, readOnly, ctl } = useSource();
  const n = store.node(id);
  const html = useRendered(n.format!, n.text);
  const code = getFormat(n.format!).name === 'code';
  if (!readOnly && ctl.activeField === fText(id).key) return <BlockBody node={n} />;
  const view = readOnly ? (
    <div class="data-view doc-block" data-format={n.format} dangerouslySetInnerHTML={{ __html: html }} />
  ) : (
    <div
      class="data-view doc-block"
      data-format={n.format}
      title={t('クリックして編集（Esc で終了）', 'Click to edit (Esc to finish)')}
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={(e) => !(e.target as Element).closest('a') && !document.getSelection()?.toString() && ctl.focus(fText(id, 'end'))}
    />
  );
  if (!code) return view;
  // Code: in its corner, a button copying it and its language (to change there, where it can be edited).
  return (
    <div class="doc-code">
      {view}
      <span class="doc-corner">
        <CopyCode text={n.text} />
        {readOnly ? <span class="doc-lang">{formatArg(n.format!)}</span> : <LangInput node={n} class="doc-lang" />}
      </span>
    </div>
  );
}

/** Copies a code block's text, saying so on itself for a moment. */
function CopyCode({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => setDone(false), 1500);
    return () => clearTimeout(timer);
  }, [done]);
  return (
    <button
      class="mini doc-copy"
      title={t('コードをコピー', 'Copy the code')}
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(text).then(
          () => setDone(true),
          () => {}
        );
      }}
    >
      {done ? t('コピーしました', 'Copied') : t('コピー', 'Copy')}
    </button>
  );
}
