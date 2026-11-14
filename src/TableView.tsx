/*
 * The zoomed item's rows as a table: one line per row under it, its text in
 * the first column and each of its fields (name: value) in a column of that
 * name. Cells edit the outline directly: typing in an empty cell adds the
 * field. Enter moves down a line (adding one at the end), Tab across.
 * Blocks and fields with rows inside are shown, not edited, here.
 */
import { useState } from 'preact/hooks';
import { useCtl } from './context';
import { t } from './i18n';
import { imeActive } from './RowEditor';
import type { OutlineStore } from './model';

/** The column holding each row's own text. */
const NAME = '';

/**
 * The fields (by name) used by any of the rows, keeping the order each row has
 * them in (a field one row has after another comes after it), else the order
 * they first appear in.
 */
export function tableColumns(store: OutlineStore, rows: string[]): string[] {
  const seen = new Map<string, string>(); // lower-cased name → name
  const before = new Map<string, Set<string>>(); // name → names some row has before it
  for (const r of rows) {
    const keys: string[] = [];
    for (const c of store.node(r).children) {
      const k = store.node(c).key?.trim();
      if (!k) continue;
      const low = k.toLowerCase();
      if (!seen.has(low)) (seen.set(low, k), before.set(low, new Set()));
      keys.forEach((p) => p !== low && before.get(low)!.add(p));
      keys.push(low);
    }
  }
  const out: string[] = [];
  const left = [...seen.keys()];
  while (left.length) {
    // The first one whose predecessors are all placed (or simply the first, should rows disagree).
    const i = Math.max(
      0,
      left.findIndex((k) => [...before.get(k)!].every((p) => !left.includes(p)))
    );
    out.push(seen.get(left.splice(i, 1)[0])!);
  }
  return out;
}

/** Set row's text (column NAME) or its field col, adding the field when it has none. */
export function setCell(store: OutlineStore, row: string, col: string, value: string) {
  if (col === NAME) store.setText(row, value);
  else store.setField(row, col, value);
}

/** Give every row a field named col (empty where it has none), so the column shows. */
export function addColumn(store: OutlineStore, rows: string[], col: string) {
  for (const r of rows) if (!store.field(r, col)) store.addField(r, col);
}

const cellKey = (row: string, col: string) => `cell:${row}:${col}`;

export function TableView() {
  const ctl = useCtl();
  const { store, zoomId } = ctl;
  const rows = ctl.shownChildren(zoomId).filter((c) => !store.isField(c));
  const cols = tableColumns(store, rows);
  const [newCol, setNewCol] = useState('');

  const edit = (row: string, col: string, value: string) => {
    setCell(store, row, col, value);
    ctl.commit(undefined, cellKey(row, col));
  };

  // Enter: the same column a line down (a new line after the last), Shift+Enter up.
  const onKeyDown = (e: KeyboardEvent, row: string, col: string) => {
    if (imeActive(e)) return;
    if (e.key === 'Escape') return (e.currentTarget as HTMLElement).blur();
    if (e.key !== 'Enter' || e.altKey || e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    const i = rows.indexOf(row) + (e.shiftKey ? -1 : 1);
    if (i < 0) return;
    if (i < rows.length) return ctl.focus({ key: cellKey(rows[i], col), start: 'end' });
    ctl.commit({ key: cellKey(store.addChild(zoomId).id, col) });
  };

  const addCol = () => {
    const name = newCol.trim();
    if (!name || name.includes(':')) return;
    setNewCol('');
    const target = rows.length ? rows : [store.addChild(zoomId).id];
    addColumn(store, target, name);
    ctl.commit({
      key: cellKey(
        target[0],
        tableColumns(store, target).find((c) => c.toLowerCase() === name.toLowerCase())!
      ),
    });
  };

  const cell = (row: string, col: string) => {
    const f = col === NAME ? store.node(row) : store.field(row, col);
    // A block or a field with rows inside: shown here, edited in the outline.
    if (f && col !== NAME && (f.format !== null || f.children.length)) {
      const summary = f.format ?? t(`${f.children.length} 件`, `${f.children.length} items`);
      return (
        <td class="table-fixed" title={t('アウトラインで編集', 'Edit in the outline')}>
          <a href={ctl.hashFor(row)}>{summary}</a>
        </td>
      );
    }
    return (
      <td class={f ? '' : 'table-empty'}>
        <input
          data-fk={cellKey(row, col)}
          value={f?.text ?? ''}
          aria-label={col === NAME ? t('名前', 'Name') : col}
          onInput={(e) => edit(row, col, e.currentTarget.value)}
          onKeyDown={(e) => onKeyDown(e, row, col)}
        />
      </td>
    );
  };

  return (
    <section class="table-view">
      <table>
        <thead>
          <tr>
            <th class="table-row-head" />
            <th>{t('名前', 'Name')}</th>
            {cols.map((c) => (
              <th key={c}>{c}</th>
            ))}
            <th class="table-add-col">
              <input
                value={newCol}
                placeholder={t('+ 列', '+ Column')}
                title={t('列の名前を入力して Enter', 'Type a column name and press Enter')}
                onInput={(e) => setNewCol(e.currentTarget.value)}
                onKeyDown={(e) => !imeActive(e) && e.key === 'Enter' && (e.preventDefault(), addCol())}
              />
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r} class={store.node(r).completed ? 'done' : ''}>
              <td class="table-row-head">
                <a href={ctl.hashFor(r)} class="bullet" title={t('ズームイン', 'Zoom in')}>
                  <span class="dot" />
                </a>
              </td>
              {cell(r, NAME)}
              {cols.map((c) => cell(r, c))}
              <td />
            </tr>
          ))}
        </tbody>
      </table>
      <button class="add-first" onClick={() => ctl.commit({ key: cellKey(store.addChild(zoomId).id, NAME) })}>
        {t('+ 行を追加', '+ Add a row')}
      </button>
    </section>
  );
}
