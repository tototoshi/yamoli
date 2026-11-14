/*
 * A box to type a value into in place (a name or date in the Gantt chart, a
 * box's name in the diagram): Enter or leaving it keeps what was typed,
 * Escape doesn't.
 */
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { imeActive } from './RowEditor';

/** A cell being typed in: Enter or leaving it keeps what was typed, Escape doesn't. */
export function CellInput({
  value,
  onDone,
  class: cls = 'gantt-input',
}: {
  value: string;
  onDone: (text: string | null) => void;
  class?: string;
}) {
  const [text, setText] = useState(value);
  const input = useRef<HTMLInputElement>(null);
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
  return (
    <input
      ref={input}
      class={cls}
      value={text}
      onInput={(e) => setText(e.currentTarget.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (imeActive(e)) return;
        if (e.key === 'Enter') finish(text);
        else if (e.key === 'Escape') finish(null);
      }}
      onBlur={() => finish(text)}
    />
  );
}
