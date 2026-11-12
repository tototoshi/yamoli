/** Focus is addressed by a stable data-fk key so it survives re-rendering. */
export interface Focus {
  key: string;
  start?: number | 'end';
  end?: number | 'end';
}

export const fKey = (id: string): Focus => ({ key: 'fkey:' + id, start: 'end' });

export const fText = (id: string, start: number | 'end' = 'end', end?: number | 'end'): Focus => ({
  key: 'text:' + id,
  start,
  end,
});

export function captureFocus(): Focus | null {
  const a = document.activeElement as HTMLTextAreaElement | HTMLInputElement | null;
  if (!a?.dataset?.fk) return null;
  return { key: a.dataset.fk, start: a.selectionStart ?? undefined, end: a.selectionEnd ?? undefined };
}

export function applyFocus(f: Focus | null | undefined) {
  if (!f) return;
  const el = document.querySelector<HTMLTextAreaElement | HTMLInputElement>(`[data-fk="${CSS.escape(f.key)}"]`);
  if (!el) return;
  el.focus();
  if (f.start == null || typeof el.setSelectionRange !== 'function') return;
  const len = el.value.length;
  const pos = (p: number | 'end') => (p === 'end' ? len : Math.min(p, len));
  const s = pos(f.start);
  el.setSelectionRange(s, f.end == null ? s : pos(f.end));
}
