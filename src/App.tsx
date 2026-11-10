import type { ComponentChildren, TargetedEvent } from 'preact';
import { useContext, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'preact/hooks';
import { applyFocus, arrowOf, captureFocus, Controller, IS_MAC, fKey, fText, type View } from './controller';
import { hasFormat, listFormats, getFormat, placeholderOf, renderFormat } from './formats';
import { lang, t } from './i18n';
import { parseInline } from './inline';
import { findBacklinks, nodeLabel } from './links';
import { blockers, DEP_KEY, dependencies, dependents, depStatus, findCycles, missingDependencies } from './deps';
import { startBulletDrag, startRowSelect } from './drag';
import { Ctx, useCtl } from './context';
import { DiagramView } from './DiagramView';
import { saveFile } from './exportImage';
import { GanttView } from './GanttView';
import { SlidesView } from './SlidesView';
import { DataView } from './DataView';
import { SegView } from './InlineText';
import { formatDate, parseDate, shortDate, today } from './calendar';
import { schedTooltip } from './gantt';
import { toValue, toYaml } from './serialize';
import { computeSchedule } from './schedule';
import type { OutlineNode } from './model';
import { OutlineStore } from './model';
import { AutoTextarea, hasFocus, imeActive, RowEditor } from './RowEditor';
import { dataFile, flush, saveState, type FieldsMode } from './storage';

// Keep focus in the text while clicking toolbar-ish buttons.
const keepFocus = (e: MouseEvent) => e.preventDefault();

// ================================================================ app

export function App() {
  const [ctl] = useState(() => new Controller());
  const [, rerender] = useReducer((n: number, _: void) => n + 1, 0);
  ctl.bind(rerender);

  useEffect(() => {
    const onHash = () => ctl.onHashChange();
    const onKey = (e: KeyboardEvent) => {
      if (imeActive(e)) return;
      if (ctl.selectionKeydown(e)) return;
      // Our history replaces the browser's per-field undo everywhere.
      if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.code === 'KeyZ' || (e.code === 'KeyY' && e.ctrlKey))) {
        e.preventDefault();
        if (e.code === 'KeyY' || e.shiftKey) ctl.redo();
        else ctl.undo();
        return;
      }
      // ⌘P on macOS (where Ctrl+P is the up arrow), Ctrl+P elsewhere; either way not the print dialog.
      if ((IS_MAC ? e.metaKey : e.ctrlKey) && !e.altKey && !e.shiftKey && e.code === 'KeyP') {
        e.preventDefault();
        ctl.setJumping(true);
        return;
      }
      // ⌘F on macOS, where Ctrl+F moves the caret.
      if ((IS_MAC ? e.metaKey : e.ctrlKey) && !e.altKey && !e.shiftKey && e.code === 'KeyF') {
        e.preventDefault();
        const box = document.querySelector<HTMLInputElement>('input.search');
        box?.focus();
        box?.select();
        return;
      }
      if (e.target === document.body && e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        ctl.zoomOut();
      }
    };
    // A press outside the rows ends a selection of rows (a press on a row handles it itself).
    const onPress = (e: PointerEvent) => ctl.selection && !(e.target as Element).closest('.outline .row') && ctl.clearSelection();
    window.addEventListener('hashchange', onHash);
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPress);
    const first = ctl.store.node(ctl.zoomId).children[0];
    if (first) ctl.focus(fText(first));
    else rerender();
    return () => {
      window.removeEventListener('hashchange', onHash);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPress);
    };
  }, []);

  // Apply focus requested by the last commit, after the DOM is updated.
  useLayoutEffect(() => {
    if (!ctl.pendingFocus) return;
    applyFocus(ctl.pendingFocus);
    ctl.pendingFocus = null;
  });

  const { store, zoomId, search } = ctl;
  const zoom = store.node(zoomId);
  ctl.taskRows = ctl.prefs.tasksOnly && (ctl.view === 'outline' || ctl.view === 'text') ? ctl.findTaskRows() : null;
  ctl.cycles = findCycles(store);
  ctl.selected = new Set(ctl.selectedRows());
  if (ctl.selection && !ctl.selected.size) ctl.selection = null;
  ctl.schedule = computeSchedule(store, ctl.cycles, ctl.jpDays);
  if (ctl.schedule.needsJp) ctl.loadJpHolidays();
  const rows = ctl.shownChildren(zoomId);
  document.title = (zoomId === store.rootId ? 'Home' : zoom.text || t('無題', 'Untitled')) + ' – Yamoli';

  return (
    <Ctx.Provider value={ctl}>
      <TopBar />
      <main class={'page' + (ctl.view === 'gantt' || ctl.view === 'diagram' || ctl.view === 'slides' ? ' wide' : '') + (ctl.view === 'slides' ? ' slides-page' : '')}>
        <ZoomHeader node={zoom} />
        <div class="view-bar">
          <ViewSwitch />
          <ViewToggles />
          {search && (
            <div class="search-info">
              {search.matches.size ? t(`${search.matches.size} 件`, `${search.matches.size} found`) : t('見つかりません', 'No matches')}
              <button class="mini" onClick={() => ctl.setQuery('')}>
                {t('検索をクリア', 'Clear search')}
              </button>
            </div>
          )}
        </div>
        {ctl.view === 'gantt' ? (
          <GanttView />
        ) : ctl.view === 'diagram' ? (
          <DiagramView />
        ) : ctl.view === 'slides' ? (
          <SlidesView />
        ) : ctl.view === 'text' || ctl.view === 'yaml' || ctl.view === 'json' ? (
          <DataView format={ctl.view} />
        ) : (
          <section class="outline">
            <ul class="children top">
              {rows.map((id) => (
                <NodeItem key={id} id={id} />
              ))}
            </ul>
            {!search && !zoom.children.length && (
              <button class="add-first" onClick={() => ctl.commit(fText(store.addChild(zoomId).id, 0))}>
                {t('+ 項目を追加', '+ Add an item')}
              </button>
            )}
          </section>
        )}
      </main>
      <LinkPickerMenu />
      <SuggestMenu />
      {ctl.jumping && <JumpBox />}
      <ItemMenuView />
      <ToastView />
    </Ctx.Provider>
  );
}

// ================================================================ top bar

function TopBar() {
  const ctl = useCtl();
  const { store, zoomId } = ctl;
  // The brand is the way home, so the crumbs start below it.
  const ancestors = zoomId === store.rootId ? [] : store.path(zoomId).slice(1, -1);
  return (
    <header class="topbar">
      <a class="brand" href="#/" title="Home">
        Yamoli
      </a>
      <nav class="crumbs">
        {ancestors.map((id) => (
          <a key={id} href={ctl.hashFor(id)} class="crumb">
            {store.node(id).text || t('無題', 'Untitled')}
          </a>
        ))}
      </nav>
      <span class="spacer" />
      <SearchBox />
      <SaveIndicator />
      <HelpMenu />
      <MoreMenu />
    </header>
  );
}

/** A button in the top bar opening a panel; closes on Esc or a click elsewhere. */
function Popup({ label, title, children }: { label: string; title: string; children: (close: () => void) => ComponentChildren }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  const close = () => ref.current?.removeAttribute('open');
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && close();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <details class="popup" ref={ref} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary title={title}>{label}</summary>
      {open && <div class="popup-panel">{children(close)}</div>}
    </details>
  );
}

const download = (name: string, text: string, type: string) => saveFile(name, new Blob([text], { type }));

/** Less frequent actions: undo, files, samples. */
function MoreMenu() {
  const ctl = useCtl();
  const fileRef = useRef<HTMLInputElement>(null);
  const day = () => new Date().toLocaleDateString('sv-SE');

  const importJson = async (e: TargetedEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const next = OutlineStore.fromJSON(JSON.parse(await file.text()));
      if (confirm(t('現在のアウトラインを置き換えますか？（元に戻すで取り消せます）', 'Replace the current outline? (Undo brings it back)'))) ctl.replaceStore(next);
    } catch (err) {
      alert(t('読み込みに失敗しました: ', 'Couldn’t load the file: ') + (err as Error).message);
    }
  };

  return (
    <>
      <Popup label="⋯" title={t('その他の操作', 'More')}>
        {(close) => {
          const run = (f: () => void) => () => {
            close();
            f();
          };
          return (
            <div class="menu-list" role="menu">
              <button role="menuitem" disabled={!ctl.history.canUndo} onClick={run(() => ctl.undo())}>
                {t('元に戻す', 'Undo')}<kbd>⌘Z</kbd>
              </button>
              <button role="menuitem" disabled={!ctl.history.canRedo} onClick={run(() => ctl.redo())}>
                {t('やり直す', 'Redo')}<kbd>⇧⌘Z</kbd>
              </button>
              <hr />
              <button
                role="menuitem"
                title={t('全体を YAML で保存（読み込みには使えません）', 'Save everything as YAML (can’t be loaded back)')}
                onClick={run(() => download(`yamoli-${day()}.yaml`, toYaml(toValue(ctl.store, ctl.store.rootId)), 'text/yaml'))}
              >
                {t('YAML で書き出す', 'Export as YAML')}
              </button>
              <button
                role="menuitem"
                title={t('全体をそのまま保存（読み込みで復元できます）', 'Save everything as is (load it to restore)')}
                onClick={run(() => {
                  flush();
                  download(`yamoli-${day()}.json`, JSON.stringify(ctl.store.toJSON(), null, 2), 'application/json');
                })}
              >
                {t('バックアップを書き出す（JSON）', 'Export a backup (JSON)')}
              </button>
              <button role="menuitem" onClick={run(() => fileRef.current?.click())}>
                {t('バックアップから読み込む…', 'Restore from a backup…')}
              </button>
              <hr />
              <button role="menuitem" title={t('依存関係・日程計算・ガントの例', 'Dependencies, scheduling and the Gantt chart')} onClick={run(() => ctl.addSample())}>
                {t('サンプルプロジェクトを追加', 'Add the sample project')}
              </button>
              <button role="menuitem" title={t('システム構成図の例（図ビュー）', 'A system architecture, in the Diagram view')} onClick={run(() => ctl.addDiagramSample())}>
                {t('構成図のサンプルを追加', 'Add the architecture sample')}
              </button>
              <button role="menuitem" title={t('このアプリの使い方（スライドの例）', 'How to use this app (as slides)')} onClick={run(() => ctl.addGuide())}>
                {t('使い方スライドを追加', 'Add the guide slides')}
              </button>
              <hr />
              <button role="menuitem" onClick={run(() => ctl.setLanguage(lang() === 'ja' ? 'en' : 'ja'))}>
                {lang() === 'ja' ? 'English' : '日本語'}
              </button>
            </div>
          );
        }}
      </Popup>
      <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={importJson} />
    </>
  );
}

function SearchBox() {
  const ctl = useCtl();
  return (
    <input
      class="search"
      type="search"
      placeholder={t('検索 (⌘F)　例: status:進行中', 'Search (⌘F)  e.g. status:active')}
      spellcheck={false}
      value={ctl.query}
      onInput={(e) => ctl.setQuery(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (imeActive(e)) return;
        if (e.key === 'Escape') {
          e.preventDefault();
          if (ctl.query) ctl.setQuery('');
          else ctl.focus(fText(ctl.visibleRows()[0] ?? ctl.zoomId));
        } else if (e.key === 'Enter' || e.key === 'ArrowDown') {
          e.preventDefault();
          const first = ctl.visibleRows().find((id) => ctl.search?.matches.has(id)) ?? ctl.visibleRows()[0];
          if (first) ctl.focus(fText(first));
        }
      }}
    />
  );
}

/** Where the outline is saved, and whether that worked. */
function SaveIndicator() {
  const ctl = useCtl();
  const s = saveState();
  const where = dataFile ? t(`保存先: ${dataFile}`, `Saved to ${dataFile}`) : '';
  switch (s.kind) {
    case 'local':
      return (
        <span
          class="save-state"
          title={t(
            'ファイル保存用のサーバーが見つからないため、このブラウザ内に保存しています（URL ごとに別のデータになります）',
            'No file server found, so the outline is saved in this browser (separately for each URL)'
          )}
        >
          {t('ブラウザに保存', 'Saved in browser')}
        </span>
      );
    case 'saved':
      return (
        <span class="save-state" title={where}>
          {t('保存済み', 'Saved')}
        </span>
      );
    case 'saving':
      return (
        <span class="save-state" title={where}>
          {t('保存中…', 'Saving…')}
        </span>
      );
    case 'error':
      return (
        <span class="save-state error" title={where}>
          ⚠ {s.message}
        </span>
      );
    case 'conflict':
      return (
        <span class="save-state conflict" title={where}>
          ⚠ {t('他の画面でファイルが更新されました', 'The file was changed elsewhere')}
          <button
            class="mini"
            title={t('こちらの未保存の変更を捨てて、ファイルの内容を表示します', 'Drop the changes here and show the file')}
            onClick={() => ctl.resolveConflict('file')}
          >
            {t('ファイルを読み込む', 'Load the file')}
          </button>
          <button
            class="mini"
            title={t('ファイルをこの画面の内容で上書きします', 'Overwrite the file with what is shown here')}
            onClick={() => ctl.resolveConflict('mine')}
          >
            {t('こちらで上書き', 'Keep mine')}
          </button>
        </span>
      );
  }
}

const shortcuts = (): [string, string][] => [
  ['Enter', t('新しい行（カーソル位置で分割）', 'New row (splits at the caret)')],
  ['Shift+Enter', t('行内改行', 'Line break within a row')],
  ['Tab / Shift+Tab', t('インデント / アウトデント', 'Indent / outdent')],
  [t('↑ ↓ / Ctrl+P N（Mac）', '↑ ↓ / Ctrl+P N (Mac)'), t('前 / 次の行へ', 'Previous / next row')],
  [t('← → / Ctrl+B F（Mac）', '← → / Ctrl+B F (Mac)'), t('行の端で前 / 次の行へ', 'At a row’s ends, on to the previous / next row')],
  ['Alt(⌘)+Shift+↑↓', t('行を移動', 'Move the row')],
  [
    t('Shift+↑↓（行の端で）/ Shift+クリック / 行をまたいでドラッグ', 'Shift+↑↓ (at a row’s ends) / Shift+click / drag across rows'),
    t('複数行を選択：Tab・Shift+Tab・削除・⌘C・⌘X・⌘Enter、● のドラッグでまとめて移動', 'Select rows: Tab, Shift+Tab, delete, ⌘C, ⌘X, ⌘Enter; drag a ● to move them all'),
  ],
  ['⌘/Ctrl+↑ ↓', t('折りたたみ / 展開', 'Collapse / expand')],
  ['⌘/Ctrl+Enter', t('完了 / 未完了', 'Complete / reopen')],
  ['⌘/Ctrl+L', t('タスクにする / やめる（「タスクだけ」で絞り込み、検索 is:todo）', 'Mark as a task or not (filter with “Tasks only”, search is:todo)')],
  ['Alt+→ / ⌘+.', t('ズームイン（●クリックでも可）', 'Zoom in (or click the ●)')],
  ['Alt+← / ⌘+,', t('ズームアウト（ブラウザの戻るでも可）', 'Zoom out (or the browser’s Back)')],
  [t('name: と入力', 'Type name: '), t('属性の行になる（値の先頭で Backspace で普通の行に戻す）', 'Makes a field (Backspace at the value’s start undoes it)')],
  ['Alt+A', t('属性を追加（属性の下に Tab で入れ子のオブジェクト・リスト）', 'Add a field (Tab under a field nests an object or list)')],
  ['Alt+D', t('ブロック（Markdown・CSV・コードなど複数行の値）を追加', 'Add a block: a multi-line value (Markdown, CSV, code …)')],
  [t('属性の名前・値で ↓', '↓ in a field’s name or value'), t('使ったことのある名前・値から選ぶ（Enter で決定）', 'Pick a name or value already in use (Enter takes it)')],
  ['[[', t('他のアイテムへのリンク（本文・属性の値）', 'Link to another item (in text or a field value)')],
  ['⌘/Ctrl+K', t('リンクを追加・編集（URL を選択範囲に貼り付けてもリンクになる）', 'Add or edit a link (or paste a URL over selected text)')],
  ['Esc / ⌘+Enter', t('ブロックの編集を終了', 'Finish editing a block')],
  [t('Delete / Ctrl+D（行末）', 'Delete / Ctrl+D (at the end)'), t('次の行を結合（空の行なら行を削除）', 'Join the next row (removes an empty row)')],
  ['⌘/Ctrl+Shift+Backspace', t('行を削除（子も含む）', 'Delete the row and what’s below it')],
  [t('● をドラッグ', 'Drag a ●'), t('行を移動（Esc でキャンセル）', 'Move the row (Esc cancels)')],
  ['⌘/Ctrl+Z', t('元に戻す', 'Undo')],
  ['⌘/Ctrl+Shift+Z / Ctrl+Y', t('やり直す', 'Redo')],
  [t('⌘P（Mac）/ Ctrl+P', '⌘P (Mac) / Ctrl+P'), t('名前の一部で項目へジャンプ', 'Jump to an item by part of its name')],
  ['⌘/Ctrl+F', t('検索（Esc でクリア、is:done で完了のみ）', 'Search (Esc clears; is:done for completed rows)')],
  ['is:ready / is:blocked', t('着手可 / 待ち の行を検索（after 属性の依存）', 'Rows ready to start / waiting (after dependencies)')],
  ['is:late / is:critical', t('期限超過 / クリティカルパス上の作業を検索', 'Late work / work on the critical path')],
  ['duration: 3d / 2w / 10cd', t('作業日数（稼働日 / 週 / 暦日、0d でマイルストーン）', 'Length in working days / weeks / calendar days (0d: milestone)')],
  ['start / due', t('開始日（子にも継承）/ 期限 — 例 2026-11-10', 'Start (inherited by children) / deadline — e.g. 2026-11-10')],
  [t('スライド表示で ← →', '← → in slides'), t('ページ送り（F 全画面、N ノート、Home / End）', 'Page through (F full screen, N notes, Home / End)')],
  ['layout / notes / theme', t('スライドの属性（center・two-column・title / ノート / dark）', 'Slide fields (center, two-column, title / speaker notes / dark)')],
  ['workdays / holidays', t('稼働曜日（既定 mon-fri）/ 休日（jp で日本の祝日、a..b で期間）', 'Working days (default mon-fri) / days off (jp: Japanese holidays, a..b: a range)')],
];

function HelpMenu() {
  return (
    <Popup label="?" title={t('ショートカット', 'Shortcuts')}>
      {() => (
        <dl class="shortcuts">
          {shortcuts().map(([k, v]) => [<dt key={k}>{k}</dt>, <dd key={k + ':d'}>{v}</dd>])}
        </dl>
      )}
    </Popup>
  );
}

// ================================================================ outline

function ViewSwitch() {
  const ctl = useCtl();
  const item = (view: View, label: string) => (
    <button
      class={ctl.view === view ? 'on' : ''}
      onMouseDown={keepFocus}
      onClick={() => ctl.view !== view && ctl.setView(view)}
    >
      {label}
    </button>
  );
  return (
    <div class="view-switch" role="group" aria-label={t('表示', 'View')}>
      {item('outline', t('アウトライン', 'Outline'))}
      {item('gantt', t('ガント', 'Gantt'))}
      {item('diagram', t('図', 'Diagram'))}
      {item('slides', t('スライド', 'Slides'))}
      {item('text', t('テキスト', 'Text'))}
      {item('yaml', 'YAML')}
      {item('json', 'JSON')}
    </div>
  );
}

/** What the current view shows: completed rows (outline, Gantt, diagram, text) and fields (outline, text). */
function ViewToggles() {
  const ctl = useCtl();
  const { view, prefs } = ctl;
  if (view !== 'outline' && view !== 'gantt' && view !== 'diagram' && view !== 'text') return null;
  return (
    <div class="view-toggles">
      {(view === 'outline' || view === 'text') && (
        <label title={t('タスクと、それが入っている行だけを表示', 'Show only tasks, and the rows they are under')}>
          <input type="checkbox" checked={prefs.tasksOnly} onChange={() => ctl.toggleTasksOnly()} />
          {t('タスクだけ', 'Tasks only')}
        </label>
      )}
      <label title={t('完了した行を表示', 'Show completed rows')}>
        <input type="checkbox" checked={prefs.showCompleted} onChange={() => ctl.toggleShowCompleted()} />
        {t('完了', 'Completed')}
      </label>
      {(view === 'outline' || view === 'text') && (
        <label title={t('属性の行（name: value）の表示', 'How field rows (name: value) are shown')}>
          {t('属性', 'Fields')}
          <select value={prefs.fields} onChange={(e) => ctl.setFieldsMode(e.currentTarget.value as FieldsMode)}>
            <option value="show">{t('表示', 'Show')}</option>
            <option value="fold">{t('畳む', 'Fold')}</option>
            <option value="hide">{t('隠す', 'Hide')}</option>
          </select>
        </label>
      )}
    </div>
  );
}

function ZoomHeader({ node }: { node: OutlineNode }) {
  const ctl = useCtl();
  const isRoot = node.id === ctl.store.rootId;
  return (
    <section class="zoom-header">
      {isRoot ? <h1 class="title-static">Home</h1> : <NodeText node={node} title />}
      <Actions id={node.id} class="header-actions" />
      {!isRoot && <SchedLabel id={node.id} header />}
      {!isRoot && <DependencyPanel id={node.id} />}
      {!isRoot && <Backlinks id={node.id} />}
    </section>
  );
}

function NodeItem({ id }: { id: string }) {
  const ctl = useCtl();
  const { search } = ctl;
  const n = ctl.store.node(id);
  const kids = ctl.shownChildren(id);
  const expanded = ctl.isExpanded(id);
  const isField = n.key !== null;
  const isBlock = n.format !== null;
  const canToggle = (kids.length > 0 || isBlock) && !search;
  const toggle = () => canToggle && ctl.store.setCollapsed(id, !n.collapsed) && ctl.commit();

  let cls = 'node';
  if (isField) cls += ' field';
  if (isBlock) cls += ' block-field';
  if ((kids.length && !expanded) || (isBlock && n.collapsed)) cls += ' collapsed';
  if (n.completed) cls += ' completed';
  if (ctl.selected.has(id)) cls += ' selected';
  if (ctl.isContextRow(id)) cls += ' task-context';
  if (search) cls += search.matches.has(id) ? ' search-match' : ' search-context';

  return (
    <li class={cls} data-id={id}>
      <div
        class="row"
        onPointerDown={(e) =>
          !(e.target as Element).closest('.bullet, .toggle, button, input, select, .link-bubble') && startRowSelect(e, id, ctl)
        }
      >
        <button
          class={'toggle' + (canToggle ? '' : ' empty')}
          tabIndex={-1}
          title={n.collapsed ? t('展開', 'Expand') : t('折りたたむ', 'Collapse')}
          onMouseDown={keepFocus}
          onClick={toggle}
        >
          {canToggle && (
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          )}
        </button>
        <a
          class="bullet"
          href={ctl.hashFor(id)}
          tabIndex={-1}
          title={t('クリックでズームイン / ドラッグで移動 / 右クリックでメニュー', 'Click to zoom in / drag to move / right-click for the menu')}
          draggable={false}
          onPointerDown={(e) => e.button === 0 && startBulletDrag(e, id, ctl)}
          onContextMenu={(e) => {
            e.preventDefault();
            ctl.openMenu(id, e.clientX, e.clientY);
          }}
        >
          <span class="dot" />
        </a>
        {isField && <FieldKey node={n} />}
        {isBlock ? <BlockHead node={n} /> : <NodeText node={n} />}
        {isField && !isBlock && <DatePick node={n} />}
        {!isField && (
          <>
            <FieldsSummary id={id} />
            <SchedLabel id={id} />
            <DepBadge id={id} />
            <Actions id={id} class="row-actions" />
          </>
        )}
      </div>
      {isBlock && <BlockBody node={n} />}
      {expanded && kids.length > 0 && (
        <ul class="children">
          {kids.map((c) => (
            <NodeItem key={c} id={c} />
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * With fields folded: the row's fields in one line (`duration: 3d · after: Kickoff`),
 * which opens them below; ▾ closes them again.
 */
function FieldsSummary({ id }: { id: string }) {
  const ctl = useCtl();
  const { store } = ctl;
  if (ctl.prefs.fields !== 'fold') return null;
  const fields = store.node(id).children.filter((c) => store.isField(c) && store.node(c).format === null);
  if (!fields.length) return null;
  const open = ctl.fieldsShown(id);
  const summary = fields
    .map((f) => (store.node(f).children.length ? `${store.node(f).key} …` : nodeLabel(store, f)))
    .join(' · ');
  return (
    <button
      class={'fields-summary' + (open ? ' open' : '')}
      tabIndex={-1}
      title={open ? t('属性を畳む', 'Fold the fields') : summary}
      onMouseDown={keepFocus}
      onClick={() => ctl.toggleFieldsOpen(id)}
    >
      <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true">
        <path d="M4.5 2.5 8 6l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      {!open && <span>{summary}</span>}
    </button>
  );
}

const DATE_KEYS = new Set(['start', 'due']);

/** A calendar button on date fields (`start`, `due`, or any `YYYY-MM-DD`), opening the browser's date picker. */
function DatePick({ node }: { node: OutlineNode }) {
  const ctl = useCtl();
  const current = parseDate(node.text);
  if (current === null && !DATE_KEYS.has(node.key!.trim().toLowerCase())) return null;
  return (
    <span class="date-pick" title={t('日付を選ぶ', 'Pick a date')}>
      📅
      <input
        type="date"
        tabIndex={-1}
        value={formatDate(current ?? today())}
        onClick={(e) => {
          try {
            e.currentTarget.showPicker();
          } catch {
            // not supported: the input's own click opens it, or nothing does
          }
        }}
        onChange={(e) => e.currentTarget.value && ctl.setFieldText(node.id, e.currentTarget.value)}
      />
    </span>
  );
}

/** The name part of a field row (`name: value`); click to rename. */
function FieldKey({ node }: { node: OutlineNode }) {
  const ctl = useCtl();
  const key = 'fkey:' + node.id;
  if (ctl.activeField === key) {
    return (
      <span class="field-name">
        <input
          class="field-key-input"
          placeholder="key"
          spellcheck={false}
          size={Math.max(node.key!.length, 3)}
          data-id={node.id}
          data-fk={key}
          value={node.key!}
          onInput={(e) => ctl.onKeyInput(node.id, e.currentTarget)}
          onKeyDown={(e) => !imeActive(e) && ctl.onKeyKeydown(e, e.currentTarget)}
          onBlur={() => setTimeout(() => !hasFocus(key) && ctl.onKeyBlur(node.id), 0)}
        />
        :
      </span>
    );
  }
  return (
    <span
      class="field-name"
      title={t('クリックで名前を変更', 'Click to rename')}
      onMouseDown={(e) => {
        e.preventDefault();
        ctl.focus(fKey(node.id));
      }}
    >
      {node.key || 'key'}:
    </span>
  );
}

function NodeText({ node, title }: { node: OutlineNode; title?: boolean }) {
  const ctl = useCtl();
  const key = 'text:' + node.id;
  if (!title && ctl.activeField !== key) {
    const { store } = ctl;
    // An object in a list (`- name: …`) has no text of its own: show what it holds.
    const fields = !node.text && store.isData(node.id) ? node.children.filter((c) => store.isField(c)) : [];
    return (
      <InlineView
        class="text text-view"
        text={node.text}
        placeholder={fields.length ? fields.map((f) => nodeLabel(store, f)).join(' · ') : undefined}
        data-id={node.id}
        onEdit={(pos) => ctl.focus(fText(node.id, pos))}
      />
    );
  }
  return <RowEditor node={node} title={title} />;
}

/**
 * Text shown with inline formatting; clicking it calls onEdit with the caret
 * offset under the pointer. Links open, item links zoom, #tags search.
 */
function InlineView({
  text,
  class: cls,
  placeholder,
  focusable,
  onEdit,
  ...rest
}: {
  text: string;
  class: string;
  placeholder?: string;
  /** Reachable with Tab (focusing it starts editing). */
  focusable?: boolean;
  onEdit: (pos: number | 'end') => void;
} & Record<`data-${string}`, string>) {
  const ctl = useCtl();
  const segs = useMemo(() => parseInline(text), [text]);
  const pointerDown = useRef(false);

  const onClick = (e: MouseEvent) => {
    pointerDown.current = false;
    const target = e.target as Element;
    // A click on a link edits there (the bubble then offers to open it); ⌘/Ctrl+click follows it.
    const link = target.closest<HTMLAnchorElement>('a');
    if (link) {
      const ref = link.dataset.ref;
      if (e.metaKey || e.ctrlKey) {
        if (ref) {
          e.preventDefault();
          ctl.zoomTo(ref);
        }
        return;
      }
      e.preventDefault();
      if (ref) return onEdit(Number(link.dataset.o)); // its label isn't the source text: put the caret inside
    }
    const tag = target.closest<HTMLElement>('.tag');
    if (tag) {
      ctl.setQuery(tag.textContent ?? '');
      return;
    }
    // Map the clicked point back to a caret offset in the source text.
    let pos: number | 'end' = 'end';
    const hit = caretFromPoint(e.clientX, e.clientY);
    const span = hit?.node.parentElement?.closest<HTMLElement>('[data-o]');
    if (hit && span && (e.currentTarget as Element).contains(span)) {
      pos = Number(span.dataset.o) + hit.offset;
    }
    onEdit(pos);
  };

  return (
    <div
      class={cls}
      tabIndex={focusable ? 0 : undefined}
      onMouseDown={() => (pointerDown.current = true)}
      onFocus={() => !pointerDown.current && onEdit('end')}
      onClick={onClick}
      {...rest}
    >
      {segs.map((seg) => (
        <SegView key={seg.start} seg={seg} />
      ))}
      {!text && placeholder && <span class="placeholder">{placeholder}</span>}
    </div>
  );
}

function Actions({ id, class: cls }: { id: string; class: string }) {
  const ctl = useCtl();
  return (
    <span class={cls}>
      {/* A plain row can become a task; a task can be completed, and reopened. */}
      {id !== ctl.zoomId &&
        (!ctl.store.isTask(id) ? (
          <button class="mini" title={t('やることとして登録 (⌘/Ctrl+L)', 'Mark as something to do (⌘/Ctrl+L)')} onMouseDown={keepFocus} onClick={() => ctl.toggleTask([id])}>
            {t('タスク', 'Task')}
          </button>
        ) : (
          <button
            class="mini"
            title={ctl.store.node(id).completed ? t('未完了に戻す (⌘/Ctrl+Enter)', 'Reopen (⌘/Ctrl+Enter)') : t('完了にする (⌘/Ctrl+Enter)', 'Complete (⌘/Ctrl+Enter)')}
            onMouseDown={keepFocus}
            onClick={() => ctl.toggleComplete(id)}
          >
            {ctl.store.node(id).completed ? '↺' : '✓'}
          </button>
        ))}
      <button class="mini" title={t('属性を追加 (Alt+A)', 'Add a field (Alt+A)')} onMouseDown={keepFocus} onClick={() => ctl.addAttribute(id)}>
        {t('+ 属性', '+ Field')}
      </button>
      <button
        class="mini"
        title={t('ブロック（Markdown・CSV・コードなど複数行の値）を追加 (Alt+D)', 'Add a block: a multi-line value such as Markdown, CSV or code (Alt+D)')}
        onMouseDown={keepFocus}
        onClick={() => ctl.addBlock(id)}
      >
        {t('+ ブロック', '+ Block')}
      </button>
      {id !== ctl.store.rootId && (
        <button
          class="mini"
          title={t('依存先を追加（after 属性）', 'Add a dependency (after field)')}
          onMouseDown={keepFocus}
          onClick={() => ctl.addDependency(id)}
        >
          {t('+ 依存', '+ After')}
        </button>
      )}
    </span>
  );
}

// ================================================================ blocks

/** A block's format, and its first line while folded. */
function BlockHead({ node }: { node: OutlineNode }) {
  const ctl = useCtl();
  return (
    <span class="block-head">
      <select
        class="block-format"
        title={t('フォーマット', 'Format')}
        value={node.format!}
        onChange={(e) => {
          ctl.store.setFormat(node.id, e.currentTarget.value);
          ctl.commit();
        }}
      >
        {listFormats().map((f) => (
          <option key={f.name} value={f.name}>
            {f.label}
          </option>
        ))}
        {!hasFormat(node.format!) && <option value={node.format!}>{node.format} {t('(未定義)', '(unknown)')}</option>}
      </select>
      {node.collapsed && <span class="block-preview">{node.text.split('\n')[0].slice(0, 80)}</span>}
    </span>
  );
}

/** A block's text: rendered in its format, or the editor once clicked. */
function BlockBody({ node }: { node: OutlineNode }) {
  const ctl = useCtl();
  const key = 'text:' + node.id;
  const editing = ctl.activeField === key;
  const html = useMemo(() => renderFormat(node.format!, node.text), [node.format, node.text]);
  if (node.collapsed && !editing) return null;
  return (
    <div class={'block' + (editing ? ' editing' : '')} data-format={node.format}>
      {editing ? (
        <AutoTextarea
          class="block-editor"
          spellcheck={false}
          placeholder={placeholderOf(getFormat(node.format!))}
          data-id={node.id}
          data-fk={key}
          value={node.text}
          onInput={(e) => ctl.onTextInput(node.id, e.currentTarget)}
          onKeyDown={(e) => !imeActive(e) && ctl.onTextKeydown(e, e.currentTarget)}
          onBlur={() => setTimeout(() => !hasFocus(key) && ctl.deactivate(key), 0)}
        />
      ) : (
        <div
          class="data-view"
          title={t('クリックして編集（Esc で終了）', 'Click to edit (Esc to finish)')}
          dangerouslySetInnerHTML={{ __html: html }}
          onClick={(e) => !(e.target as Element).closest('a') && ctl.focus(fText(node.id, 'end'))}
        />
      )}
    </div>
  );
}

// ================================================================ links

function Backlinks({ id }: { id: string }) {
  const ctl = useCtl();
  const { store } = ctl;
  // Links from `after` attributes are listed by DependencyPanel instead.
  const links = findBacklinks(store, id).filter((b) => b.via?.trim().toLowerCase() !== DEP_KEY);
  if (!links.length) return null;
  return (
    <div class="backlinks">
      <div class="backlinks-title">{t('被リンク', 'Linked from')} {links.length}</div>
      <ul>
        {links.map((b, i) => {
          const path = store
            .path(b.nodeId)
            .slice(1, -1)
            .map((a) => nodeLabel(store, a))
            .join(' › ');
          return (
            <li key={`${b.nodeId}:${b.via ?? ''}:${i}`}>
              <a href={ctl.hashFor(b.nodeId)}>{nodeLabel(store, b.nodeId)}</a>
              {b.via !== null && <span class="via">{b.via || t('(属性)', '(field)')}</span>}
              {path && <span class="bl-path">{path}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Candidate list for the `[[` link picker, positioned under its field. */
function LinkPickerMenu() {
  const ctl = useCtl();
  const p = ctl.picker;
  const ref = useRef<HTMLUListElement>(null);
  useLayoutEffect(() => {
    if (!p || !ref.current) return;
    const field = document.querySelector(`[data-fk="${CSS.escape(p.key)}"]`);
    if (!field) return;
    const r = field.getBoundingClientRect();
    ref.current.style.left = r.left + 'px';
    ref.current.style.top = r.bottom + 4 + 'px';
  });
  if (!p) return null;
  const { store } = ctl;
  return (
    <ul ref={ref} class="link-picker">
      {p.candidates.length ? (
        p.candidates.map((id, i) => (
          <li
            key={id}
            class={i === p.selected ? 'selected' : undefined}
            onMouseDown={(e) => {
              e.preventDefault(); // keep the field focused
              ctl.insertLink(id);
            }}
          >
            <span class="pick-label">{nodeLabel(store, id)}</span>
            <span class="pick-path">
              {store
                .path(id)
                .slice(1, -1)
                .map((a) => nodeLabel(store, a))
                .join(' › ')}
            </span>
          </li>
        ))
      ) : (
        <li class="empty">{t('一致するアイテムがありません', 'No matching items')}</li>
      )}
    </ul>
  );
}

/** Names or values to complete a field with, under the field being typed in. */
function SuggestMenu() {
  const ctl = useCtl();
  const s = ctl.suggest;
  const ref = useRef<HTMLUListElement>(null);
  useLayoutEffect(() => {
    if (!s || !ref.current) return;
    const field = document.querySelector(`[data-fk="${CSS.escape(s.key)}"]`);
    if (!field) return;
    const r = field.getBoundingClientRect();
    ref.current.style.left = r.left + 'px';
    ref.current.style.top = r.bottom + 4 + 'px';
  });
  if (!s) return null;
  return (
    <ul ref={ref} class="link-picker suggest">
      {s.words.map((w, i) => (
        <li
          key={w}
          class={i === s.selected ? 'selected' : undefined}
          onMouseDown={(e) => {
            e.preventDefault(); // keep the field focused
            ctl.acceptSuggestion(w);
          }}
        >
          <span class="pick-label">{w}</span>
        </li>
      ))}
    </ul>
  );
}

/** Jump to an item by part of its name (⌘P): Enter zooms into it, Esc goes back. */
function JumpBox() {
  const ctl = useCtl();
  const { store } = ctl;
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const [back] = useState(captureFocus);
  const input = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => input.current?.focus(), []);
  const found = ctl.jumpCandidates(query);
  const close = () => {
    ctl.setJumping(false);
    ctl.focus(back);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (imeActive(e)) return;
    const key = arrowOf(e);
    if ((key === 'ArrowDown' || key === 'ArrowUp') && found.length) {
      e.preventDefault();
      setSelected((selected + (key === 'ArrowDown' ? 1 : -1) + found.length) % found.length);
    } else if (e.key === 'Enter' && found[selected]) {
      e.preventDefault();
      ctl.jumpTo(found[selected]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };
  return (
    <div class="jump-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div class="jump-box">
        <input
          ref={input}
          class="jump-input"
          placeholder={t('項目へジャンプ…', 'Jump to an item…')}
          spellcheck={false}
          value={query}
          onInput={(e) => {
            setQuery(e.currentTarget.value);
            setSelected(0);
          }}
          onKeyDown={onKeyDown}
        />
        <ul class="link-picker jump-list">
          {found.length ? (
            found.map((id, i) => (
              <li
                key={id}
                class={(i === selected ? 'selected' : '') + (store.node(id).completed ? ' done' : '')}
                onMouseMove={() => i !== selected && setSelected(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  ctl.jumpTo(id);
                }}
              >
                <span class="pick-label">{nodeLabel(store, id)}</span>
                <span class="pick-path">
                  {store
                    .path(id)
                    .slice(1, -1)
                    .map((a) => nodeLabel(store, a))
                    .join(' › ')}
                </span>
              </li>
            ))
          ) : (
            <li class="empty">{t('一致するアイテムがありません', 'No matching items')}</li>
          )}
        </ul>
      </div>
    </div>
  );
}

// ================================================================ item menu

function ItemMenuView() {
  const ctl = useCtl();
  const m = ctl.menu;
  const ref = useRef<HTMLDivElement>(null);

  // Keep the menu on screen and give it keyboard focus.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!m || !el) return;
    const r = el.getBoundingClientRect();
    el.style.left = Math.max(8, Math.min(m.x, innerWidth - r.width - 8)) + 'px';
    el.style.top = Math.max(8, Math.min(m.y, innerHeight - r.height - 8)) + 'px';
    el.querySelector<HTMLButtonElement>('button')?.focus();
  }, [m]);

  useEffect(() => {
    if (!m) return;
    const close = (e: Event) => {
      if (e.type === 'mousedown' && ref.current?.contains(e.target as Node)) return;
      ctl.closeMenu();
    };
    document.addEventListener('mousedown', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('blur', close);
    window.addEventListener('hashchange', close);
    return () => {
      document.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('blur', close);
      window.removeEventListener('hashchange', close);
    };
  }, [m]);

  if (!m || !ctl.store.get(m.id)) return null;
  const { store } = ctl;
  const n = store.node(m.id);
  const below = store.descendantCount(m.id);
  const outline = ctl.view === 'outline';
  const run = (fn: () => void) => () => {
    ctl.closeMenu();
    fn();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const items = [...ref.current!.querySelectorAll<HTMLButtonElement>('button')];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') ctl.closeMenu();
    else if (e.key === 'ArrowDown') items[(i + 1) % items.length].focus();
    else if (e.key === 'ArrowUp') items[(i - 1 + items.length) % items.length].focus();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div ref={ref} class="item-menu" role="menu" onKeyDown={onKeyDown} onContextMenu={(e) => e.preventDefault()}>
      <div class="item-menu-title">{nodeLabel(store, m.id)}</div>
      <button role="menuitem" onClick={run(() => (location.hash = ctl.hashFor(m.id, outline ? undefined : 'gantt')))}>
        {t('ズームイン', 'Zoom in')}
      </button>
      {outline && n.children.length > 0 && (
        <button role="menuitem" onClick={run(() => (location.hash = ctl.hashFor(m.id, 'gantt')))}>
          {t('ガントで開く', 'Open as Gantt')}
        </button>
      )}
      <hr />
      <button role="menuitem" onClick={run(() => ctl.toggleComplete(m.id))}>
        {n.completed ? t('未完了に戻す', 'Reopen') : t('完了にする', 'Complete')}
      </button>
      <button role="menuitem" onClick={run(() => ctl.toggleTask([m.id]))}>
        {store.isTask(m.id) ? t('タスクをやめる', 'Not a task') : t('タスクにする', 'Mark as a task')}
      </button>
      {outline && (
        <>
          <button role="menuitem" onClick={run(() => ctl.addAttribute(m.id))}>
            {t('属性を追加', 'Add a field')}
          </button>
          <button role="menuitem" onClick={run(() => ctl.toggleField(m.id))}>
            {n.key === null ? t('属性の行にする', 'Make it a field') : t('普通の行に戻す', 'Make it an ordinary row')}
          </button>
          <button role="menuitem" onClick={run(() => ctl.addBlock(m.id))}>
            {t('ブロックを追加', 'Add a block')}
          </button>
          <button role="menuitem" onClick={run(() => ctl.addDependency(m.id))}>
            {t('依存を追加', 'Add a dependency')}
          </button>
        </>
      )}
      <button role="menuitem" onClick={run(() => ctl.duplicateItem(m.id))}>
        {t('複製', 'Duplicate')}
        {below ? t(`（中の ${below} 件も）`, ` (with ${below} below)`) : ''}
      </button>
      <button role="menuitem" onClick={run(() => ctl.copyTree(m.id))}>
        {below ? t(`ツリーをコピー（中の ${below} 件も）`, `Copy tree (with ${below} below)`) : t('コピー', 'Copy')}
      </button>
      <button role="menuitem" onClick={run(() => ctl.copyLink(m.id))}>
        {t('リンクをコピー', 'Copy link')}
      </button>
      <hr />
      <button role="menuitem" class="danger" onClick={run(() => ctl.deleteItem(m.id))}>
        {t('削除', 'Delete')}
        {below ? t(`（中の ${below} 件も）`, ` (with ${below} below)`) : ''}
      </button>
    </div>
  );
}

function ToastView() {
  const ctl = useCtl();
  const toast = ctl.toast;
  if (!toast) return null;
  return (
    <div class="toast" role="status" onMouseEnter={() => ctl.holdToast(true)} onMouseLeave={() => ctl.holdToast(false)}>
      {toast.message}
      {toast.undo && (
        <button
          onClick={() => {
            ctl.undo();
            ctl.hideToast();
          }}
        >
          {t('元に戻す', 'Undo')}
        </button>
      )}
      <button class="close" title={t('閉じる', 'Close')} onClick={() => ctl.hideToast()}>
        ×
      </button>
    </div>
  );
}

// ================================================================ dependencies

/** Ready / waiting / cycle marker for open rows that have dependencies. */
function DepBadge({ id }: { id: string }) {
  const ctl = useCtl();
  const { store } = ctl;
  const status = depStatus(store, id, ctl.cycles);
  const missing = missingDependencies(store, id);
  const broken = missing.length > 0 && !store.node(id).completed && (
    <span
      class="dep-badge cycle"
      title={t('after のリンク先が見つかりません（削除された？）。この依存は日程に効いていません', 'An item in `after` is gone (deleted?), so it no longer holds this up')}
    >
      ⚠ {t('依存先なし', 'Missing')} {missing.length}
    </span>
  );
  if (status === 'none' || (store.node(id).completed && status !== 'cycle')) return broken || null;
  if (broken) return broken;
  if (status === 'ready') {
    return (
      <span class="dep-badge ready" title={t('前提がすべて完了しています', 'Everything it waits for is done')}>
        {t('着手可', 'Ready')}
      </span>
    );
  }
  if (status === 'cycle') {
    return (
      <span class="dep-badge cycle" title={t('依存関係が循環しています', 'Dependency cycle')}>
        {t('循環', 'Cycle')}
      </span>
    );
  }
  const waiting = blockers(store, id);
  return (
    <span class="dep-badge blocked" title={t('待っている: ', 'Waiting for: ') + waiting.map((w) => nodeLabel(store, w)).join(t('、', ', '))}>
      {t('待ち', 'Waiting')} {waiting.length}
    </span>
  );
}

function DependencyPanel({ id }: { id: string }) {
  const ctl = useCtl();
  const { store } = ctl;
  const before = dependencies(store, id);
  const after = dependents(store, id);
  if (!before.length && !after.length) return null;
  const chip = (d: string) => (
    <a key={d} class={'ref' + (store.node(d).completed ? ' done' : '')} href={ctl.hashFor(d)}>
      {nodeLabel(store, d)}
    </a>
  );
  return (
    <div class="deps">
      {before.length > 0 && (
        <div class="deps-row">
          <span class="deps-title">{t('前提', 'After')}</span>
          {before.map(chip)}
          <DepBadge id={id} />
        </div>
      )}
      {after.length > 0 && (
        <div class="deps-row">
          <span class="deps-title">{t('後続', 'Before')}</span>
          {after.map(chip)}
        </div>
      )}
    </div>
  );
}

// ================================================================ schedule

/** Computed dates next to a row: "11/10 → 11/12", "◆ 11/24", late / critical marks. */
function SchedLabel({ id, header }: { id: string; header?: boolean }) {
  const { schedule, store } = useCtl();
  const invalid = schedule.invalid.get(id);
  const bad = invalid && (
    <span class="sched invalid" title={t('この値を解釈できません', 'Can’t read this value')}>
      ⚠ {invalid}
    </span>
  );
  if (schedule.unscheduled.has(id)) {
    return (
      <>
        <span class="sched unscheduled" title={t('start がこの行にも親にもなく、日程を計算できる依存もありません', 'No start on this row or above it, and no scheduled dependency')}>
          {t('開始日未設定', 'No start date')}
        </span>
        {bad}
      </>
    );
  }
  const s = schedule.byId.get(id);
  if (!s) return bad || null;
  const now = today();
  const done = store.node(id).completed;
  const span = s.end - s.start + 1;
  const range =
    s.kind === 'milestone' ? `◆ ${shortDate(s.start, now)}` : `${shortDate(s.start, now)} → ${shortDate(s.end, now)}`;
  const tip = schedTooltip(s);
  let cls = 'sched ' + s.kind;
  if (s.critical && s.kind !== 'summary') cls += ' critical';
  if (header) cls += ' header';
  return (
    <>
      <span class={cls} title={tip}>
        {s.critical && s.kind !== 'summary' && <span class="crit">★</span>}
        {range}
        {s.kind === 'summary' && <span class="span">{t(`${span}日`, `${span}d`)}</span>}
        {s.delayed && <span class="delayed">↷</span>}
        {s.late > 0 && !done && <span class="late">{t(`${s.late}日超過`, `${s.late}d late`)}</span>}
      </span>
      {bad}
    </>
  );
}

// ================================================================ helpers

function caretFromPoint(x: number, y: number): { node: Node; offset: number } | null {
  if (document.caretPositionFromPoint) {
    const p = document.caretPositionFromPoint(x, y);
    return p && { node: p.offsetNode, offset: p.offset };
  }
  const r = document.caretRangeFromPoint?.(x, y); // Safari < 18.4
  return r && { node: r.startContainer, offset: r.startOffset };
}


