/*
 * Slides view: the zoomed item as a deck (see slides.ts). Slides are laid out
 * at 1280×720 and scaled to fit, in the page or full screen.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useCtl } from './context';
import { t } from './i18n';
import { renderFormat } from './formats';
import { DiagramView } from './DiagramView';
import { GanttView } from './GanttView';
import { InlineText } from './InlineText';
import { nodeLabel } from './links';
import { buildDeck, splitColumns, type Bullet, type Slide } from './slides';
import { fileUrl } from './files';

const W = 1280;
const H = 720;

export function SlidesView() {
  const ctl = useCtl();
  const { store } = ctl;
  const deck = buildDeck(store, ctl.zoomId);
  const count = deck.slides.length;
  const index = Math.min(ctl.slide, Math.max(count - 1, 0));
  const slide = deck.slides[index];
  const stageRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ scale: 1, x: 0, y: 0 });
  const [showNotes, setShowNotes] = useState(false);

  const go = (i: number) => ctl.setSlide(Math.min(Math.max(i, 0), count - 1));
  const fullscreen = () => {
    const el = stageRef.current;
    if (document.fullscreenElement) void document.exitFullscreen();
    else el?.requestFullscreen().catch(() => {}); // refused without a user gesture
  };

  // Scale the 1280×720 slide to the stage, centred (the stage changes size in full screen).
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => {
      const scale = Math.min(el.clientWidth / W, el.clientHeight / H);
      setFit({ scale, x: (el.clientWidth - W * scale) / 2, y: (el.clientHeight - H * scale) / 2 });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [count > 0]);

  // ← → (and friends) page through the deck when not typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, [contenteditable]') || e.altKey || e.metaKey || e.ctrlKey) return;
      const k = e.key;
      const at = Math.min(ctl.slide, count - 1); // not `index`: keys can arrive before the rerender
      if (k === 'ArrowRight' || k === 'ArrowDown' || k === 'PageDown' || k === ' ') go(at + 1);
      else if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp') go(at - 1);
      else if (k === 'Home') go(0);
      else if (k === 'End') go(count - 1);
      else if (k === 'f') fullscreen();
      else if (k === 'n') setShowNotes((v) => !v);
      else return;
      e.preventDefault();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  if (!slide) {
    return (
      <p class="slides-empty">
        {t(
          'スライドがありません。この項目の下に行を追加すると、1 行が 1 枚のスライドになります（子の行は箇条書き）。',
          'No slides yet. Each row under this item becomes a slide (rows under it are its bullets).'
        )}
      </p>
    );
  }

  return (
    <div class="slides">
      <ol class="slide-list">
        {deck.slides.map((s, i) => (
          <li key={s.id} class={i === index ? 'current' : ''} onClick={() => go(i)}>
            {nodeLabel(store, s.id)}
          </li>
        ))}
      </ol>
      <div class="slide-col">
        <div
          class={'slide-stage theme-' + deck.theme}
          ref={stageRef}
          onClick={(e) => !(e.target as Element).closest('a, button, .gantt-wrap') && go(index + 1)}
        >
          <div class={`slide layout-${slide.layout}`} style={{ transform: `translate(${fit.x}px, ${fit.y}px) scale(${fit.scale})` }}>
            <SlideBody slide={slide} />
            <div class="slide-number">
              {index + 1} / {count}
            </div>
          </div>
        </div>
        <div class="slide-controls">
          <button class="mini" disabled={index === 0} onClick={() => go(index - 1)} title={t('前へ (←)', 'Previous (←)')}>
            ◀
          </button>
          <span class="slide-count">
            {index + 1} / {count}
          </span>
          <button class="mini" disabled={index === count - 1} onClick={() => go(index + 1)} title={t('次へ (→)', 'Next (→)')}>
            ▶
          </button>
          <button class={'mini' + (showNotes ? ' on' : '')} onClick={() => setShowNotes(!showNotes)} title={t('ノート (N)', 'Notes (N)')}>
            {t('ノート', 'Notes')}
          </button>
          <button class="mini" onClick={fullscreen} title={t('全画面 (F、Esc で戻る)', 'Full screen (F, Esc to leave)')}>
            {t('全画面', 'Full screen')}
          </button>
          <a class="slide-edit" href={ctl.hashFor(slide.id, 'outline')}>
            {t('このスライドを編集', 'Edit this slide')}
          </a>
        </div>
        {showNotes && (
          <div class="slide-notes">
            {slide.notes || <span class="muted">{t('（notes: でノートを書けます）', '(write notes in a notes: field)')}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

function SlideBody({ slide }: { slide: Slide }) {
  const { store } = useCtl();
  const n = store.node(slide.id);
  const title = <InlineText text={n.text} />;

  if (slide.layout === 'title') {
    return (
      <div class="slide-title-only">
        <h1>{title}</h1>
        {slide.subtitle && (
          <p class="subtitle">
            <InlineText text={slide.subtitle} />
          </p>
        )}
      </div>
    );
  }

  // Blocks are the slide's content (notes aside, shown under the slide).
  const data = n.children
    .map((c) => store.node(c))
    .filter((c) => c.format !== null && c.key?.trim().toLowerCase() !== 'notes')
    .map((c) => <DataHtml key={c.id} format={c.format!} content={c.text} />);
  // Two columns: bullets beside the data blocks, or the bullets split in half.
  const twoColumn = slide.layout === 'two-column';
  const body =
    twoColumn && data.length ? (
      <div class="slide-columns">
        <Bullets bullets={slide.bullets} />
        <div class="slide-text">{data}</div>
      </div>
    ) : twoColumn ? (
      <div class="slide-columns">
        {splitColumns(slide.bullets).map((col, i) => (
          <Bullets key={i} bullets={col} />
        ))}
      </div>
    ) : (
      <>
        {slide.bullets.length > 0 && <Bullets bullets={slide.bullets} />}
        {data}
      </>
    );

  return (
    <>
      <h2>{title}</h2>
      {slide.subtitle && (
        <p class="subtitle">
          <InlineText text={slide.subtitle} />
        </p>
      )}
      <div class={'slide-content' + (slide.image ? ' with-image' : '')}>
        <div class="slide-text">
          {body}
          {slide.embed && (
            <div class="slide-embed">
              {slide.embedAs === 'gantt' ? (
                <GanttView rootId={slide.embed} embedded />
              ) : (
                <DiagramView rootId={slide.embed} embedded kind={slide.embedAs === 'mindmap' ? 'tree' : 'flow'} />
              )}
            </div>
          )}
        </div>
        {slide.image && <img class="slide-image" src={fileUrl(slide.image)} alt="" />}
      </div>
    </>
  );
}

function Bullets({ bullets }: { bullets: Bullet[] }) {
  const { store } = useCtl();
  return (
    <ul>
      {bullets.map((b) => (
        <li key={b.id} class={store.node(b.id).completed ? 'done' : ''}>
          <InlineText text={store.node(b.id).text} />
          {b.children.length > 0 && <Bullets bullets={b.children} />}
        </li>
      ))}
    </ul>
  );
}

function DataHtml({ format, content }: { format: string; content: string }) {
  const html = useMemo(() => renderFormat(format, content), [format, content]);
  return <div class={`slide-data fmt fmt-${format}`} dangerouslySetInnerHTML={{ __html: html }} />;
}
