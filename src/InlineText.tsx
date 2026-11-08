/*
 * Read-only rendering of inline markup: links to items, URLs, #tags, code,
 * emphasis, with search hits highlighted. Each piece carries its offset in
 * the source (data-o) so a click can be mapped back to a caret position.
 */
import { useMemo } from 'preact/hooks';
import { useCtl } from './context';
import { highlight, parseInline, type Seg } from './inline';
import { nodeLabel } from './links';

/** Inline text for display only (slides, labels). */
export function InlineText({ text }: { text: string }) {
  const segs = useMemo(() => parseInline(text), [text]);
  return (
    <>
      {segs.map((seg) => (
        <SegView key={seg.start} seg={seg} />
      ))}
    </>
  );
}

export function SegView({ seg }: { seg: Seg }) {
  const ctl = useCtl();
  const pieces = highlight(seg.text, ctl.terms).map((p) => (
    <span key={p.offset} data-o={seg.start + p.offset} class={p.mark ? 'hl' : undefined}>
      {p.text}
    </span>
  ));
  switch (seg.kind) {
    case 'code':
      return <code>{pieces}</code>;
    case 'strong':
      return <strong>{pieces}</strong>;
    case 'em':
      return <em>{pieces}</em>;
    case 'del':
      return <del>{pieces}</del>;
    case 'tag':
      return (
        <span class="tag" title="このタグで検索">
          {pieces}
        </span>
      );
    case 'ref': {
      const target = ctl.store.get(seg.refId!);
      if (!target) return <>{pieces}</>; // unknown id: show the raw text
      return (
        <a class={'ref' + (target.completed ? ' done' : '')} href={ctl.hashFor(target.id)} title="クリックで移動">
          {nodeLabel(ctl.store, target.id)}
        </a>
      );
    }
    case 'link':
      return (
        <a href={seg.href} target="_blank" rel="noopener noreferrer">
          {pieces}
        </a>
      );
    default:
      return <>{pieces}</>;
  }
}
