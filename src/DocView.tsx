/*
 * Document view: the zoomed item read as prose (see doc.ts): headings,
 * paragraphs and lists from its rows, its blocks and embedded drawings among
 * them. Clicking a line edits its row right there, as in the outline (Enter
 * a new row after it, Tab under the one above, and so on). It can also show
 * an outline of its own, only to be read (the guide). With a few headings,
 * their contents go at the side, the one being read marked.
 */
import { createContext, type ComponentChildren } from 'preact';
import { useContext, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useCtl } from './context';
import { DiagramView } from './DiagramView';
import { buildDoc, docContents, setDoc, type DocItem, type DocPart, type DocRole, type DocStyle, type Extra } from './doc';
import { renderFormat } from './formats';
import { GanttView } from './GanttView';
import { t } from './i18n';
import { BlockBody, NodeText } from './App';
import { fText } from './focus';
import { useFlowEditor } from './flowEditor';
import { InlineText } from './InlineText';
import type { OutlineStore } from './model';

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
function Contents({ items }: { items: { id: string; level: 2 | 3; text: string }[] }) {
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
          class={'doc-toc-item level-' + h.level + (h.id === at ? ' at' : '')}
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
        <InlineText text={store.node(id).text} />
      </span>
    );
  }
  return <NodeText node={store.node(id)} />;
}

function Part({ part }: { part: DocPart }) {
  if (part.kind === 'heading') return <Heading id={part.id} level={part.level} auto={part.auto} />;
  if (part.kind === 'para') return <Para id={part.id} auto={part.auto} />;
  if (part.kind === 'rows') return <Rows part={part} />;
  return <ExtraView extra={part} />;
}

/**
 * In the margin before a line, while the pointer is over it: make its row a
 * heading (H), or a body line again (¶); written as `doc` on it, unless that
 * is what it would be anyway (auto).
 */
function RoleSwitch({ id, now, auto }: { id: string; now: DocRole; auto: DocRole }) {
  const { ctl, readOnly } = useSource();
  if (readOnly) return null;
  const to: DocRole = now === 'heading' ? 'body' : 'heading';
  return (
    <button
      class="mini doc-role"
      title={to === 'heading' ? t('見出しにする（⌘⌥1）', 'Make it a heading (⌘⌥1)') : t('本文にする（⌘⌥0）', 'Make it body text (⌘⌥0)')}
      // Not taking the caret from the line being typed in, which keeps it after.
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        const ta = document.activeElement as HTMLTextAreaElement | null;
        const typing = ta?.dataset.id === id;
        setDoc(ctl.store, id, 'role', to === auto ? null : to);
        ctl.commit(typing ? fText(id, ta.selectionStart, ta.selectionEnd) : null);
      }}
    >
      {to === 'heading' ? 'H' : '¶'}
    </button>
  );
}

function Heading({ id, level, auto }: { id: string; level: 2 | 3 | 4; auto: DocRole }) {
  const H = `h${level}` as 'h2';
  return (
    <H class="doc-line" data-doc-id={id}>
      <RoleSwitch id={id} now="heading" auto={auto} />
      <Text id={id} />
    </H>
  );
}

/**
 * A paragraph; auto is what its row would be with nothing set on it (else it
 * is a row as one of many, and stays one). fixed: among rows under a
 * paragraph, which stay paragraphs (no switch to a heading).
 */
function Para({ id, auto = 'body', fixed }: { id: string; auto?: DocRole; fixed?: boolean }) {
  const { store } = useSource();
  const ref = useRef<HTMLDivElement>(null);
  useFlowEditor(ref);
  return (
    // A div, not a p: the row editor in it is one.
    <div ref={ref} class={'doc-line doc-p' + (store.node(id).completed ? ' done' : '')}>
      {!fixed && <RoleSwitch id={id} now="body" auto={auto} />}
      <Check id={id} />
      <Text id={id} />
    </div>
  );
}

/** A task's checkbox, which completes it (or opens it again). */
function Check({ id }: { id: string }) {
  const { store, readOnly, ctl } = useSource();
  if (!store.isTask(id)) return null;
  return (
    <input
      type="checkbox"
      class="doc-check"
      checked={store.node(id).completed}
      disabled={readOnly}
      onChange={() => ctl.toggleComplete(id)}
    />
  );
}

/** The switch beside rows between a list and paragraphs (written as `doc` on under, the row above them). */
function StyleSwitch({ under, style, auto }: { under: string; style: DocStyle; auto: boolean }) {
  const { ctl, readOnly } = useSource();
  if (readOnly) return null;
  const set = (to: DocStyle | null) => {
    setDoc(ctl.store, under, 'style', to);
    ctl.commit(null);
  };
  const choice = (to: DocStyle, label: string) => (
    <button class={'mini' + (style === to ? ' on' : '')} onClick={() => style !== to && set(to)}>
      {label}
    </button>
  );
  return (
    <span class="doc-style" role="group" aria-label={t('書き方', 'Written as')}>
      {choice('list', t('箇条書き', 'List'))}
      {choice('text', t('段落', 'Paragraphs'))}
      {!auto && (
        <button class="mini" title={t('行の書き方から自動で決める', 'Decide from how the rows are written')} onClick={() => set(null)}>
          {t('自動', 'Auto')}
        </button>
      )}
    </span>
  );
}

/** Rows side by side, as a list or as paragraphs. */
function Rows({ part }: { part: Extract<DocPart, { kind: 'rows' }> }) {
  return (
    <div class="doc-rows">
      <StyleSwitch under={part.under} style={part.style} auto={part.auto} />
      {part.style === 'list' ? (
        <List items={part.items} top={!part.listed} />
      ) : (
        part.items.map((it) => <Paragraph key={it.id} item={it} fixed={part.listed} />)
      )}
    </div>
  );
}

/** A row as a paragraph, and the rows under it: paragraphs after it (not indented), or a list under it. */
function Paragraph({ item, fixed }: { item: DocItem; fixed?: boolean }) {
  return (
    <>
      <Para id={item.id} fixed={fixed} />
      {item.extras.map((x, i) => (
        <ExtraView key={i} extra={x} />
      ))}
      {item.text ? item.items.map((it) => <Paragraph key={it.id} item={it} fixed />) : item.items.length > 0 && <List items={item.items} />}
    </>
  );
}

/** A list; top: of rows each in their own place, which can be made headings (not rows inside others). */
function List({ items, top }: { items: DocItem[]; top?: boolean }) {
  const { store } = useSource();
  return (
    <ul class={items.every((it) => it.task) ? 'doc-tasks' : undefined}>
      {items.map((it) => (
        <ListItem key={it.id} item={it} done={store.node(it.id).completed} top={top} />
      ))}
    </ul>
  );
}

function ListItem({ item, done, top }: { item: DocItem; done: boolean; top?: boolean }) {
  const ref = useRef<HTMLLIElement>(null);
  useFlowEditor(ref);
  return (
    <li ref={ref} class={(item.task ? 'task' : '') + (done ? ' done' : '')}>
      <span class="doc-line">
        {top && <RoleSwitch id={item.id} now="body" auto="body" />}
        <Check id={item.id} />
        <Text id={item.id} />
      </span>
      {item.extras.map((x, i) => (
        <ExtraView key={i} extra={x} />
      ))}
      {item.items.length > 0 && <List items={item.items} />}
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
  return (
    <div
      class="data-view doc-block"
      data-format={n.format}
      title={t('クリックして編集（Esc で終了）', 'Click to edit (Esc to finish)')}
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={(e) => !(e.target as Element).closest('a') && !document.getSelection()?.toString() && ctl.focus(fText(id, 'end'))}
    />
  );
}
