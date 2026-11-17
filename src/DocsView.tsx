/*
 * The usage guide (docs/guide.ja.txt, docs/guide.en.txt) in the interface's
 * language, opened from the ? menu at #/docs. It is an outline written out as
 * indented text, shown as the document view shows one (with its contents
 * at the side), only to be read; a button copies it into the outline.
 */
import { useMemo } from 'preact/hooks';
import guideEn from '../docs/guide.en.txt?raw';
import guideJa from '../docs/guide.ja.txt?raw';
import { useCtl } from './context';
import { buildDoc, docContents } from './doc';
import { DocView } from './DocView';
import { parseOutlineText, type TextRow } from './fields';
import { lang, t } from './i18n';
import { OutlineStore } from './model';

/** The guide's text in the interface's language. */
export const guideText = (l = lang()) => (l === 'en' ? guideEn : guideJa);

/** An outline of its own from indented text: its first row is the guide. */
export function guideOutline(src: string): { store: OutlineStore; rootId: string } {
  const store = OutlineStore.create();
  const add = (parent: string, r: TextRow): string => {
    const n = store.addChild(parent, -1, r.text);
    n.key = r.key;
    n.format = r.key !== null ? (r.format ?? null) : null;
    r.children.forEach((c) => add(n.id, c));
    return n.id;
  };
  const [rootId] = parseOutlineText(src).map((r) => add(store.rootId, r));
  return { store, rootId };
}

/** The guide's sections and the parts in them. */
export const guideHeadings = (store: OutlineStore, rootId: string) => docContents(store, buildDoc(store, rootId).parts);

export function DocsView() {
  const ctl = useCtl();
  const src = guideText();
  const { store, rootId } = useMemo(() => guideOutline(src), [src]);

  return (
    <DocView
      store={store}
      rootId={rootId}
      title={store.node(rootId).text}
      aside={
        <>
          <a href="#/" class="docs-back">
            ← {t('アウトラインに戻る', 'Back to the outline')}
          </a>
          <button
            class="mini docs-copy"
            title={t('このガイドをアウトラインの最後に足して開く', 'Add this guide at the end of the outline, and open it')}
            onClick={() => (location.hash = ctl.hashFor(ctl.addOutlineText(src), 'doc'))}
          >
            {t('アウトラインで開く', 'Open as an outline')}
          </button>
        </>
      }
    />
  );
}
