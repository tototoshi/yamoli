/*
 * Document view: the zoomed item read as prose (see doc.ts): headings,
 * paragraphs and lists from its rows, its blocks and embedded drawings among
 * them. Clicking a line edits its row in the outline.
 */
import { useMemo } from 'preact/hooks';
import { useCtl } from './context';
import { DiagramView } from './DiagramView';
import { buildDoc, setDoc, type DocItem, type DocPart, type DocRole, type DocStyle, type Extra } from './doc';
import { renderFormat } from './formats';
import { GanttView } from './GanttView';
import { t } from './i18n';
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

/** Props for a line that opens its row in the outline when clicked (not when text is being selected, or a link followed). */
function useEdit(id: string) {
  const ctl = useCtl();
  return {
    'data-id': id,
    title: t('クリックでアウトラインで編集', 'Click to edit in the outline'),
    onClick: (e: MouseEvent) => {
      if ((e.target as Element).closest('a, input, button') || document.getSelection()?.toString()) return;
      ctl.openRow(id);
    },
  };
}

function Part({ part }: { part: DocPart }) {
  if (part.kind === 'heading') return <Heading id={part.id} level={part.level} auto={part.auto} />;
  if (part.kind === 'para') return <Para id={part.id} auto={part.auto} />;
  if (part.kind === 'rows') return <Rows part={part} />;
  if (part.kind === 'indent') return <Indent part={part} />;
  return <ExtraView extra={part} />;
}

/**
 * At the end of a line, while the pointer is over it: make its row a heading,
 * or a body line again (written as `doc` on it, unless that is what it would
 * be anyway: auto).
 */
function RoleSwitch({ id, now, auto }: { id: string; now: DocRole; auto: DocRole }) {
  const ctl = useCtl();
  const to: DocRole = now === 'heading' ? 'body' : 'heading';
  return (
    <button
      class="mini doc-role"
      onClick={() => {
        setDoc(ctl.store, id, 'role', to === auto ? null : to);
        ctl.commit(null);
      }}
    >
      {to === 'heading' ? t('見出しに', 'Make a heading') : t('本文に', 'Make body text')}
    </button>
  );
}

function Heading({ id, level, auto }: { id: string; level: 2 | 3 | 4; auto: DocRole }) {
  const { store } = useCtl();
  const H = `h${level}` as 'h2';
  return (
    <H class="doc-line" {...useEdit(id)}>
      <InlineText text={store.node(id).text} />
      <RoleSwitch id={id} now="heading" auto={auto} />
    </H>
  );
}

/**
 * A paragraph; auto is what its row would be with nothing set on it (else it
 * is a row as one of many, and stays one). Indented under another, it stays
 * a paragraph (no heading there).
 */
function Para({ id, auto = 'body', fixed }: { id: string; auto?: DocRole; fixed?: boolean }) {
  const { store } = useCtl();
  return (
    <p class={'doc-line' + (store.node(id).completed ? ' done' : '')} {...useEdit(id)}>
      <Check id={id} />
      <InlineText text={store.node(id).text} />
      {!fixed && <RoleSwitch id={id} now="body" auto={auto} />}
    </p>
  );
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
      {part.style === 'list' ? <List items={part.items} top={!part.listed} /> : part.items.map((it) => <Paragraph key={it.id} item={it} />)}
    </div>
  );
}

/** Paragraphs under a paragraph, indented under it. */
function Indent({ part }: { part: Extract<DocPart, { kind: 'indent' }> }) {
  return (
    <div class="doc-rows doc-indent">
      <StyleSwitch under={part.under} style="text" auto={part.auto} />
      {part.parts.map((p, i) => (p.kind === 'para' ? <Para key={p.id} id={p.id} fixed /> : <Part key={i} part={p} />))}
    </div>
  );
}

function Paragraph({ item }: { item: DocItem }) {
  return (
    <>
      <Para id={item.id} />
      {item.items.length > 0 && <List items={item.items} />}
      {item.extras.map((x, i) => (
        <ExtraView key={i} extra={x} />
      ))}
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
  return (
    <li class={(item.task ? 'task' : '') + (done ? ' done' : '')}>
      <span class="doc-line" {...useEdit(item.id)}>
        <Check id={item.id} />
        <InlineText text={store.node(item.id).text} />
        {top && <RoleSwitch id={item.id} now="body" auto="body" />}
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
    <div class={'doc-embed ' + extra.as}>
      {extra.as === 'gantt' ? (
        <GanttView rootId={extra.id} embedded />
      ) : (
        <DiagramView rootId={extra.id} embedded kind={extra.as === 'mindmap' ? 'tree' : 'flow'} />
      )}
    </div>
  );
}

function Block({ id }: { id: string }) {
  const { store } = useCtl();
  const n = store.node(id);
  const html = useMemo(() => renderFormat(n.format!, n.text), [n.format, n.text]);
  return <div class="data-view doc-block" data-format={n.format} {...useEdit(id)} dangerouslySetInnerHTML={{ __html: html }} />;
}
