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
import { getFormat, renderFormat } from './formats';
import { GanttView } from './GanttView';
import { t } from './i18n';
import { BlockBody, LangInput, NodeText } from './App';
import { fText } from './focus';
import { useFlowEditor } from './flowEditor';
import { InlineText } from './InlineText';
import type { OutlineStore } from './model';
import { withHeading } from './doc';

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
      <div class="doc-main">
        {title && <h1 class="doc-title">{title}</h1>}
        <DocBody lead={doc.lead} parts={doc.parts} />
      </div>
    </div>
  );
  return store ? <Source.Provider value={{ store, readOnly: true }}>{body}</Source.Provider> : body;
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
            for (const it of rows) ctl.store.node(it.id).paragraph = para;
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

/** Rows in order: list items together in a list, paragraphs and blocks between. */
function Flow({ items }: { items: (DocItem | Extra)[] }) {
  const runs: (DocItem[] | Extra)[] = [];
  for (const it of items) {
    const last = runs.at(-1);
    if (it.kind !== 'item') runs.push(it);
    else if (Array.isArray(last) && !it.para && !last[0].para) last.push(it);
    else runs.push([it]);
  }
  return (
    <>
      {runs.map((r) =>
        !Array.isArray(r) ? (
          <ExtraView key={r.id} extra={r} />
        ) : r[0].para ? (
          <Paragraph key={r[0].id} item={r[0]} />
        ) : (
          <List key={r[0].id} items={r} />
        )
      )}
    </>
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

function List({ items }: { items: DocItem[] }) {
  const { store } = useSource();
  return (
    <ul class={items.every((it) => it.task) ? 'doc-tasks' : undefined}>
      {items.map((it) => (
        <ListItem key={it.id} item={it} done={store.node(it.id).completed} />
      ))}
    </ul>
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
  const html = useMemo(() => renderFormat(n.format!, n.text), [n.format, n.text]);
  if (readOnly) return <div class="data-view doc-block" data-format={n.format} dangerouslySetInnerHTML={{ __html: html }} />;
  if (ctl.activeField === fText(id).key) return <BlockBody node={n} />;
  const view = (
    <div
      class="data-view doc-block"
      data-format={n.format}
      title={t('クリックして編集（Esc で終了）', 'Click to edit (Esc to finish)')}
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={(e) => !(e.target as Element).closest('a') && !document.getSelection()?.toString() && ctl.focus(fText(id, 'end'))}
    />
  );
  if (getFormat(n.format!).name !== 'code') return view;
  // Code: its language in the corner, to change there.
  return (
    <div class="doc-code">
      {view}
      <LangInput node={n} class="doc-lang" />
    </div>
  );
}
