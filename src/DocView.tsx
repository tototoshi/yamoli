/*
 * Document view: the zoomed item read as prose (see doc.ts): headings,
 * paragraphs and lists from its rows, its blocks and embedded drawings among
 * them. Clicking a line edits its row right there, as in the outline (Enter
 * a new row after it, Tab under the one above, and so on).
 */
import type { RefObject } from 'preact';
import { useLayoutEffect, useMemo, useRef } from 'preact/hooks';
import { useCtl } from './context';
import { DiagramView } from './DiagramView';
import { buildDoc, setDoc, type DocItem, type DocPart, type DocRole, type DocStyle, type Extra } from './doc';
import { renderFormat } from './formats';
import { GanttView } from './GanttView';
import { t } from './i18n';
import { BlockBody, NodeText } from './App';
import { fText } from './focus';
import { InlineText } from './InlineText';

export function DocView() {
  const ctl = useCtl();
  const doc = buildDoc(ctl.store, ctl.zoomId, { showCompleted: ctl.prefs.showCompleted });
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

/** A row's text, edited in place when clicked (the outline's own row editor). */
function Text({ id }: { id: string }) {
  const { store } = useCtl();
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
  const ctl = useCtl();
  const to: DocRole = now === 'heading' ? 'body' : 'heading';
  return (
    <button
      class="mini doc-role"
      title={to === 'heading' ? t('見出しにする', 'Make it a heading') : t('本文にする', 'Make it body text')}
      onClick={() => {
        setDoc(ctl.store, id, 'role', to === auto ? null : to);
        ctl.commit(null);
      }}
    >
      {to === 'heading' ? 'H' : '¶'}
    </button>
  );
}

function Heading({ id, level, auto }: { id: string; level: 2 | 3 | 4; auto: DocRole }) {
  const H = `h${level}` as 'h2';
  return (
    <H class="doc-line">
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
  const { store } = useCtl();
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

/**
 * Lay the row editor in a paragraph or list item (line) over its text where
 * it flows: the copy showing the text stays inline as it was, among other
 * sentences or after a checkbox, and the (unseen) textarea over it starts on
 * its line, indented to where it starts, and wraps across the line's width as
 * it does, so nothing moves when typing starts.
 */
function useFlowEditor(ref: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const line = ref.current;
    const rich = line && [...line.querySelectorAll<HTMLElement>('.rich')].find((r) => r.parentElement?.closest('li, .doc-p') === line);
    const mirror = rich?.querySelector<HTMLElement>(':scope > .mirror');
    const ta = rich?.querySelector<HTMLTextAreaElement>(':scope > textarea');
    if (!line || !mirror || !ta?.offsetParent) return;
    const place = () => {
      const first = mirror.getClientRects()[0];
      if (!first) return;
      const box = line.getBoundingClientRect();
      const at = ta.offsetParent!.getBoundingClientRect();
      const lineHeight = parseFloat(getComputedStyle(line).lineHeight);
      ta.style.top = first.top - (lineHeight - first.height) / 2 - at.top + 'px';
      ta.style.left = box.left - at.left + 'px';
      ta.style.width = line.clientWidth + 'px';
      ta.style.textIndent = first.left - box.left + 'px';
    };
    place();
    const watch = new ResizeObserver(place);
    watch.observe(line);
    return () => watch.disconnect();
  });
}

/** A task's checkbox, which completes it (or opens it again). */
function Check({ id }: { id: string }) {
  const ctl = useCtl();
  if (!ctl.store.isTask(id)) return null;
  return <input type="checkbox" class="doc-check" checked={ctl.store.node(id).completed} onChange={() => ctl.toggleComplete(id)} />;
}

/** The switch beside rows between a list and paragraphs (written as `doc` on under, the row above them). */
function StyleSwitch({ under, style, auto }: { under: string; style: DocStyle; auto: boolean }) {
  const ctl = useCtl();
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
  const { store } = useCtl();
  return (
    <ul class={items.every((it) => it.task) ? 'doc-tasks' : undefined}>
      {items.map((it) => (
        <ListItem key={it.id} item={it} done={store.node(it.id).completed} top={top} />
      ))}
    </ul>
  );
}

function ListItem({ item, done, top }: { item: DocItem; done: boolean; top?: boolean }) {
  const { store } = useCtl();
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
        <DiagramView rootId={extra.id} embedded edit kind={extra.as === 'mindmap' ? 'tree' : 'flow'} />
      )}
    </div>
  );
}

/** A block as its format draws it, edited in place when clicked (folded in the outline or not). */
function Block({ id }: { id: string }) {
  const ctl = useCtl();
  const n = ctl.store.node(id);
  const html = useMemo(() => renderFormat(n.format!, n.text), [n.format, n.text]);
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
