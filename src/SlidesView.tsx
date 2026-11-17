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
import { createContext } from 'preact';
import { createPortal } from 'preact/compat';
import type { RefObject } from 'preact';
import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
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
import { buildDeck, imageRows, removeImage, splitColumns, type Bullet, type ImageAt, type Layout, type Slide } from './slides';
import { fileUrl, filesIn } from './files';

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
  const [presenter, openPresenter] = usePresenterWindow();
  // A slide with its bullets shown one at a time: how many are, on which slide (another: none yet). Typing in it, all are.
  const [revealed, setRevealedState] = useState<{ id: string; n: number } | null>(null);
  // Also kept here, for keys pressed faster than the view is drawn again.
  const revealedNow = useRef(revealed);
  const setRevealed = (r: { id: string; n: number } | null) => {
    revealedNow.current = r;
    setRevealedState(r);
  };
  const steps = slide?.reveal ? slide.bullets.length : 0;
  const shownOf = (r: { id: string; n: number } | null) =>
    !steps || typed === index ? steps : r?.id === slide.id ? Math.min(r.n, steps) : 0;
  const shown = shownOf(revealed);
  const hidden = shown < steps ? new Set(slide.bullets.slice(shown).map((b) => b.id)) : undefined;
  /** The next bullet, else the next slide (its bullets still to come). */
  const forward = (at = index) => {
    const n = shownOf(revealedNow.current);
    if (at === index && n < steps) setRevealed({ id: slide.id, n: n + 1 });
    else go(at + 1);
  };
  /** The last bullet shown taken away, else the slide before with all of its. */
  const back = (at = index) => {
    const n = shownOf(revealedNow.current);
    if (at === index && n > 0) return setRevealed({ id: slide.id, n: n - 1 });
    const prev = deck.slides[at - 1];
    if (!prev) return;
    setRevealed({ id: prev.id, n: Infinity });
    go(at - 1);
  };
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

  // Pictures pasted (alone: not with text) or dropped anywhere on the view are added to the slide's.
  const imagesIn = (dt: DataTransfer | null) =>
    dt && !dt.getData('text') ? filesIn(dt).filter((f) => /^image\/(png|jpeg|gif|webp)$/.test(f.type)) : [];
  const canHaveImage = slide && slide.id !== ctl.zoomId && slide.layout !== 'title';
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = imagesIn(e.clipboardData);
      if (!files.length || !canHaveImage) return;
      // Before the row editor's own paste, which would add it to the row as a block.
      e.preventDefault();
      e.stopPropagation();
      ctl.addImages(slide.id, files);
    };
    document.addEventListener('paste', onPaste, true);
    return () => document.removeEventListener('paste', onPaste, true);
  });

  // ← → (and friends) page through the deck when not typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, [contenteditable]') || e.altKey || e.metaKey || e.ctrlKey) return;
      // A box or arrow selected in a drawing on the slide: the keys are its (a mind map's arrows move through it).
      if (document.querySelector('.slide [data-holding]')) return;
      const k = e.key;
      const at = Math.min(ctl.slide, count - 1); // not `index`: keys can arrive before the rerender
      if (k === 'ArrowRight' || k === 'ArrowDown' || k === 'PageDown' || k === ' ') forward(at);
      else if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp') back(at);
      else if (k === 'Home') go(0);
      else if (k === 'End') go(count - 1);
      else if (k === 'f') fullscreen();
      else if (k === 'n') setShowNotes((v) => !v);
      else return;
      e.preventDefault();
    };
    // The presenter's window pages through the deck with the same keys.
    const docs = presenter ? [document, presenter.document] : [document];
    docs.forEach((d) => d.addEventListener('keydown', onKey));
    return () => docs.forEach((d) => d.removeEventListener('keydown', onKey));
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
                title={nodeLabel(store, s.id) || t('無題', 'Untitled')}
                onClick={() => {
                  setRevealed(null); // from the start: none of its bullets yet
                  go(i);
                }}
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
                <SlideAt slide={s} width={THUMB} theme={deck.theme} />
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
          onDragOver={(e) => canHaveImage && e.dataTransfer?.types.includes('Files') && e.preventDefault()}
          onDrop={(e) => {
            const files = imagesIn(e.dataTransfer);
            if (!files.length || !canHaveImage) return;
            e.preventDefault();
            ctl.addImages(slide.id, files);
          }}
          onPointerDown={() => (wasTyping.current = !!document.activeElement?.closest('.slide .rich'))}
          onClick={(e) =>
            !wasTyping.current &&
            !(e.target as Element).closest(
              'a, button, .gantt-wrap, .diagram-wrap, .text, .rich, .slide-data, .block, .slide-image, .slide-image-tools'
            ) &&
            forward()
          }
        >
          <div class={`slide layout-${slide.layout}`} style={{ transform: `translate(${fit.x}px, ${fit.y}px) scale(${fit.scale})` }}>
            <SlideBody slide={slide} hidden={hidden} />
            <div class="slide-number">
              {index + 1} / {count}
            </div>
          </div>
        </div>
        <div class="slide-controls">
          <button class="mini" disabled={index === 0 && !shown} onClick={() => back()} title={t('前へ (←)', 'Previous (←)')}>
            ◀
          </button>
          <span class="slide-count">
            {index + 1} / {count}
          </span>
          <button class="mini" disabled={index === count - 1 && shown >= steps} onClick={() => forward()} title={t('次へ (→)', 'Next (→)')}>
            ▶
          </button>
          {slide.id !== ctl.zoomId && <LayoutPick slide={slide} />}
          {slide.bullets.length > 1 && <RevealSwitch slide={slide} />}
          <AddToSlide slide={slide} canHaveImage={!!canHaveImage} />
          <button class={'mini' + (showNotes ? ' on' : '')} onClick={() => setShowNotes(!showNotes)} title={t('ノート (N)', 'Notes (N)')}>
            {t('ノート', 'Notes')}
          </button>
          <button
            class={'mini' + (presenter ? ' on' : '')}
            onClick={openPresenter}
            title={t(
              'ノート・次のスライド・経過時間を別のウィンドウに',
              'The notes, the next slide and the time, in a window of their own'
            )}
          >
            {t('発表者ビュー', 'Presenter view')}
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
                    <Still.Provider value={true}>
                      <SlideBody slide={s} />
                    </Still.Provider>
                    <div class="slide-number">
                      {i + 1} / {count}
                    </div>
                  </div>
                </div>
              ))}
            </div>,
            document.body
          )}
        {presenter &&
          createPortal(
            <Presenter
              win={presenter}
              slides={deck.slides}
              index={index}
              shown={shown}
              steps={steps}
              theme={deck.theme}
              forward={() => forward()}
              back={() => back()}
            />,
            presenter.document.body
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

/** A slide's content; hidden: bullets not shown yet (a slide showing them one at a time), keeping their room. */
function SlideBody({ slide, hidden }: { slide: Slide; hidden?: Set<string> }) {
  const { store } = useCtl();
  const content = useRef<HTMLDivElement>(null);
  useFitText(content);
  const n = store.node(slide.id);
  const still = useContext(Still);
  const title = <SlideText node={n} />;
  // A subtitle or picture field is shown even empty (just added, or emptied to be taken away with Backspace).
  const hasSubtitle = !!(slide.subtitle || store.field(slide.id, 'subtitle'));
  const hasImage = !!store.field(slide.id, 'image');
  const at = slide.imageAt;

  if (slide.layout === 'title') {
    return (
      <div class="slide-title-only">
        <h1>{title}</h1>
        {hasSubtitle && (
          <p class="subtitle">
            <FieldText id={slide.id} name="subtitle" text={slide.subtitle ?? ''} />
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
        <Bullets bullets={slide.bullets} hidden={hidden} />
        <div class="slide-text">{data}</div>
      </div>
    ) : twoColumn ? (
      <div class="slide-columns">
        {splitColumns(slide.bullets).map((col, i) => (
          <Bullets key={i} bullets={col} hidden={hidden} />
        ))}
      </div>
    ) : (
      <>
        {slide.bullets.length > 0 && <Bullets bullets={slide.bullets} hidden={hidden} />}
        {data}
      </>
    );

  return (
    <>
      <h2>{title}</h2>
      {hasSubtitle && (
        <p class="subtitle">
          <FieldText id={slide.id} name="subtitle" text={slide.subtitle ?? ''} />
        </p>
      )}
      {hasImage && at === 'background' && <SlideImages id={slide.id} at={at} />}
      <div ref={content} class={'slide-content' + (hasImage ? ' with-image image-' + at : '')}>
        {/* A picture on its own under the title: nothing else. */}
        {!(hasImage && at === 'full') && (
          <div class="slide-text">
            {body}
            {slide.embed && (
              <div class="slide-embed">
                {slide.embedAs === 'gantt' ? (
                  <GanttView rootId={slide.embed} embedded edit={!still} />
                ) : (
                  <DiagramView rootId={slide.embed} embedded edit={!still} kind={slide.embedAs === 'mindmap' ? 'tree' : 'flow'} />
                )}
              </div>
            )}
          </div>
        )}
        {hasImage && at !== 'background' && <SlideImages id={slide.id} at={at} />}
      </div>
    </>
  );
}

/** Buttons that give the slide what it lacks: a subtitle (to type in), a picture (a file chosen). */
function AddToSlide({ slide, canHaveImage }: { slide: Slide; canHaveImage: boolean }) {
  const ctl = useCtl();
  const { store } = ctl;
  const pick = useRef<HTMLInputElement>(null);
  return (
    <>
      {!store.field(slide.id, 'subtitle') && (
        <button
          class="mini"
          onClick={() => {
            const f = store.addField(slide.id, 'subtitle', '');
            ctl.commit(fText(f.id, 0));
          }}
        >
          {t('+ サブタイトル', '+ Subtitle')}
        </button>
      )}
      {canHaveImage && (
        <>
          <button
            class="mini"
            onClick={() => pick.current?.click()}
            title={t('画像は貼り付けやドロップでも入ります', 'Or paste or drop a picture')}
          >
            {t('+ 画像', '+ Picture')}
          </button>
          <input
            ref={pick}
            type="file"
            accept="image/png, image/jpeg, image/gif, image/webp"
            multiple
            hidden
            onChange={(e) => {
              const files = [...(e.currentTarget.files ?? [])];
              e.currentTarget.value = '';
              if (files.length) ctl.addImages(slide.id, files);
            }}
          />
        </>
      )}
    </>
  );
}

/**
 * The presenter's window, opened by the button: an empty window this one
 * draws into (with its styles), so the slide on screen is the same in both
 * without any message between them. Closed with the view.
 */
function usePresenterWindow(): [Window | null, () => void] {
  const [win, setWin] = useState<Window | null>(null);
  const open = () => {
    if (win && !win.closed) return win.focus();
    const w = window.open('', 'yamoli-presenter', 'popup,width=1200,height=760');
    if (!w) return; // blocked
    const d = w.document;
    for (const a of document.documentElement.attributes) d.documentElement.setAttribute(a.name, a.value);
    d.head.replaceChildren(
      ...[...document.head.querySelectorAll('meta[charset], style, link[rel="stylesheet"]')].map((n) => {
        const c = n.cloneNode(true) as Element;
        if (n instanceof HTMLLinkElement) c.setAttribute('href', n.href); // its address, from this page
        return c;
      })
    );
    d.title = t('発表者ビュー', 'Presenter view') + ' – ' + document.title;
    d.body.replaceChildren();
    d.body.className = 'presenter-body';
    w.addEventListener('pagehide', () => setWin(null));
    setWin(w);
  };
  useEffect(() => () => win?.close(), [win]);
  return [win, open];
}

const clockText = (ms: number) => {
  const s = Math.floor(ms / 1000);
  const mm = String(Math.floor(s / 60) % 60).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return s >= 3600 ? `${Math.floor(s / 3600)}:${mm}:${ss}` : `${mm}:${ss}`;
};

/** In the presenter's window: the slide on screen, the next one, the notes, the time taken and the time of day. */
function Presenter(props: {
  win: Window;
  slides: Slide[];
  index: number;
  /** Of the slide's bullets shown one at a time, how many are (steps: of how many). */
  shown: number;
  steps: number;
  theme: string;
  forward: () => void;
  back: () => void;
}) {
  const { win, slides, index, shown, steps, theme, forward, back } = props;
  const [size, setSize] = useState({ w: win.innerWidth, h: win.innerHeight });
  const [start, setStart] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const resize = () => setSize({ w: win.innerWidth, h: win.innerHeight });
    const tick = win.setInterval(() => setNow(Date.now()), 1000);
    win.addEventListener('resize', resize);
    return () => {
      win.clearInterval(tick);
      win.removeEventListener('resize', resize);
    };
  }, [win]);
  const slide = slides[index];
  const next = slides[index + 1];
  const hide = (s: Slide, n: number) => (s.reveal && n < s.bullets.length ? new Set(s.bullets.slice(n).map((b) => b.id)) : undefined);
  // Next: the slide on screen with one more bullet, while it has any to come; else the next slide.
  const more = shown < steps;
  // The slide on screen as wide as it can be beside the next one's column, and under the controls' height.
  const big = Math.max(200, Math.min((size.w - 72) * 0.64, ((size.h - 96) * W) / H));
  const small = Math.max(160, size.w - 72 - big);
  return (
    <div class="presenter">
      <div class="presenter-main">
        <SlideAt slide={slide} hidden={hide(slide, shown)} width={big} theme={theme} number={`${index + 1} / ${slides.length}`} />
        <div class="presenter-controls">
          <button class="mini" disabled={index === 0 && !shown} onClick={back}>
            ◀
          </button>
          <span>
            {index + 1} / {slides.length}
            {steps > 0 && ` · ${t('箇条書き', 'bullets')} ${shown} / ${steps}`}
          </span>
          <button class="mini" disabled={index === slides.length - 1 && !more} onClick={forward}>
            ▶
          </button>
        </div>
      </div>
      <div class="presenter-side" style={{ width: small }}>
        <div class="presenter-time">
          <span class="presenter-elapsed" title={t('経過時間', 'Time taken')}>
            {clockText(now - start)}
          </span>
          <button class="mini" onClick={() => setStart(Date.now())}>
            {t('リセット', 'Reset')}
          </button>
          <span class="presenter-clock">{new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
        <div class="presenter-label">{more ? t('次の箇条書き', 'Next bullet') : t('次のスライド', 'Next slide')}</div>
        {more ? (
          <SlideAt slide={slide} hidden={hide(slide, shown + 1)} width={small} theme={theme} />
        ) : next ? (
          <SlideAt slide={next} hidden={hide(next, 0)} width={small} theme={theme} />
        ) : (
          <div class="presenter-end">{t('最後のスライドです', 'This is the last slide')}</div>
        )}
        <div class="presenter-label">{t('ノート', 'Notes')}</div>
        <div class="presenter-notes">{slide.notes || <span class="presenter-none">{t('ノートはありません', 'No notes')}</span>}</div>
      </div>
    </div>
  );
}

/** How wide a slide is drawn in the list beside it. */
const THUMB = 152;

/**
 * Slides only to be looked at (in the list, the presenter's window, printed):
 * their text drawn, never its editor, which the row being typed in has once,
 * on the slide on screen.
 */
const Still = createContext(false);

/** A row's text on a slide: edited in place when clicked, or (still) only drawn. */
function SlideText({ node }: { node: ReturnType<ReturnType<typeof useCtl>['store']['node']> }) {
  if (useContext(Still)) {
    return (
      <span class="text text-view">
        <InlineText text={node.text} />
      </span>
    );
  }
  return <NodeText node={node} />;
}

/** A slide drawn width pixels wide, only to be looked at. */
function SlideAt(props: { slide: Slide; hidden?: Set<string>; width: number; theme: string; number?: string }) {
  const { slide, hidden, width, theme, number } = props;
  const k = width / W;
  return (
    <div class={'slide-stage still-slide theme-' + theme} style={{ width, height: H * k }}>
      <div class={`slide layout-${slide.layout}`} style={{ transform: `scale(${k})` }}>
        <Still.Provider value={true}>
          <SlideBody slide={slide} hidden={hidden} />
        </Still.Provider>
        {number && <div class="slide-number">{number}</div>}
      </div>
    </div>
  );
}

/** Whether the slide's bullets come one at a time: its `reveal` field (yes, or no against the deck's yes; none when it is as the deck says). */
function RevealSwitch({ slide }: { slide: Slide }) {
  const ctl = useCtl();
  const { store } = ctl;
  const toggle = () => {
    const f = store.field(slide.id, 'reveal');
    if (f) store.remove(f.id);
    if (buildDeck(store, ctl.zoomId).slides.find((s) => s.id === slide.id)?.reveal === slide.reveal) {
      store.setField(slide.id, 'reveal', slide.reveal ? 'no' : 'yes');
    }
    ctl.commit(null);
  };
  return (
    <button
      class={'mini' + (slide.reveal ? ' on' : '')}
      onClick={toggle}
      title={t('箇条書きを → で 1 つずつ出す', 'Show the bullets one at a time with →')}
    >
      {t('1 つずつ', 'One by one')}
    </button>
  );
}

const LAYOUT_NAMES: [Layout, string, string][] = [
  ['default', '標準', 'Standard'],
  ['center', '中央', 'Centred'],
  ['two-column', '2 段組', 'Two columns'],
  ['title', 'タイトルのみ', 'Title only'],
];

/** The slide's layout, chosen from a menu: written as its `layout` field (none for the standard one). */
function LayoutPick({ slide }: { slide: Slide }) {
  const ctl = useCtl();
  const set = (to: Layout) => {
    const f = ctl.store.field(slide.id, 'layout');
    if (to !== 'default') ctl.store.setField(slide.id, 'layout', to);
    else if (f) ctl.store.remove(f.id);
    ctl.commit(null);
  };
  return (
    <select
      class="slide-layout"
      title={t('レイアウト', 'Layout')}
      value={slide.layout}
      onChange={(e) => set(e.currentTarget.value as Layout)}
    >
      {LAYOUT_NAMES.map(([value, ja, en]) => (
        <option key={value} value={value}>
          {t(ja, en)}
        </option>
      ))}
    </select>
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

function Bullets({ bullets, hidden }: { bullets: Bullet[]; hidden?: Set<string> }) {
  return (
    <ul>
      {bullets.map((b) => (
        <BulletItem key={b.id} bullet={b} hidden={hidden?.has(b.id)} />
      ))}
    </ul>
  );
}

function BulletItem({ bullet, hidden }: { bullet: Bullet; hidden?: boolean }) {
  const { store } = useCtl();
  const ref = useRef<HTMLLIElement>(null);
  useFlowEditor(ref);
  return (
    <li ref={ref} class={(store.node(bullet.id).completed ? 'done' : '') + (hidden ? ' unrevealed' : '')}>
      <SlideText node={store.node(bullet.id)} />
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
  const still = useContext(Still);
  if (ctl.activeField === fText(id).key && !still) {
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
  return f ? <SlideText node={f} /> : <InlineText text={text} />;
}

/**
 * The slide's pictures, side by side or one over another as where they go
 * has room for; one clicked, its address to type in under them, and × over
 * it takes it off. Behind the slide: the first.
 */
function SlideImages({ id, at }: { id: string; at: ImageAt }) {
  const ctl = useCtl();
  const { store } = ctl;
  const still = useContext(Still);
  const rows = imageRows(store, id);
  const editingRow = still ? undefined : rows.find((n) => ctl.activeField === fText(n.id).key || !n.text.trim());
  const address = editingRow && (
    <div class="slide-image-src">
      <NodeText node={editingRow} />
    </div>
  );
  const edit = (row: string) => ctl.focus(fText(row, 'end'));
  // Behind the slide, the picture can't be pointed at: its menu and address sit over the slide's top right corner.
  if (at === 'background') {
    const first = rows.find((n) => n.text.trim());
    return (
      <>
        <div class="slide-bg">{first && <img src={fileUrl(first.text.trim())} alt="" />}</div>
        {!still && (
          <div class={'slide-image-tools at-slide' + (address ? ' open' : '')}>
            <ImageAtMenu id={id} at={at} address={rows[0] ? () => edit(rows[0].id) : undefined} />
            {address}
          </div>
        )}
      </>
    );
  }
  const shown = rows.filter((n) => n.text.trim());
  // Beside the bullets, one over another; under them, side by side; alone, side by side up to three, then in a square-ish grid.
  const n = shown.length;
  const cols = at === 'right' || at === 'left' ? 1 : at === 'below' || n <= 3 ? n : Math.ceil(Math.sqrt(n));
  return (
    <div class="slide-image-box">
      {shown.length > 0 && (
        <div class="slide-images" style={{ gridTemplateColumns: `repeat(${Math.max(cols, 1)}, minmax(0, 1fr))` }}>
          {shown.map((n) => (
            <div key={n.id} class="slide-image-item">
              <img
                class="slide-image"
                src={fileUrl(n.text.trim())}
                alt=""
                title={t('クリックで画像のアドレスを編集', "Click to edit the picture's address")}
                onClick={() => edit(n.id)}
              />
              {!still && (
                <button
                  class="slide-image-del"
                  title={t('この画像を外す', 'Take this picture off')}
                  onClick={() => {
                    removeImage(store, id, n.id);
                    ctl.commit(null);
                  }}
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {!still && (
        <div class="slide-image-tools">
          <ImageAtMenu id={id} at={at} />
        </div>
      )}
      {address}
    </div>
  );
}

const IMAGE_AT_NAMES: [ImageAt, string, string][] = [
  ['right', '右', 'Right'],
  ['left', '左', 'Left'],
  ['below', '下', 'Below'],
  ['full', '大きく', 'Large'],
  ['background', '背景', 'Background'],
];

/** Where the picture goes, picked over it: its `image-at` field (none for beside the bullets on the right). */
function ImageAtMenu({ id, at, address }: { id: string; at: ImageAt; address?: () => void }) {
  const ctl = useCtl();
  const set = (to: ImageAt) => {
    const f = ctl.store.field(id, 'image-at');
    if (to !== 'right') ctl.store.setField(id, 'image-at', to);
    else if (f) ctl.store.remove(f.id);
    ctl.commit(null);
  };
  return (
    <span class="slide-image-menu" role="group" aria-label={t('画像の置き場所', 'Where the picture goes')}>
      {IMAGE_AT_NAMES.map(([value, ja, en]) => (
        <button key={value} class={'mini' + (at === value ? ' on' : '')} onClick={() => at !== value && set(value)}>
          {t(ja, en)}
        </button>
      ))}
      {address && (
        <button class="mini" onClick={address} title={t('画像のアドレスを編集', "Edit the picture's address")}>
          {t('アドレス', 'Address')}
        </button>
      )}
    </span>
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
