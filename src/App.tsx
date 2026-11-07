import type { TargetedEvent, TextareaHTMLAttributes } from 'preact';
import { createContext } from 'preact';
import { useContext, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'preact/hooks';
import { applyFocus, Controller, fText } from './controller';
import { hasFormat, listFormats, getFormat, renderFormat } from './formats';
import { highlight, parseInline, type Seg } from './inline';
import { startBulletDrag } from './drag';
import type { Attribute, DataBlock, OutlineNode } from './model';
import { OutlineStore } from './model';
import { flush } from './storage';

const Ctx = createContext<Controller>(null!);
const useCtl = () => useContext(Ctx);

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
  const rows = ctl.shownChildren(zoomId);
  document.title = (zoomId === store.rootId ? 'Home' : zoom.text || '無題') + ' – Outliner';

  return (
    <Ctx.Provider value={ctl}>
      <TopBar />
      <main class="page">
        <ZoomHeader node={zoom} />
        <section class="outline">
          {search && (
            <div class="search-info">
              {search.matches.size ? `${search.matches.size} 件` : '見つかりません'}
              <button class="mini" onClick={() => ctl.setQuery('')}>
                検索をクリア
              </button>
            </div>
          )}
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
      </main>
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
      <button class="mini" title="元に戻す (⌘/Ctrl+Z)" disabled={!ctl.history.canUndo} onMouseDown={keepFocus} onClick={() => ctl.undo()}>
        ↶
      </button>
      <button class="mini" title="やり直す (⌘/Ctrl+Shift+Z)" disabled={!ctl.history.canRedo} onMouseDown={keepFocus} onClick={() => ctl.redo()}>
        ↷
      </button>
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
  ['Alt+A', '属性を追加'],
  ['Alt+D', 'データを追加'],
  ['Esc / ⌘+Enter', 'データ編集を終了'],
  ['⌘/Ctrl+Shift+Backspace', '行を削除（子も含む）'],
  ['● をドラッグ', '行を移動（Esc でキャンセル）'],
  ['⌘/Ctrl+Z', '元に戻す'],
  ['⌘/Ctrl+Shift+Z / Ctrl+Y', 'やり直す'],
  ['⌘/Ctrl+F', '検索（Esc でクリア、is:done で完了のみ）'],
];

function HelpMenu() {
  return (
    <details class="help">
      <summary>ショートカット</summary>
      <dl>
        {SHORTCUTS.map(([k, v]) => [<dt key={k}>{k}</dt>, <dd key={k + ':d'}>{v}</dd>])}
      </dl>
    </details>
  );
}

// ================================================================ outline

function ZoomHeader({ node }: { node: OutlineNode }) {
  const ctl = useCtl();
  const isRoot = node.id === ctl.store.rootId;
  return (
    <section class="zoom-header">
      {isRoot ? <h1 class="title-static">Home</h1> : <NodeText node={node} title />}
      <Meta node={node} />
      <Actions id={node.id} class="header-actions" />
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

  let cls = 'node';
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
          title="クリックでズームイン / ドラッグで移動"
          draggable={false}
          onPointerDown={(e) => startBulletDrag(e, id, ctl)}
        >
          <span class="dot" />
        </a>
        <NodeText node={n} />
        <Actions id={id} class="row-actions" />
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

function NodeText({ node, title }: { node: OutlineNode; title?: boolean }) {
  const ctl = useCtl();
  if (!title && ctl.activeText !== node.id) return <RowView node={node} />;
  return (
    <AutoTextarea
      class={'text' + (title ? ' title' : '')}
      placeholder={title ? '無題' : undefined}
      data-id={node.id}
      data-fk={'text:' + node.id}
      value={node.text}
      onInput={(e) => {
        ctl.store.setText(node.id, e.currentTarget.value);
        ctl.commit(undefined, 'text:' + node.id);
      }}
      onKeyDown={(e) => !imeActive(e) && ctl.onTextKeydown(e, e.currentTarget)}
      onPaste={(e) => ctl.onTextPaste(e, e.currentTarget)}
      onBlur={(e) => {
        const ta = e.currentTarget;
        setTimeout(() => document.activeElement !== ta && ctl.deactivate(node.id), 0);
      }}
    />
  );
}

/** A row's text shown with inline formatting; clicking it switches to the editor. */
function RowView({ node }: { node: OutlineNode }) {
  const ctl = useCtl();
  const segs = useMemo(() => parseInline(node.text), [node.text]);

  const onClick = (e: MouseEvent) => {
    const target = e.target as Element;
    if (target.closest('a')) return; // let links open
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
    ctl.focus(fText(node.id, pos));
  };

  return (
    <div class="text text-view" data-id={node.id} onClick={onClick}>
      {segs.map((seg) => (
        <SegView key={seg.start} seg={seg} />
      ))}
    </div>
  );
}

function SegView({ seg }: { seg: Seg }) {
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
      return <span class="tag" title="このタグで検索">{pieces}</span>;
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

function Actions({ id, class: cls }: { id: string; class: string }) {
  const ctl = useCtl();
  return (
    <span class={cls}>
      {id !== ctl.zoomId && (
        <button class="mini" title="完了 / 未完了 (⌘/Ctrl+Enter)" onMouseDown={keepFocus} onClick={() => ctl.toggleComplete(id)}>
          ✓
        </button>
      )}
      <button class="mini" title="属性を追加 (Alt+A)" onMouseDown={keepFocus} onClick={() => ctl.addAttribute(id)}>
        + 属性
      </button>
      <button class="mini" title="データを追加 (Alt+D)" onMouseDown={keepFocus} onClick={() => ctl.addData(id)}>
        + データ
      </button>
    </span>
  );
}

// ================================================================ attributes & data

function Meta({ node }: { node: OutlineNode }) {
  if (!node.attributes.length && !node.data.length) return null;
  return (
    <div class="meta">
      {node.attributes.length > 0 && (
        <div class="attrs">
          {node.attributes.map((a) => (
            <AttributeChip key={a.id} nodeId={node.id} attr={a} />
          ))}
        </div>
      )}
      {node.data.map((d) => (
        <DataBlockView key={d.id} nodeId={node.id} data={d} />
      ))}
    </div>
  );
}

function AttributeChip({ nodeId, attr }: { nodeId: string; attr: Attribute }) {
  const ctl = useCtl();
  const field = (name: 'key' | 'value') => (
    <input
      class={`attr-input attr-${name}`}
      placeholder={name}
      spellcheck={false}
      size={Math.max(attr[name].length, name.length, 2)}
      data-id={nodeId}
      data-attr={attr.id}
      data-field={name}
      data-fk={`${name}:${nodeId}:${attr.id}`}
      value={attr[name]}
      onInput={(e) => {
        ctl.store.updateAttribute(nodeId, attr.id, { [name]: e.currentTarget.value });
        ctl.commit(undefined, `${name}:${attr.id}`);
      }}
      onKeyDown={(e) => !imeActive(e) && ctl.onAttrKeydown(e, e.currentTarget)}
    />
  );
  return (
    <span class="attr">
      {field('key')}
      <span class="attr-sep">:</span>
      {field('value')}
      <button
        class="attr-del"
        tabIndex={-1}
        title="属性を削除"
        onMouseDown={keepFocus}
        onClick={() => {
          ctl.store.removeAttribute(nodeId, attr.id);
          ctl.commit();
        }}
      >
        ×
      </button>
    </span>
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
