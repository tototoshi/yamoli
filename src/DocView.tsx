/*
 * Document view: the zoomed item read as prose (see doc.ts): headings,
 * paragraphs and lists from its rows, its blocks and embedded drawings among
 * them. Clicking a line edits its row in the outline.
 */
import { useMemo } from 'preact/hooks';
import { useCtl } from './context';
import { DiagramView } from './DiagramView';
import { buildDoc, DOC_KEY, type DocItem, type DocPart, type DocStyle, type Extra } from './doc';
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
      if ((e.target as Element).closest('a, input') || document.getSelection()?.toString()) return;
      ctl.openRow(id);
    },
  };
}

function Part({ part }: { part: DocPart }) {
  if (part.kind === 'heading') return <Heading id={part.id} level={part.level} />;
  if (part.kind === 'para') return <Para id={part.id} />;
  if (part.kind === 'rows') return <Rows part={part} />;
  return <ExtraView extra={part} />;
}

function Heading({ id, level }: { id: string; level: 2 | 3 | 4 }) {
  const { store } = useCtl();
  const H = `h${level}` as 'h2';
  return (
    <H class="doc-line" {...useEdit(id)}>
      <InlineText text={store.node(id).text} />
    </H>
  );
}

function Para({ id }: { id: string }) {
  const { store } = useCtl();
  return (
    <p class={'doc-line' + (store.node(id).completed ? ' done' : '')} {...useEdit(id)}>
      <Check id={id} />
      <InlineText text={store.node(id).text} />
    </p>
  );
}

/** A task's checkbox, which completes it (or opens it again). */
function Check({ id }: { id: string }) {
  const ctl = useCtl();
  if (!ctl.store.isTask(id)) return null;
  return <input type="checkbox" class="doc-check" checked={ctl.store.node(id).completed} onChange={() => ctl.toggleComplete(id)} />;
}

/** Rows side by side, as a list or as paragraphs, with a switch between the two (written as `doc` on the row above them). */
function Rows({ part }: { part: Extract<DocPart, { kind: 'rows' }> }) {
  const ctl = useCtl();
  const set = (style: DocStyle | null) => {
    const { store } = ctl;
    if (style) store.setField(part.under, DOC_KEY, style);
    else store.remove(store.field(part.under, DOC_KEY)!.id);
    ctl.commit(null);
  };
  const choice = (style: DocStyle, label: string) => (
    <button class={'mini' + (part.style === style ? ' on' : '')} onClick={() => part.style !== style && set(style)}>
      {label}
    </button>
  );
  return (
    <div class="doc-rows">
      <span class="doc-style" role="group" aria-label={t('書き方', 'Written as')}>
        {choice('list', t('箇条書き', 'List'))}
        {choice('text', t('段落', 'Paragraphs'))}
        {!part.auto && (
          <button class="mini" title={t('行の書き方から自動で決める', 'Decide from how the rows are written')} onClick={() => set(null)}>
            {t('自動', 'Auto')}
          </button>
        )}
      </span>
      {part.style === 'list' ? <List items={part.items} /> : part.items.map((it) => <Paragraph key={it.id} item={it} />)}
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

function List({ items }: { items: DocItem[] }) {
  const { store } = useCtl();
  return (
    <ul class={items.every((it) => it.task) ? 'doc-tasks' : undefined}>
      {items.map((it) => (
        <ListItem key={it.id} item={it} done={store.node(it.id).completed} />
      ))}
    </ul>
  );
}

function ListItem({ item, done }: { item: DocItem; done: boolean }) {
  const { store } = useCtl();
  return (
    <li class={(item.task ? 'task' : '') + (done ? ' done' : '')}>
      <span class="doc-line" {...useEdit(item.id)}>
        <Check id={item.id} />
        <InlineText text={store.node(item.id).text} />
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
