/*
 * The row editor laid over a line's text where it flows (a paragraph, a list
 * item, a slide's bullet), so nothing moves when typing starts.
 */
import type { RefObject } from 'preact';
import { useLayoutEffect } from 'preact/hooks';

/**
 * Lay the row editor in a paragraph or list item (line, a `.doc-p` or an li)
 * over its text: the copy showing the text stays inline as it was, among
 * other sentences or after a checkbox, and the (unseen) textarea over it
 * starts on its line, indented to where it starts, and wraps across the
 * line's width as it does. On a slide, which is scaled, the textarea is
 * placed in the slide's own pixels.
 */
export function useFlowEditor(ref: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const line = ref.current;
    const rich = line && [...line.querySelectorAll<HTMLElement>('.rich')].find((r) => r.parentElement?.closest('li, .doc-p') === line);
    const mirror = rich?.querySelector<HTMLElement>(':scope > .mirror');
    const ta = rich?.querySelector<HTMLTextAreaElement>(':scope > textarea');
    const parent = ta?.offsetParent as HTMLElement | null | undefined;
    if (!line || !mirror || !ta || !parent) return;
    const place = () => {
      const first = mirror.getClientRects()[0];
      if (!first) return;
      const box = line.getBoundingClientRect();
      const at = parent.getBoundingClientRect();
      const k = at.width / parent.offsetWidth || 1; // the slide's scale (1 in a page)
      const set = parseFloat(getComputedStyle(line).lineHeight); // NaN for `normal`: the text's own height
      const lineHeight = Number.isNaN(set) ? first.height : set * k;
      ta.style.top = (first.top - (lineHeight - first.height) / 2 - at.top) / k + 'px';
      ta.style.left = (box.left - at.left) / k + 'px';
      ta.style.width = line.clientWidth + 'px';
      ta.style.textIndent = (first.left - box.left) / k + 'px';
    };
    place();
    const watch = new ResizeObserver(place);
    watch.observe(line);
    return () => watch.disconnect();
  });
}
