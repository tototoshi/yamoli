/*
 * The editor of a row's text: a textarea laid over a copy of its text with
 * the inline markup styled (markup characters dimmed, bold heavier, links
 * coloured). The copy has to line up with the textarea's own, invisible text,
 * so no style may change the width of a character: bold is a stroke, not a
 * heavier font, and code gets a background but no padding.
 *
 * With the caret on a link, a bubble shows where it goes; ⌘K (Ctrl+K outside
 * macOS, where Ctrl+K deletes to the end of the line) edits or adds a link, and pasting a URL over selected text links it.
 */
import type { TextareaHTMLAttributes } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useCtl } from './context';
import { IS_MAC } from './controller';
import { t } from './i18n';
import { linkAt, markupSpans, type LinkAt } from './inline';
import { nodeLabel } from './links';
import type { OutlineNode } from './model';

export const imeActive = (e: KeyboardEvent) => e.isComposing || e.keyCode === 229;

/**
 * Whether the editor for key has focus (its textarea, or a control of its own
 * like the link form). Checked by key, not element: moving a row (Tab,
 * Alt+Shift+↑↓) re-creates its editor, and the old one's blur must not close
 * the new one.
 */
export function hasFocus(key: string): boolean {
  const a = document.activeElement as HTMLElement | null;
  return a?.dataset?.fk === key || a?.closest('[data-editor]')?.getAttribute('data-editor') === key;
}

// Keep focus in the text while clicking the bubble's buttons.
const keepFocus = (e: MouseEvent) => e.preventDefault();

/** A link being written: the source range it replaces, and its parts. */
interface LinkDraft {
  start: number;
  end: number;
  label: string;
  href: string;
}

export function RowEditor({ node, title }: { node: OutlineNode; title?: boolean }) {
  const ctl = useCtl();
  const key = 'text:' + node.id;
  const spans = useMemo(() => markupSpans(node.text), [node.text]);
  const [caret, setCaret] = useState<number | null>(null);
  const [draft, setDraft] = useState<LinkDraft | null>(null);
  const box = useRef<HTMLDivElement>(null);

  // Follow the caret however it moves (keys, clicks, focus placing it), for the link bubble.
  useEffect(() => {
    const onChange = () => {
      const ta = document.activeElement;
      if (!(ta instanceof HTMLTextAreaElement) || ta.dataset.fk !== key) return;
      setCaret(ta.selectionStart === ta.selectionEnd ? ta.selectionStart : null);
    };
    onChange();
    document.addEventListener('selectionchange', onChange);
    return () => document.removeEventListener('selectionchange', onChange);
  }, [key]);
  const link = caret !== null && !draft ? linkAt(node.text, caret) : null;

  /** Replace [start, end) of the text and put the caret after the new part. */
  const replace = (start: number, end: number, by: string) => {
    setDraft(null);
    ctl.replaceText(node.id, node.text.slice(0, start) + by + node.text.slice(end), start + by.length);
  };

  const editLink = (ta: HTMLTextAreaElement) => {
    const [s, e] = [ta.selectionStart, ta.selectionEnd];
    const at = s === e ? linkAt(node.text, s) : null;
    if (at?.kind === 'link') setDraft({ start: at.start, end: at.end, label: at.label, href: at.href });
    else if (at?.kind === 'url') setDraft({ start: at.start, end: at.end, label: '', href: at.href });
    else setDraft({ start: s, end: e, label: node.text.slice(s, e), href: '' });
  };

  const backToText = () => {
    setDraft(null);
    box.current?.querySelector('textarea')?.focus();
  };

  return (
    <div
      ref={box}
      class={'rich' + (title ? ' title' : '')}
      data-editor={key}
      onFocusOut={() => setTimeout(() => !hasFocus(key) && ctl.deactivate(key), 0)}
    >
      <div class={'text mirror' + (title ? ' title' : '')} aria-hidden="true">
        {spans.map((s, i) => (
          <span key={i} class={s.cls && 'm-' + s.cls}>
            {s.text}
          </span>
        ))}
        {'​' /* keeps a trailing empty line as tall as the textarea's */}
      </div>
      <AutoTextarea
        class={'text' + (title ? ' title' : '')}
        placeholder={title ? t('無題', 'Untitled') : undefined}
        data-id={node.id}
        data-fk={key}
        value={node.text}
        onInput={(e) => ctl.onTextInput(node.id, e.currentTarget)}
        onKeyDown={(e) => {
          if (imeActive(e)) return;
          // ⌘K on macOS, where Ctrl+K deletes to the end of the line; Ctrl+K elsewhere.
          if ((IS_MAC ? e.metaKey : e.ctrlKey) && !e.altKey && !e.shiftKey && e.code === 'KeyK') {
            e.preventDefault();
            return editLink(e.currentTarget);
          }
          ctl.onTextKeydown(e, e.currentTarget);
        }}
        onPaste={(e) => {
          const ta = e.currentTarget;
          const url = e.clipboardData?.getData('text').trim() ?? '';
          const sel = node.text.slice(ta.selectionStart, ta.selectionEnd);
          // A URL pasted over selected words links them.
          if (/^https?:\/\/\S+$/.test(url) && sel.trim() && !sel.includes('\n') && !linkAt(node.text, ta.selectionStart)) {
            e.preventDefault();
            return replace(ta.selectionStart, ta.selectionEnd, `[${sel}](${url})`);
          }
          ctl.onTextPaste(e, ta);
        }}
      />
      {link && <LinkBubble link={link} onEdit={() => editLink(box.current!.querySelector('textarea')!)} replace={replace} />}
      {draft && <LinkForm draft={draft} onDone={(by) => (by === null ? backToText() : replace(draft.start, draft.end, by))} />}
    </div>
  );
}

/** Where the link under the caret goes, with ways to open, edit or remove it. */
function LinkBubble({ link, onEdit, replace }: { link: LinkAt; onEdit: () => void; replace: (s: number, e: number, by: string) => void }) {
  const ctl = useCtl();
  if (link.kind === 'ref') {
    const target = ctl.store.get(link.refId);
    if (!target) return null;
    const label = nodeLabel(ctl.store, target.id);
    return (
      <div class="link-bubble" onMouseDown={keepFocus}>
        →{' '}
        <a href={ctl.hashFor(target.id)} title={t('この項目へ移動', 'Go to this item')}>
          {label}
        </a>
        <button
          class="mini"
          onClick={() => replace(link.start, link.end, label)}
          title={t('リンクをやめて文字だけ残す', 'Keep the words, drop the link')}
        >
          {t('解除', 'Unlink')}
        </button>
      </div>
    );
  }
  return (
    <div class="link-bubble" onMouseDown={keepFocus}>
      <a href={link.href} target="_blank" rel="noopener noreferrer" title={t('新しいタブで開く', 'Open in a new tab')}>
        {link.href}
      </a>
      <button class="mini" onClick={onEdit} title={IS_MAC ? '⌘K' : 'Ctrl+K'}>
        {t('編集', 'Edit')}
      </button>
      {link.kind === 'link' && (
        <button
          class="mini"
          onClick={() => replace(link.start, link.end, link.label)}
          title={t('リンクをやめて文字だけ残す', 'Keep the words, drop the link')}
        >
          {t('解除', 'Unlink')}
        </button>
      )}
    </div>
  );
}

/** Text and URL of a link. Enter applies, Esc goes back to the text unchanged. */
function LinkForm({ draft, onDone }: { draft: LinkDraft; onDone: (by: string | null) => void }) {
  const [label, setLabel] = useState(draft.label);
  const [href, setHref] = useState(draft.href);
  const urlInput = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => urlInput.current?.focus(), []);
  const apply = () => {
    let url = href.trim();
    if (url && !/^https?:\/\//.test(url)) url = 'https://' + url; // only http(s) links are recognized
    const words = label.trim();
    onDone(url ? (words ? `[${words}](${url})` : url) : words);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (imeActive(e)) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      apply();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onDone(null);
    }
  };
  return (
    <div class="link-bubble link-form">
      <label>
        {t('文字', 'Text')}
        <input value={label} onInput={(e) => setLabel(e.currentTarget.value)} onKeyDown={onKeyDown} />
      </label>
      <label>
        URL
        <input ref={urlInput} value={href} placeholder="https://" onInput={(e) => setHref(e.currentTarget.value)} onKeyDown={onKeyDown} />
      </label>
      <button class="mini" onMouseDown={keepFocus} onClick={apply}>
        {t('適用', 'Apply')}
      </button>
    </div>
  );
}

/** A textarea that grows to fit its content. */
export function AutoTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement> & Record<`data-${string}`, string>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const ta = ref.current!;
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 'px';
  });
  return <textarea ref={ref} rows={1} {...props} />;
}
