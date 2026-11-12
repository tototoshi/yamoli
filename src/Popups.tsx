import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { arrowOf, captureFocus } from './controller';
import { t } from './i18n';
import { nodeLabel } from './links';
import { useCtl } from './context';
import { imeActive } from './RowEditor';

// ================================================================ link picker and completions

/** Candidate list for the `[[` link picker, positioned under its field. */
export function LinkPickerMenu() {
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
export function SuggestMenu() {
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
export function JumpBox() {
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

export function ItemMenuView() {
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

export function ToastView() {
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
