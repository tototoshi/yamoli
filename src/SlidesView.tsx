/*
 * Slides view: the zoomed item as a deck (see slides.ts). Slides are laid out
 * at 1280×720 and scaled to fit, in the page or full screen, and printed one
 * to a page of that size (to save as a PDF). A slide's title, bullets,
 * subtitle, blocks, notes and picture's address are typed in where they are,
 * with the outline's keys; slides are added, dragged into another order and
 * deleted in the list beside them; the slide on screen
 * follows the row being typed in (Shift+Tab on a bullet makes it the next
 * slide, and goes to it; Enter on a title makes its first bullet).
 */
import { createPortal } from 'preact/compat';
import type { RefObject } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { BlockBody, NodeText } from './App';
import { fText } from './focus';
import { useCtl } from './context';
import { useFlowEditor } from './flowEditor';
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
  // The slide of the row being typed in, when that is another (moved to with the keys, or just made);
  // not the deck's own, also the page's title above, nor a field (the deck's `views` above, say).
  const typing = ctl.activeField?.startsWith('text:') ? ctl.activeField.slice(5) : null;
  const row = typing && typing !== ctl.zoomId && store.get(typing) && store.node(typing).key === null;
  const typed = row ? slideOf(deck.slides, store, typing) : -1;
  if (typed >= 0) ctl.slide = typed;
  const index = Math.min(ctl.slide, Math.max(count - 1, 0));
  const slide = deck.slides[index];
  const stageRef = useRef<HTMLDivElement>(null);
  /** Whether a press on the slide found a line being typed in: the click then only ends that, not turning the page. */
  const wasTyping = useRef(false);
  const [fit, setFit] = useState({ scale: 1, x: 0, y: 0 });
  const [showNotes, setShowNotes] = useState(false);
  /** Every slide is laid out for printing, and the print dialog opened. */
  const [printing, setPrinting] = useState(false);

  // Print once the slides are laid out (and their pictures loaded), then put them away.
  useEffect(() => {
    if (!printing) return;
    let gone = false;
    const done = () => {
      document.body.classList.remove('printing-slides');
      setPrinting(false);
    };
    const pictures = [...document.querySelectorAll<HTMLImageElement>('.slides-print img')].filter((img) => !img.complete);
    const loaded = Promise.all(pictures.map((img) => new Promise((r) => (img.onload = img.onerror = r))));
    void loaded.then(() =>
      requestAnimationFrame(() => {
        if (gone) return;
        document.body.classList.add('printing-slides');
        window.addEventListener('afterprint', done, { once: true });
        window.print();
      })
    );
    return () => {
      gone = true;
      window.removeEventListener('afterprint', done);
      document.body.classList.remove('printing-slides');
    };
  }, [printing]);

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
      // A box or arrow selected in a drawing on the slide: the keys are its (a mind map's arrows move through it).
      if (document.querySelector('.slide [data-holding]')) return;
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

  /** A new slide after the one on screen (after the title slide: the first), its title to type in. */
  const addSlide = () => {
    const cur = slide?.id;
    const first = store.items(ctl.zoomId)[0];
    const n = cur && cur !== ctl.zoomId ? store.addSiblingAfter(cur) : store.addChild(ctl.zoomId, first ? store.indexOf(first) : -1);
    ctl.commit(fText(n.id, 0));
  };
  /** The slide being dragged in the list, and where it would go: before or after which. */
  const dragging = useRef<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; after: boolean } | null>(null);
  const dropAt = (id: string, after: boolean) => {
    const moved = dragging.current;
    dragging.current = null;
    setDrop(null);
    if (!moved || moved === id) return;
    const items = store.items(ctl.zoomId);
    // Onto the title slide: first; else before the one dropped on, or the one after it (none: last).
    const before = id === ctl.zoomId ? (items[0] ?? null) : after ? (items[items.indexOf(id) + 1] ?? null) : id;
    if (before === moved || !store.moveTo(moved, ctl.zoomId, before)) return;
    ctl.commit(null);
    ctl.setSlide(buildDeck(store, ctl.zoomId).slides.findIndex((s) => s.id === moved));
  };

  if (!slide) {
    return (
      <div class="slides-empty">
        <p>
          {t(
            'スライドがありません。この項目の下に行を追加すると、1 行が 1 枚のスライドになります（子の行は箇条書き）。',
            'No slides yet. Each row under this item becomes a slide (rows under it are its bullets).'
          )}
        </p>
        <button class="mini" onClick={addSlide}>
          {t('+ スライドを追加', '+ Add a slide')}
        </button>
      </div>
    );
  }

  return (
    <div class="slides">
      <div class="slide-side">
        <ol class="slide-list">
          {deck.slides.map((s, i) => {
            const own = s.id !== ctl.zoomId; // the title slide is the deck itself: not moved nor deleted here
            return (
              <li
                key={s.id}
                class={(i === index ? 'current' : '') + (drop?.id === s.id ? (drop.after ? ' drop-after' : ' drop-before') : '')}
                draggable={own}
                onClick={() => go(i)}
                onDragStart={(e) => {
                  dragging.current = s.id;
                  e.dataTransfer?.setData('text/plain', nodeLabel(store, s.id));
                  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
                }}
                onDragOver={(e) => {
                  if (!dragging.current) return;
                  e.preventDefault();
                  const r = e.currentTarget.getBoundingClientRect();
                  const after = own && e.clientY > r.top + r.height / 2;
                  if (drop?.id !== s.id || drop.after !== after) setDrop({ id: s.id, after });
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (drop) dropAt(drop.id, drop.after);
                }}
                onDragEnd={() => {
                  dragging.current = null;
                  setDrop(null);
                }}
              >
                <span class="slide-list-name">{nodeLabel(store, s.id) || t('無題', 'Untitled')}</span>
                {own && (
                  <button
                    class="slide-list-del"
                    title={t('このスライドを削除', 'Delete this slide')}
                    onClick={(e) => {
                      e.stopPropagation();
                      ctl.deleteItem(s.id);
                    }}
                  >
                    ×
                  </button>
                )}
              </li>
            );
          })}
        </ol>
        <button class="mini slide-add" onClick={addSlide} title={t('今のスライドの後に追加', 'Add one after the slide on screen')}>
          {t('+ スライド', '+ Slide')}
        </button>
      </div>
      <div class="slide-col">
        <div
          class={'slide-stage theme-' + deck.theme}
          ref={stageRef}
          onPointerDown={() => (wasTyping.current = !!document.activeElement?.closest('.slide .rich'))}
          onClick={(e) =>
            !wasTyping.current &&
            !(e.target as Element).closest('a, button, .gantt-wrap, .diagram-wrap, .text, .rich, .slide-data, .block, .slide-image') &&
            go(index + 1)
          }
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
          <button
            class="mini"
            disabled={printing}
            onClick={() => setPrinting(true)}
            title={t('すべてのスライドを印刷（「PDF に保存」で PDF に）', 'Print every slide (choose "Save as PDF" for a PDF)')}
          >
            PDF
          </button>
          <a class="slide-edit" href={ctl.hashFor(slide.id, 'outline')}>
            {t('このスライドを編集', 'Edit this slide')}
          </a>
        </div>
        {printing &&
          createPortal(
            <div class="slides-print">
              {deck.slides.map((s, i) => (
                <div key={s.id} class={'slide-stage slide-page theme-' + deck.theme}>
                  <div class={`slide layout-${s.layout}`}>
                    <SlideBody slide={s} />
                    <div class="slide-number">
                      {i + 1} / {count}
                    </div>
                  </div>
                </div>
              ))}
            </div>,
            document.body
          )}
        {showNotes && (
          <div class="slide-notes">
            <Notes id={slide.id} text={slide.notes} />
          </div>
        )}
      </div>
    </div>
  );
}

function SlideBody({ slide }: { slide: Slide }) {
  const { store } = useCtl();
  const content = useRef<HTMLDivElement>(null);
  useFitText(content);
  const n = store.node(slide.id);
  const title = <NodeText node={n} />;

  if (slide.layout === 'title') {
    return (
      <div class="slide-title-only">
        <h1>{title}</h1>
        {slide.subtitle && (
          <p class="subtitle">
            <FieldText id={slide.id} name="subtitle" text={slide.subtitle} />
          </p>
        )}
      </div>
    );
  }

  // Blocks are the slide's content (notes aside, shown under the slide).
  const data = n.children
    .map((c) => store.node(c))
    .filter((c) => c.format !== null && c.key?.trim().toLowerCase() !== 'notes')
    .map((c) => <SlideBlock key={c.id} id={c.id} />);
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
          <FieldText id={slide.id} name="subtitle" text={slide.subtitle} />
        </p>
      )}
      <div ref={content} class={'slide-content' + (slide.image ? ' with-image' : '')}>
        <div class="slide-text">
          {body}
          {slide.embed && (
            <div class="slide-embed">
              {slide.embedAs === 'gantt' ? (
                <GanttView rootId={slide.embed} embedded edit />
              ) : (
                <DiagramView rootId={slide.embed} embedded edit kind={slide.embedAs === 'mindmap' ? 'tree' : 'flow'} />
              )}
            </div>
          )}
        </div>
        {slide.image && <SlideImage id={slide.id} src={slide.image} />}
      </div>
    </>
  );
}

/** How far the text on a slide may shrink to fit (past that, what does not fit is cut off). */
const FIT_MIN = 0.5;

/**
 * Shrink the text of a slide's content until it fits, rather than having the
 * slide cut it off: its bullets and blocks, as --fit times their size (the
 * slide's own pixels, unchanged by how large it is shown). Worked out again
 * on every render, so it grows back as text is taken out.
 */
function useFitText(ref: RefObject<HTMLDivElement | null>) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const over = (e: Element) => e.scrollHeight > e.clientHeight + 1;
    const overflows = () => over(el) || [...el.querySelectorAll('.slide-text, .slide-data:not(.editing)')].some(over);
    let fit = 1;
    el.style.setProperty('--fit', '1');
    // Halving the step each time: a few layouts find the size to within a percent or so.
    if (overflows()) {
      let [lo, hi] = [FIT_MIN, 1];
      for (let i = 0; i < 6; i++) {
        fit = (lo + hi) / 2;
        el.style.setProperty('--fit', String(fit));
        if (overflows()) hi = fit;
        else lo = fit;
      }
      fit = lo;
      el.style.setProperty('--fit', String(fit));
    }
    el.dataset.fit = fit < 1 ? String(Math.round(fit * 100)) : '';
  });
}

function Bullets({ bullets }: { bullets: Bullet[] }) {
  return (
    <ul>
      {bullets.map((b) => (
        <BulletItem key={b.id} bullet={b} />
      ))}
    </ul>
  );
}

function BulletItem({ bullet }: { bullet: Bullet }) {
  const { store } = useCtl();
  const ref = useRef<HTMLLIElement>(null);
  useFlowEditor(ref);
  return (
    <li ref={ref} class={store.node(bullet.id).completed ? 'done' : ''}>
      <NodeText node={store.node(bullet.id)} />
      {bullet.children.length > 0 && <Bullets bullets={bullet.children} />}
    </li>
  );
}

/** The slide showing id: the one of the row it is under the deck (or is), -1 when none. */
function slideOf(slides: Slide[], store: ReturnType<typeof useCtl>['store'], id: string): number {
  for (let r: string | undefined = id; r; r = store.parentOf(r)) {
    const i = slides.findIndex((s) => s.id === r);
    if (i >= 0) return i;
  }
  return -1;
}

/** A block on the slide as its format draws it, typed in when clicked. */
function SlideBlock({ id }: { id: string }) {
  const ctl = useCtl();
  const n = ctl.store.node(id);
  const html = useMemo(() => renderFormat(n.format!, n.text), [n.format, n.text]);
  if (ctl.activeField === fText(id).key) {
    return (
      <div class="slide-data editing">
        <BlockBody node={n} />
      </div>
    );
  }
  return (
    <div
      class={`slide-data fmt fmt-${n.format}`}
      title={t('クリックして編集（Esc で終了）', 'Click to edit (Esc to finish)')}
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={(e) => !(e.target as Element).closest('a') && !document.getSelection()?.toString() && ctl.focus(fText(id, 'end'))}
    />
  );
}

/** id's field name when its value is one line of text to type in (not a list under it, nor a block). */
function plainField(store: ReturnType<typeof useCtl>['store'], id: string, name: string) {
  const f = store.field(id, name);
  return f && f.format === null && !f.children.length ? f : undefined;
}

/** A field's value shown on the slide (as text), typed in where it is when it is one line of text. */
function FieldText({ id, name, text }: { id: string; name: string; text: string }) {
  const { store } = useCtl();
  const f = plainField(store, id, name);
  return f ? <NodeText node={f} /> : <InlineText text={text} />;
}

/** The slide's picture; clicked, its address (`image:`) to type in under it. */
function SlideImage({ id, src }: { id: string; src: string }) {
  const ctl = useCtl();
  const f = plainField(ctl.store, id, 'image');
  const editing = !!f && ctl.activeField === fText(f.id).key;
  return (
    <div class="slide-image-box">
      <img
        class="slide-image"
        src={fileUrl(src)}
        alt=""
        title={f ? t('クリックで画像のアドレスを編集', "Click to edit the picture's address") : undefined}
        onClick={() => f && ctl.focus(fText(f.id, 'end'))}
      />
      {editing && (
        <div class="slide-image-src">
          <NodeText node={f} />
        </div>
      )}
    </div>
  );
}

/** The speaker notes, typed in where they are (a block, or one line); none yet, a button that adds the field. */
function Notes({ id, text }: { id: string; text?: string }) {
  const ctl = useCtl();
  const f = ctl.store.field(id, 'notes');
  if (!f) {
    return (
      <button
        class="mini"
        onClick={() => {
          const n = ctl.store.addField(id, 'notes');
          ctl.commit(fText(n.id, 0));
        }}
      >
        {t('ノートを書く', 'Write notes')}
      </button>
    );
  }
  if (f.format !== null) return <BlockBody node={f} />;
  if (f.children.length) return <>{text}</>; // a list under it: written in the outline
  return <NodeText node={f} />;
}
