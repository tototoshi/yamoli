/*
 * A box to type a value into in place (a name or date in the Gantt chart, a
 * box's name or description in the diagram): Enter or leaving it keeps what
 * was typed, Escape doesn't.
 */
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { imeActive } from './RowEditor';

/** A cell being typed in: Enter or leaving it keeps what was typed, Escape doesn't. With lines, Shift+Enter starts a new line. */
export function CellInput({
  value,
  onDone,
  class: cls = 'gantt-input',
  lines = false,
  placeholder,
}: {
  value: string;
  onDone: (text: string | null) => void;
  class?: string;
  lines?: boolean;
  placeholder?: string;
}) {
  const [text, setText] = useState(value);
  const input = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
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
  const Tag = lines ? 'textarea' : 'input';
  return (
    <Tag
      ref={input}
      class={cls}
      value={text}
      placeholder={placeholder}
      onInput={(e: Event) => setText((e.currentTarget as HTMLInputElement).value)}
      onClick={(e: MouseEvent) => e.stopPropagation()}
      onKeyDown={(e: KeyboardEvent) => {
        if (imeActive(e)) return;
        if (e.key === 'Enter' && !(lines && e.shiftKey)) (e.preventDefault(), finish(text));
        else if (e.key === 'Escape') finish(null);
      }}
      onBlur={() => finish(text)}
    />
  );
}
