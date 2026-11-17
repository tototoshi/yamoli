/*
 * The usage guide (docs/guide.ja.txt, docs/guide.en.txt) in the interface's
 * language, opened from the ? menu at #/docs. It is an outline written out as
 * indented text, shown as the document view shows one, only to be read; a
 * button copies it into the outline. A contents list at the side scrolls to
 * each section; the page's own hash stays #/docs, since the app routes on
 * the hash.
 */
import { useMemo } from 'preact/hooks';
import guideEn from '../docs/guide.en.txt?raw';
import guideJa from '../docs/guide.ja.txt?raw';
import { useCtl } from './context';
import { buildDoc } from './doc';
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

/** The guide's sections and the parts in them (its headings two levels deep), in order. */
export function guideHeadings(store: OutlineStore, rootId: string): { id: string; level: 2 | 3; text: string }[] {
  return buildDoc(store, rootId).parts.flatMap((p) =>
    p.kind === 'heading' && p.level < 4 ? [{ id: p.id, level: p.level as 2 | 3, text: store.node(p.id).text.replace(/[`*]/g, '') }] : []
  );
}

export function DocsView() {
  const ctl = useCtl();
  const src = guideText();
  const { store, rootId, toc } = useMemo(() => {
    const g = guideOutline(src);
    return { ...g, toc: guideHeadings(g.store, g.rootId) };
  }, [src]);

  return (
    <div class="docs">
      <nav class="docs-toc" aria-label={t('目次', 'Contents')}>
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
        {toc.map((h) => (
          <button
            key={h.id}
            class={'docs-toc-item level-' + h.level}
            onClick={() => document.querySelector(`[data-doc-id="${h.id}"]`)?.scrollIntoView({ behavior: 'smooth' })}
          >
            {h.text}
          </button>
        ))}
      </nav>
      <div class="docs-body">
        <h1>{store.node(rootId).text}</h1>
        <DocView store={store} rootId={rootId} />
      </div>
    </div>
  );
}
