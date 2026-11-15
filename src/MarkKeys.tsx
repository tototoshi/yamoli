/*
 * Formatting shortcuts in a text field, the row editor's and the diagram
 * menu's alike: ⌘B bold, ⌘I italic, ⌘⇧X struck through, ⌘E code (Ctrl
 * outside macOS, where Ctrl+B and the like move the caret), each again to take
 * it away; ⌘⇧H a colour, picked from a bubble under the field (1–7, 0 for
 * none, or a click).
 */
import { useState } from 'preact/hooks';
import { COLOR_CHOICES, colorValue } from './colors';
import { t } from './i18n';
import { colorMark, toggleMark, type Edited, type MarkKey } from './inline';
import { IS_MAC } from './keys';
import { imeActive } from './RowEditor';

type Field = HTMLTextAreaElement | HTMLInputElement;

/** The mark a key puts on the selection, if it is one of the shortcuts. */
export function markKeyOf(e: KeyboardEvent): MarkKey | 'color' | null {
  if (!(IS_MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey) || e.altKey) return null;
  if (e.shiftKey) return e.code === 'KeyX' ? 'del' : e.code === 'KeyH' ? 'color' : null;
  return ({ KeyB: 'strong', KeyI: 'em', KeyE: 'code' } as Record<string, MarkKey>)[e.code] ?? null;
}

/**
 * The shortcuts for a field: onKeyDown (true when it took the key) and the
 * colour bubble to show beside the field, which apply writes the new text
 * and selection of.
 */
export function useMarkKeys(apply: (edited: Edited) => void) {
  const [picking, setPicking] = useState<{ field: Field; start: number; end: number } | null>(null);
  const pick = (color: string | null) => {
    if (!picking) return;
    setPicking(null);
    apply(colorMark(picking.field.value, picking.start, picking.end, color));
  };
  const onKeyDown = (e: KeyboardEvent): boolean => {
    if (imeActive(e)) return false;
    if (picking) {
      const n = '01234567'.indexOf(e.key);
      const plain = !e.metaKey && !e.ctrlKey && !e.altKey;
      if (plain && (n >= 0 || e.key === 'Escape')) {
        e.preventDefault();
        e.stopPropagation(); // Escape closes the bubble, not the menu it is in
        if (n >= 0) pick(n ? COLOR_CHOICES[n - 1] : null);
        else setPicking(null);
        return true;
      }
      setPicking(null);
    }
    const mark = markKeyOf(e);
    if (!mark) return false;
    e.preventDefault();
    const field = e.currentTarget as Field;
    const [start, end] = [field.selectionStart ?? 0, field.selectionEnd ?? 0];
    if (mark === 'color') setPicking({ field, start, end });
    else apply(toggleMark(field.value, start, end, mark));
    return true;
  };
  const bubble = picking && (
    <div class="link-bubble color-pick" role="group" aria-label={t('文字の色', 'Text colour')} onMouseDown={(e) => e.preventDefault()}>
      {[null, ...COLOR_CHOICES].map((c, i) => (
        <button
          key={c ?? ''}
          class="mini"
          title={`${c ?? t('色なし', 'No colour')} (${i})`}
          style={c ? { color: colorValue(c) } : undefined}
          onClick={() => pick(c)}
        >
          {c ? 'A' : '×'}
        </button>
      ))}
    </div>
  );
  return { onKeyDown, bubble, close: () => setPicking(null) };
}

/**
 * Put a field's text and selection as a shortcut left them, at once, so a key
 * pressed right after acts on them; drawn with the same text, the field keeps
 * them.
 */
export function reselect(field: Field | null, { text, start, end }: Edited) {
  if (!field) return;
  field.value = text;
  field.setSelectionRange(start, end);
}
