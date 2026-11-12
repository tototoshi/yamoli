import type { ComponentChildren, TargetedEvent } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { fText } from './focus';
import { IS_MAC } from './keys';
import type { View } from './viewState';
import { lang, t } from './i18n';
import { keepFocus, useCtl } from './context';
import { saveFile } from './exportImage';
import { toValue, toYaml } from './serialize';
import { OutlineStore } from './model';
import { imeActive } from './RowEditor';
import { dataFile, flush, saveState, type FieldsMode } from './storage';

// ================================================================ top bar

export function TopBar() {
  const ctl = useCtl();
  const { store, zoomId } = ctl;
  // The brand is the way home, so the crumbs start below it.
  const ancestors = zoomId === store.rootId ? [] : store.path(zoomId).slice(1, -1);
  // Its height, for what sticks under it (the Gantt chart's dates); the crumbs can wrap.
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver(() => document.documentElement.style.setProperty('--topbar-h', `${el.offsetHeight}px`));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <header class="topbar" ref={ref}>
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
      if (
        confirm(t('現在のアウトラインを置き換えますか？（元に戻すで取り消せます）', 'Replace the current outline? (Undo brings it back)'))
      )
        ctl.replaceStore(next);
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
                {t('元に戻す', 'Undo')}
                <kbd>⌘Z</kbd>
              </button>
              <button role="menuitem" disabled={!ctl.history.canRedo} onClick={run(() => ctl.redo())}>
                {t('やり直す', 'Redo')}
                <kbd>⇧⌘Z</kbd>
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
              <button
                role="menuitem"
                title={t('依存関係・日程計算・ガントの例', 'Dependencies, scheduling and the Gantt chart')}
                onClick={run(() => ctl.addSample())}
              >
                {t('サンプルプロジェクトを追加', 'Add the sample project')}
              </button>
              <button
                role="menuitem"
                title={t('システム構成図の例（図ビュー）', 'A system architecture, in the Diagram view')}
                onClick={run(() => ctl.addDiagramSample())}
              >
                {t('構成図のサンプルを追加', 'Add the architecture sample')}
              </button>
              <button
                role="menuitem"
                title={t('このアプリの使い方（スライドの例）', 'How to use this app (as slides)')}
                onClick={run(() => ctl.addGuide())}
              >
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
    t(
      '複数行を選択：Tab・Shift+Tab・削除・⌘C・⌘X・⌘Shift+Enter、● のドラッグでまとめて移動',
      'Select rows: Tab, Shift+Tab, delete, ⌘C, ⌘X, ⌘Shift+Enter; drag a ● to move them all'
    ),
  ],
  ['⌘/Ctrl+↑ ↓', t('折りたたみ / 展開', 'Collapse / expand')],
  [
    '⌘/Ctrl+Enter',
    t('下に新しい行（カーソルの位置によらず、子の行の後ろに）', 'A new row below (wherever the caret is, after the rows under it)'),
  ],
  ['⌘/Ctrl+Shift+Enter', t('完了 / 未完了', 'Complete / reopen')],
  [
    '⌘/Ctrl+L',
    t(
      'タスクにする / やめる（「タスクだけ」で絞り込み、検索 is:todo）',
      'Mark as a task or not (filter with “Tasks only”, search is:todo)'
    ),
  ],
  ['Alt+→ / ⌘+.', t('ズームイン（●クリックでも可）', 'Zoom in (or click the ●)')],
  ['Alt+← / ⌘+,', t('ズームアウト（ブラウザの戻るでも可）', 'Zoom out (or the browser’s Back)')],
  [
    t('name: と入力', 'Type name: '),
    t('属性の行になる（値の先頭で Backspace で普通の行に戻す）', 'Makes a field (Backspace at the value’s start undoes it)'),
  ],
  ['Alt+A', t('属性を追加（属性の下に Tab で入れ子のオブジェクト・リスト）', 'Add a field (Tab under a field nests an object or list)')],
  ['Alt+D', t('ブロック（Markdown・CSV・コードなど複数行の値）を追加', 'Add a block: a multi-line value (Markdown, CSV, code …)')],
  [
    t('属性の名前・値で ↓', '↓ in a field’s name or value'),
    t('使ったことのある名前・値から選ぶ（Enter で決定）', 'Pick a name or value already in use (Enter takes it)'),
  ],
  ['[[', t('他のアイテムへのリンク（本文・属性の値）', 'Link to another item (in text or a field value)')],
  [
    IS_MAC ? '⌘K' : 'Ctrl+K',
    t('リンクを追加・編集（URL を選択範囲に貼り付けてもリンクになる）', 'Add or edit a link (or paste a URL over selected text)'),
  ],
  ['Esc / ⌘+Enter', t('ブロックの編集を終了', 'Finish editing a block')],
  [
    t('Delete / Ctrl+D（行末）', 'Delete / Ctrl+D (at the end)'),
    t('次の行を結合（空の行なら行を削除）', 'Join the next row (removes an empty row)'),
  ],
  ...(IS_MAC
    ? [
        [
          'Ctrl+K',
          t(
            'カーソルから行末まで削除（行末なら次の行を結合、Ctrl+Y で貼り戻す）',
            'Delete to the end of the line (at the end, join the next row; Ctrl+Y puts it back)'
          ),
        ] as [string, string],
      ]
    : []),
  ['⌘/Ctrl+Shift+Backspace', t('行を削除（子も含む）', 'Delete the row and what’s below it')],
  [t('● をドラッグ', 'Drag a ●'), t('行を移動（Esc でキャンセル）', 'Move the row (Esc cancels)')],
  ['⌘/Ctrl+Z', t('元に戻す', 'Undo')],
  [IS_MAC ? '⌘Shift+Z' : 'Ctrl+Shift+Z / Ctrl+Y', t('やり直す', 'Redo')],
  [t('⌘P（Mac）/ Ctrl+P', '⌘P (Mac) / Ctrl+P'), t('名前の一部で項目へジャンプ', 'Jump to an item by part of its name')],
  ['⌘/Ctrl+F', t('検索（Esc でクリア、is:done で完了のみ）', 'Search (Esc clears; is:done for completed rows)')],
  ['is:ready / is:blocked', t('着手可 / 待ち の行を検索（after 属性の依存）', 'Rows ready to start / waiting (after dependencies)')],
  ['is:late / is:critical', t('期限超過 / クリティカルパス上の作業を検索', 'Late work / work on the critical path')],
  [
    'duration: 3d / 2w / 10cd',
    t('作業日数（稼働日 / 週 / 暦日、0d でマイルストーン）', 'Length in working days / weeks / calendar days (0d: milestone)'),
  ],
  ['start / due', t('開始日（子にも継承）/ 期限 — 例 2026-11-10', 'Start (inherited by children) / deadline — e.g. 2026-11-10')],
  ['end', t('終了日（duration の代わりに start から end までのバー）', 'Last day (instead of a duration: a bar from start to end)')],
  [
    t('スライド表示で ← →', '← → in slides'),
    t('ページ送り（F 全画面、N ノート、Home / End）', 'Page through (F full screen, N notes, Home / End)'),
  ],
  [
    'layout / notes / theme',
    t('スライドの属性（center・two-column・title / ノート / dark）', 'Slide fields (center, two-column, title / speaker notes / dark)'),
  ],
  [
    'workdays / holidays',
    t(
      '稼働曜日（既定 mon-fri）/ 休日（jp で日本の祝日、a..b で期間）',
      'Working days (default mon-fri) / days off (jp: Japanese holidays, a..b: a range)'
    ),
  ],
];

function HelpMenu() {
  return (
    <Popup label="?" title={t('ショートカット', 'Shortcuts')}>
      {(close) => (
        <>
          <a class="docs-link" href="#/docs" onClick={close}>
            {t('使い方ガイドを開く', 'Open the guide')} →
          </a>
          <dl class="shortcuts">{shortcuts().map(([k, v]) => [<dt key={k}>{k}</dt>, <dd key={k + ':d'}>{v}</dd>])}</dl>
        </>
      )}
    </Popup>
  );
}

// ================================================================ view bar

export function ViewSwitch() {
  const ctl = useCtl();
  const item = (view: View, label: string) => (
    <button class={ctl.view === view ? 'on' : ''} onMouseDown={keepFocus} onClick={() => ctl.view !== view && ctl.setView(view)}>
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
export function ViewToggles() {
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
