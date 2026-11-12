import { memo } from 'preact/compat';
import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'preact/hooks';
import { Controller } from './controller';
import { applyFocus, fKey, fText } from './focus';
import { IS_MAC } from './keys';
import { hasFormat, listFormats, getFormat, placeholderOf, renderFormat } from './formats';
import { t } from './i18n';
import { parseInline } from './inline';
import { findBacklinks, nodeLabel } from './links';
import { DEP_KEY } from './deps';
import { startBulletDrag, startRowSelect } from './drag';
import { Ctx, keepFocus, useCtl } from './context';
import { DiagramView } from './DiagramView';
import { GanttView } from './GanttView';
import { SlidesView } from './SlidesView';
import { DataView } from './DataView';
import { DocsView } from './DocsView';
import { SegView } from './InlineText';
import { formatDate, parseDate, today } from './calendar';
import type { OutlineNode } from './model';
import { AutoTextarea, hasFocus, imeActive, RowEditor } from './RowEditor';
import { TopBar, ViewSwitch, ViewToggles } from './TopBar';
import { ItemMenuView, JumpBox, LinkPickerMenu, SuggestMenu, ToastView } from './Popups';
import { DependencyPanel, DepBadge, SchedLabel } from './Badges';

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
      // Our history replaces the browser's per-field undo everywhere. Ctrl+Y redoes outside macOS,
      // where it puts back what Ctrl+K deleted.
      if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.code === 'KeyZ' || (e.code === 'KeyY' && e.ctrlKey && !IS_MAC))) {
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
  const changedRows = ctl.takeChangedRows();
  // Rows show their dates, search matches and the task filter: with any of those, every row is drawn again.
  const changed = ctl.refreshSchedule() || search || ctl.taskRows ? null : changedRows;
  ctl.selected = new Set(ctl.selectedRows());
  if (ctl.selection && !ctl.selected.size) ctl.selection = null;
  if (ctl.schedule.needsJp) ctl.loadJpHolidays();
  const rows = ctl.shownChildren(zoomId);
  document.title = (zoomId === store.rootId ? 'Home' : zoom.text || t('無題', 'Untitled')) + ' – Yamoli';

  if (ctl.docs) {
    document.title = t('使い方', 'Guide') + ' – Yamoli';
    return (
      <Ctx.Provider value={ctl}>
        <TopBar />
        <main class="page wide">
          <DocsView />
        </main>
        {ctl.jumping && <JumpBox />}
        <ToastView />
      </Ctx.Provider>
    );
  }

  return (
    <Ctx.Provider value={ctl}>
      <TopBar />
      <main
        class={
          'page' +
          (ctl.view === 'gantt' ? ' full' : ctl.view === 'diagram' || ctl.view === 'slides' ? ' wide' : '') +
          (ctl.view === 'slides' ? ' slides-page' : '')
        }
      >
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
                <NodeItem key={id} id={id} changed={changed} />
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

// ================================================================ outline

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

type RowProps = { id: string; changed: ReadonlySet<string> | null };

/** A row and the rows under it, skipped when nothing in them has changed (Controller.takeChangedRows). */
const NodeItem = memo(NodeRow, (_: RowProps, next: RowProps) => next.changed !== null && !next.changed.has(next.id));

function NodeRow({ id, changed }: RowProps) {
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
              <path
                d="M2.5 4.5 6 8l3.5-3.5"
                fill="none"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          )}
        </button>
        <a
          class="bullet"
          href={ctl.hashFor(id)}
          tabIndex={-1}
          title={t(
            'クリックでズームイン / ドラッグで移動 / 右クリックでメニュー',
            'Click to zoom in / drag to move / right-click for the menu'
          )}
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
            <NodeItem key={c} id={c} changed={changed} />
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
  const summary = fields.map((f) => (store.node(f).children.length ? `${store.node(f).key} …` : nodeLabel(store, f))).join(' · ');
  return (
    <button
      class={'fields-summary' + (open ? ' open' : '')}
      tabIndex={-1}
      title={open ? t('属性を畳む', 'Fold the fields') : summary}
      onMouseDown={keepFocus}
      onClick={() => ctl.toggleFieldsOpen(id)}
    >
      <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true">
        <path
          d="M4.5 2.5 8 6l-3.5 3.5"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      {!open && <span>{summary}</span>}
    </button>
  );
}

const DATE_KEYS = new Set(['start', 'end', 'due']);

/** A calendar button on date fields (`start`, `end`, `due`, or any `YYYY-MM-DD`), opening the browser's date picker. */
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
          <button
            class="mini"
            title={t('やることとして登録 (⌘/Ctrl+L)', 'Mark as something to do (⌘/Ctrl+L)')}
            onMouseDown={keepFocus}
            onClick={() => ctl.toggleTask([id])}
          >
            {t('タスク', 'Task')}
          </button>
        ) : (
          <button
            class="mini"
            title={
              ctl.store.node(id).completed
                ? t('未完了に戻す (⌘/Ctrl+Shift+Enter)', 'Reopen (⌘/Ctrl+Shift+Enter)')
                : t('完了にする (⌘/Ctrl+Shift+Enter)', 'Complete (⌘/Ctrl+Shift+Enter)')
            }
            onMouseDown={keepFocus}
            onClick={() => ctl.toggleComplete(id)}
          >
            {ctl.store.node(id).completed ? '↺' : '✓'}
          </button>
        ))}
      <button
        class="mini"
        title={t('属性を追加 (Alt+A)', 'Add a field (Alt+A)')}
        onMouseDown={keepFocus}
        onClick={() => ctl.addAttribute(id)}
      >
        {t('+ 属性', '+ Field')}
      </button>
      <button
        class="mini"
        title={t(
          'ブロック（Markdown・CSV・コードなど複数行の値）を追加 (Alt+D)',
          'Add a block: a multi-line value such as Markdown, CSV or code (Alt+D)'
        )}
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
        {!hasFormat(node.format!) && (
          <option value={node.format!}>
            {node.format} {t('(未定義)', '(unknown)')}
          </option>
        )}
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
      <div class="backlinks-title">
        {t('被リンク', 'Linked from')} {links.length}
      </div>
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

// ================================================================ helpers

function caretFromPoint(x: number, y: number): { node: Node; offset: number } | null {
  if (document.caretPositionFromPoint) {
    const p = document.caretPositionFromPoint(x, y);
    return p && { node: p.offsetNode, offset: p.offset };
  }
  const r = document.caretRangeFromPoint?.(x, y); // Safari < 18.4
  return r && { node: r.startContainer, offset: r.startOffset };
}
