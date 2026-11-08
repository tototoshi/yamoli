import type { TargetedEvent, TextareaHTMLAttributes } from 'preact';
import { useContext, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'preact/hooks';
import { applyFocus, Controller, fKey, fText, type View } from './controller';
import { hasFormat, listFormats, getFormat, renderFormat } from './formats';
import { parseInline } from './inline';
import { findBacklinks, nodeLabel } from './links';
import { blockers, DEP_KEY, dependencies, dependents, depStatus, findCycles } from './deps';
import { startBulletDrag } from './drag';
import { Ctx, useCtl } from './context';
import { GanttView } from './GanttView';
import { SlidesView } from './SlidesView';
import { SegView } from './InlineText';
import { shortDate, today } from './calendar';
import { schedTooltip } from './gantt';
import { computeSchedule } from './schedule';
import type { DataBlock, OutlineNode } from './model';
import { OutlineStore } from './model';
import { dataFile, flush, saveState } from './storage';

// Keep focus in the text while clicking toolbar-ish buttons.
const keepFocus = (e: MouseEvent) => e.preventDefault();
const imeActive = (e: KeyboardEvent) => e.isComposing || e.keyCode === 229;

// ================================================================ app

export function App() {
  const [ctl] = useState(() => new Controller());
  const [, rerender] = useReducer((n: number, _: void) => n + 1, 0);
  ctl.bind(rerender);

  useEffect(() => {
    const onHash = () => ctl.onHashChange();
    const onKey = (e: KeyboardEvent) => {
      if (imeActive(e)) return;
      // Our history replaces the browser's per-field undo everywhere.
      if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.code === 'KeyZ' || (e.code === 'KeyY' && e.ctrlKey))) {
        e.preventDefault();
        if (e.code === 'KeyY' || e.shiftKey) ctl.redo();
        else ctl.undo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.code === 'KeyF') {
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
    window.addEventListener('hashchange', onHash);
    document.addEventListener('keydown', onKey);
    const first = ctl.store.node(ctl.zoomId).children[0];
    if (first) ctl.focus(fText(first));
    else rerender();
    return () => {
      window.removeEventListener('hashchange', onHash);
      document.removeEventListener('keydown', onKey);
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
  ctl.cycles = findCycles(store);
  ctl.schedule = computeSchedule(store, ctl.cycles, ctl.jpDays);
  if (ctl.schedule.needsJp) ctl.loadJpHolidays();
  const rows = ctl.shownChildren(zoomId);
  document.title = (zoomId === store.rootId ? 'Home' : zoom.text || '無題') + ' – Outliner';

  return (
    <Ctx.Provider value={ctl}>
      <TopBar />
      <main class={'page' + (ctl.view !== 'outline' ? ' wide' : '') + (ctl.view === 'slides' ? ' slides-page' : '')}>
        <ZoomHeader node={zoom} />
        <div class="view-bar">
          <ViewSwitch />
          {search && (
            <div class="search-info">
              {search.matches.size ? `${search.matches.size} 件` : '見つかりません'}
              <button class="mini" onClick={() => ctl.setQuery('')}>
                検索をクリア
              </button>
            </div>
          )}
        </div>
        {ctl.view === 'gantt' ? (
          <GanttView />
        ) : ctl.view === 'slides' ? (
          <SlidesView />
        ) : (
          <section class="outline">
            <ul class="children top">
              {rows.map((id) => (
                <NodeItem key={id} id={id} />
              ))}
            </ul>
            {!search && !zoom.children.length && (
              <button class="add-first" onClick={() => ctl.commit(fText(store.addChild(zoomId).id, 0))}>
                + 項目を追加
              </button>
            )}
          </section>
        )}
      </main>
      <LinkPickerMenu />
      <ItemMenuView />
      <ToastView />
    </Ctx.Provider>
  );
}

// ================================================================ top bar

function TopBar() {
  const ctl = useCtl();
  const fileRef = useRef<HTMLInputElement>(null);
  const { store, zoomId } = ctl;
  const ancestors = zoomId === store.rootId ? [] : store.path(zoomId).slice(0, -1);

  const exportJson = () => {
    flush();
    const blob = new Blob([JSON.stringify(store.toJSON(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `outline-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const importJson = async (e: TargetedEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const next = OutlineStore.fromJSON(JSON.parse(await file.text()));
      if (confirm('現在のアウトラインを置き換えますか？')) ctl.replaceStore(next);
    } catch (err) {
      alert('読み込みに失敗しました: ' + (err as Error).message);
    }
  };

  return (
    <header class="topbar">
      <a class="brand" href="#/">
        Outliner
      </a>
      <nav class="crumbs">
        {ancestors.map((id) => (
          <a key={id} href={ctl.hashFor(id)} class="crumb">
            {id === store.rootId ? 'Home' : store.node(id).text || '無題'}
          </a>
        ))}
      </nav>
      <span class="spacer" />
      <SearchBox />
      <button
        class={'mini' + (ctl.prefs.showCompleted ? '' : ' on')}
        title="完了した行の表示を切り替え"
        onMouseDown={keepFocus}
        onClick={() => ctl.toggleShowCompleted()}
      >
        {ctl.prefs.showCompleted ? '完了を隠す' : '完了を表示'}
      </button>
      <button
        class={'mini' + (ctl.prefs.showFields ? '' : ' on')}
        title="属性の行（name: value）の表示を切り替え"
        onMouseDown={keepFocus}
        onClick={() => ctl.toggleShowFields()}
      >
        {ctl.prefs.showFields ? '属性を隠す' : '属性を表示'}
      </button>
      <button
        class="mini"
        title="元に戻す (⌘/Ctrl+Z)"
        disabled={!ctl.history.canUndo}
        onMouseDown={keepFocus}
        onClick={() => ctl.undo()}
      >
        ↶
      </button>
      <button
        class="mini"
        title="やり直す (⌘/Ctrl+Shift+Z)"
        disabled={!ctl.history.canRedo}
        onMouseDown={keepFocus}
        onClick={() => ctl.redo()}
      >
        ↷
      </button>
      <SaveIndicator />
      <HelpMenu />
      <button class="mini" onClick={() => fileRef.current?.click()}>
        Import
      </button>
      <button class="mini" onClick={exportJson}>
        Export
      </button>
      <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={importJson} />
    </header>
  );
}

function SearchBox() {
  const ctl = useCtl();
  return (
    <input
      class="search"
      type="search"
      placeholder="検索 (⌘F)　例: status:進行中"
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
  const where = dataFile ? `保存先: ${dataFile}` : '';
  switch (s.kind) {
    case 'local':
      return (
        <span
          class="save-state"
          title="ファイル保存用のサーバーが見つからないため、このブラウザ内に保存しています（URL ごとに別のデータになります）"
        >
          ブラウザに保存
        </span>
      );
    case 'saved':
      return (
        <span class="save-state" title={where}>
          保存済み
        </span>
      );
    case 'saving':
      return (
        <span class="save-state" title={where}>
          保存中…
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
          ⚠ 他の画面でファイルが更新されました
          <button
            class="mini"
            title="こちらの未保存の変更を捨てて、ファイルの内容を表示します"
            onClick={() => ctl.resolveConflict('file')}
          >
            ファイルを読み込む
          </button>
          <button
            class="mini"
            title="ファイルをこの画面の内容で上書きします"
            onClick={() => ctl.resolveConflict('mine')}
          >
            こちらで上書き
          </button>
        </span>
      );
  }
}

const SHORTCUTS: [string, string][] = [
  ['Enter', '新しい行（カーソル位置で分割）'],
  ['Shift+Enter', '行内改行'],
  ['Tab / Shift+Tab', 'インデント / アウトデント'],
  ['↑ / ↓', '前 / 次の行へ'],
  ['Alt(⌘)+Shift+↑↓', '行を移動'],
  ['⌘/Ctrl+↑ ↓', '折りたたみ / 展開'],
  ['⌘/Ctrl+Enter', '完了 / 未完了'],
  ['Alt+→ / ⌘+.', 'ズームイン（●クリックでも可）'],
  ['Alt+← / ⌘+,', 'ズームアウト（ブラウザの戻るでも可）'],
  ['name: と入力', '属性の行になる（値の先頭で Backspace で普通の行に戻す）'],
  ['Alt+A', '属性を追加（属性の下に Tab で入れ子のオブジェクト・リスト）'],
  ['Alt+D', 'データを追加'],
  ['[[', '他のアイテムへのリンク（本文・属性の値）'],
  ['Esc / ⌘+Enter', 'データ編集を終了'],
  ['Delete / Ctrl+D（行末）', '次の行を結合（空の行なら行を削除）'],
  ['⌘/Ctrl+Shift+Backspace', '行を削除（子も含む）'],
  ['● をドラッグ', '行を移動（Esc でキャンセル）'],
  ['⌘/Ctrl+Z', '元に戻す'],
  ['⌘/Ctrl+Shift+Z / Ctrl+Y', 'やり直す'],
  ['⌘/Ctrl+F', '検索（Esc でクリア、is:done で完了のみ）'],
  ['is:ready / is:blocked', '着手可 / 待ち の行を検索（after 属性の依存）'],
  ['is:late / is:critical', '期限超過 / クリティカルパス上の作業を検索'],
  ['duration: 3d / 2w / 10cd', '作業日数（稼働日 / 週 / 暦日、0d でマイルストーン）'],
  ['start / due', '開始日（子にも継承）/ 期限 — 例 2026-11-10'],
  ['スライド表示で ← →', 'ページ送り（F 全画面、N ノート、Home / End）'],
  ['layout / notes / theme', 'スライドの属性（center・two-column・title / ノート / dark）'],
  ['workdays / holidays', '稼働曜日（既定 mon-fri）/ 休日（jp で日本の祝日、a..b で期間）'],
];

function HelpMenu() {
  const ctl = useCtl();
  return (
    <details class="help" onToggle={(e) => e.currentTarget.querySelector('dl')?.scrollTo(0, 0)}>
      <summary>ショートカット</summary>
      <dl>
        <dd class="help-sample">
          <button class="mini" onClick={() => ctl.addSample()}>
            サンプルプロジェクトを追加
          </button>
          依存関係・日程計算・ガントの例
        </dd>
        <dd class="help-sample">
          <button class="mini" onClick={() => ctl.addGuide()}>
            使い方スライドを追加
          </button>
          このアプリの使い方（スライドの例）
        </dd>
        {SHORTCUTS.map(([k, v]) => [<dt key={k}>{k}</dt>, <dd key={k + ':d'}>{v}</dd>])}
      </dl>
    </details>
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
    <div class="view-switch" role="group" aria-label="表示">
      {item('outline', 'アウトライン')}
      {item('gantt', 'ガント')}
      {item('slides', 'スライド')}
    </div>
  );
}

function ZoomHeader({ node }: { node: OutlineNode }) {
  const ctl = useCtl();
  const isRoot = node.id === ctl.store.rootId;
  return (
    <section class="zoom-header">
      {isRoot ? <h1 class="title-static">Home</h1> : <NodeText node={node} title />}
      <Meta node={node} />
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
  const canToggle = kids.length > 0 && !search;
  const toggle = () => canToggle && ctl.store.setCollapsed(id, !n.collapsed) && ctl.commit();

  const isField = n.key !== null;
  let cls = 'node';
  if (isField) cls += ' field';
  if (kids.length && !expanded) cls += ' collapsed';
  if (n.completed) cls += ' completed';
  if (search) cls += search.matches.has(id) ? ' search-match' : ' search-context';

  return (
    <li class={cls} data-id={id}>
      <div class="row">
        <button
          class={'toggle' + (canToggle ? '' : ' empty')}
          tabIndex={-1}
          title={n.collapsed ? '展開' : '折りたたむ'}
          onMouseDown={keepFocus}
          onClick={toggle}
        >
          {canToggle ? '▾' : ''}
        </button>
        <a
          class="bullet"
          href={ctl.hashFor(id)}
          tabIndex={-1}
          title="クリックでズームイン / ドラッグで移動 / 右クリックでメニュー"
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
        <NodeText node={n} />
        {!isField && (
          <>
            <SchedLabel id={id} />
            <DepBadge id={id} />
            <Actions id={id} class="row-actions" />
          </>
        )}
      </div>
      <Meta node={n} />
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
          onBlur={(e) => {
            const input = e.currentTarget;
            setTimeout(() => document.activeElement !== input && ctl.onKeyBlur(node.id), 0);
          }}
        />
        :
      </span>
    );
  }
  return (
    <span
      class="field-name"
      title="クリックで名前を変更"
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
    return (
      <InlineView
        class="text text-view"
        text={node.text}
        data-id={node.id}
        onEdit={(pos) => ctl.focus(fText(node.id, pos))}
      />
    );
  }
  return (
    <AutoTextarea
      class={'text' + (title ? ' title' : '')}
      placeholder={title ? '無題' : undefined}
      data-id={node.id}
      data-fk={key}
      value={node.text}
      onInput={(e) => ctl.onTextInput(node.id, e.currentTarget)}
      onKeyDown={(e) => !imeActive(e) && ctl.onTextKeydown(e, e.currentTarget)}
      onPaste={(e) => ctl.onTextPaste(e, e.currentTarget)}
      onBlur={(e) => {
        const ta = e.currentTarget;
        setTimeout(() => document.activeElement !== ta && ctl.deactivate(key), 0);
      }}
    />
  );
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
    if (target.closest('a')) return; // let links open / zoom
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
      {id !== ctl.zoomId && (
        <button
          class="mini"
          title="完了 / 未完了 (⌘/Ctrl+Enter)"
          onMouseDown={keepFocus}
          onClick={() => ctl.toggleComplete(id)}
        >
          ✓
        </button>
      )}
      <button class="mini" title="属性を追加 (Alt+A)" onMouseDown={keepFocus} onClick={() => ctl.addAttribute(id)}>
        + 属性
      </button>
      <button class="mini" title="データを追加 (Alt+D)" onMouseDown={keepFocus} onClick={() => ctl.addData(id)}>
        + データ
      </button>
      {id !== ctl.store.rootId && (
        <button
          class="mini"
          title="依存先を追加（after 属性）"
          onMouseDown={keepFocus}
          onClick={() => ctl.addDependency(id)}
        >
          + 依存
        </button>
      )}
    </span>
  );
}

// ================================================================ attributes & data

function Meta({ node }: { node: OutlineNode }) {
  if (!node.data.length) return null;
  return (
    <div class="meta">
      {node.data.map((d) => (
        <DataBlockView key={d.id} nodeId={node.id} data={d} />
      ))}
    </div>
  );
}

function DataBlockView({ nodeId, data: d }: { nodeId: string; data: DataBlock }) {
  const ctl = useCtl();
  const editing = ctl.editing.has(d.id);
  const html = useMemo(() => renderFormat(d.format, d.content), [d.format, d.content]);

  // Leaving the editor (to anywhere outside this block) switches back to the rendered view.
  const onBlur = () =>
    setTimeout(() => {
      const a = document.activeElement;
      if (a?.closest(`.data[data-data="${CSS.escape(d.id)}"]`)) return;
      ctl.stopEditing(nodeId, d.id, false);
    }, 0);

  return (
    <div class={'data' + (editing ? ' editing' : '')} data-data={d.id} data-format={d.format}>
      <div class="data-head">
        <button
          class="data-fold"
          tabIndex={-1}
          title={d.collapsed ? '展開' : '折りたたむ'}
          onMouseDown={keepFocus}
          onClick={() => {
            ctl.store.updateData(nodeId, d.id, { collapsed: !d.collapsed });
            ctl.commit();
          }}
        >
          {d.collapsed ? '▸' : '▾'}
        </button>
        <select
          class="data-format"
          title="フォーマット"
          value={d.format}
          onChange={(e) => {
            ctl.store.updateData(nodeId, d.id, { format: e.currentTarget.value });
            ctl.commit();
          }}
        >
          {listFormats().map((f) => (
            <option key={f.name} value={f.name}>
              {f.label}
            </option>
          ))}
          {!hasFormat(d.format) && <option value={d.format}>{d.format} (未定義)</option>}
        </select>
        {d.collapsed && <span class="data-preview">{d.content.split('\n')[0].slice(0, 80)}</span>}
        <span class="spacer" />
        <button
          class="mini"
          onMouseDown={keepFocus}
          onClick={() => (editing ? ctl.stopEditing(nodeId, d.id, true) : ctl.startEditing(nodeId, d.id))}
        >
          {editing ? '完了' : '編集'}
        </button>
        <button
          class="mini danger"
          onMouseDown={keepFocus}
          onClick={() => {
            ctl.store.removeData(nodeId, d.id);
            ctl.editing.delete(d.id);
            ctl.commit(fText(nodeId));
          }}
        >
          削除
        </button>
      </div>
      {!d.collapsed &&
        (editing ? (
          <AutoTextarea
            class="data-editor"
            spellcheck={false}
            placeholder={getFormat(d.format).placeholder}
            data-id={nodeId}
            data-data={d.id}
            data-fk={'data:' + d.id}
            value={d.content}
            onInput={(e) => {
              ctl.store.updateData(nodeId, d.id, { content: e.currentTarget.value });
              ctl.commit(undefined, 'data:' + d.id);
            }}
            onKeyDown={(e) => !imeActive(e) && ctl.onDataKeydown(e, e.currentTarget)}
            onBlur={onBlur}
          />
        ) : (
          <div
            class="data-view"
            title="クリックして編集"
            dangerouslySetInnerHTML={{ __html: html }}
            onClick={(e) => {
              if (!(e.target as Element).closest('a')) ctl.startEditing(nodeId, d.id);
            }}
          />
        ))}
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
      <div class="backlinks-title">被リンク {links.length}</div>
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
              {b.via !== null && <span class="via">{b.via || '(属性)'}</span>}
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
        <li class="empty">一致するアイテムがありません</li>
      )}
    </ul>
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
      <div class="item-menu-title">{nodeLabel(store, m.id) || '無題'}</div>
      <button role="menuitem" onClick={run(() => (location.hash = ctl.hashFor(m.id, outline ? undefined : 'gantt')))}>
        ズームイン
      </button>
      {outline && n.children.length > 0 && (
        <button role="menuitem" onClick={run(() => (location.hash = ctl.hashFor(m.id, 'gantt')))}>
          ガントで開く
        </button>
      )}
      <hr />
      <button role="menuitem" onClick={run(() => ctl.toggleComplete(m.id))}>
        {n.completed ? '未完了に戻す' : '完了にする'}
      </button>
      {outline && (
        <>
          <button role="menuitem" onClick={run(() => ctl.addAttribute(m.id))}>
            属性を追加
          </button>
          <button role="menuitem" onClick={run(() => ctl.toggleField(m.id))}>
            {n.key === null ? '属性の行にする' : '普通の行に戻す'}
          </button>
          <button role="menuitem" onClick={run(() => ctl.addData(m.id))}>
            データを追加
          </button>
          <button role="menuitem" onClick={run(() => ctl.addDependency(m.id))}>
            依存を追加
          </button>
        </>
      )}
      <button role="menuitem" onClick={run(() => ctl.duplicateItem(m.id))}>
        複製{below ? `（中の ${below} 件も）` : ''}
      </button>
      <button role="menuitem" onClick={run(() => ctl.copyLink(m.id))}>
        リンクをコピー
      </button>
      <hr />
      <button role="menuitem" class="danger" onClick={run(() => ctl.deleteItem(m.id))}>
        削除{below ? `（中の ${below} 件も）` : ''}
      </button>
    </div>
  );
}

function ToastView() {
  const ctl = useCtl();
  const t = ctl.toast;
  if (!t) return null;
  return (
    <div class="toast" role="status" onMouseEnter={() => ctl.holdToast(true)} onMouseLeave={() => ctl.holdToast(false)}>
      {t.message}
      {t.undo && (
        <button
          onClick={() => {
            ctl.undo();
            ctl.hideToast();
          }}
        >
          元に戻す
        </button>
      )}
      <button class="close" title="閉じる" onClick={() => ctl.hideToast()}>
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
  if (status === 'none' || (store.node(id).completed && status !== 'cycle')) return null;
  if (status === 'ready') {
    return (
      <span class="dep-badge ready" title="前提がすべて完了しています">
        着手可
      </span>
    );
  }
  if (status === 'cycle') {
    return (
      <span class="dep-badge cycle" title="依存関係が循環しています">
        循環
      </span>
    );
  }
  const waiting = blockers(store, id);
  return (
    <span class="dep-badge blocked" title={'待っている: ' + waiting.map((w) => nodeLabel(store, w)).join('、')}>
      待ち {waiting.length}
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
          <span class="deps-title">前提</span>
          {before.map(chip)}
          <DepBadge id={id} />
        </div>
      )}
      {after.length > 0 && (
        <div class="deps-row">
          <span class="deps-title">後続</span>
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
    <span class="sched invalid" title="この値を解釈できません">
      ⚠ {invalid}
    </span>
  );
  if (schedule.unscheduled.has(id)) {
    return (
      <>
        <span class="sched unscheduled" title="start がこの行にも親にもなく、日程を計算できる依存もありません">
          開始日未設定
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
        {s.kind === 'summary' && <span class="span">{span}日</span>}
        {s.delayed && <span class="delayed">↷</span>}
        {s.late > 0 && !done && <span class="late">{s.late}日超過</span>}
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

/** A textarea that grows to fit its content. */
function AutoTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement> & Record<`data-${string}`, string>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const ta = ref.current!;
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 'px';
  });
  return <textarea ref={ref} rows={1} {...props} />;
}
