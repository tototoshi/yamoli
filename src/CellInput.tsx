/*
 * A box to type a value into in place (a name or date in the Gantt chart, a
 * box's name or an arrow's label in the diagram): Enter or leaving it keeps
 * what was typed, Escape doesn't. Marked, ⌘B and the like format it.
 */
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { reselect, useMarkKeys } from './MarkKeys';
import { imeActive } from './RowEditor';

/** A cell being typed in: Enter or leaving it keeps what was typed, Escape doesn't. */
export function CellInput({
  value,
  onDone,
  class: cls = 'gantt-input',
  placeholder,
  marked,
}: {
  value: string;
  onDone: (text: string | null) => void;
  class?: string;
  placeholder?: string;
  /** Takes the formatting shortcuts (MarkKeys). */
  marked?: boolean;
}) {
  const [text, setText] = useState(value);
  const input = useRef<HTMLInputElement>(null);
  const marks = useMarkKeys((ed) => (setText(ed.text), reselect(input.current, ed)));
  const done = useRef(false);
  const finish = (v: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(v);
  };
  useLayoutEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const field = (
    <input
      ref={input}
      class={cls}
      value={text}
      placeholder={placeholder}
      onInput={(e) => setText(e.currentTarget.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if ((marked && marks.onKeyDown(e)) || imeActive(e)) return;
        if (e.key === 'Enter') finish(text);
        else if (e.key === 'Escape') finish(null);
      }}
      // Not when the window itself loses focus (to a date picker, or another app): the box is still being typed in.
      onBlur={() => document.hasFocus() && finish(text)}
    />
  );
  if (!marked) return field;
  return (
    <div class="cell-marked">
      {field}
      {marks.bubble}
    </div>
  );
}
