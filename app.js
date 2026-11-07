(function () {
  'use strict';

  const STORAGE_KEY = 'outliner:v1';
  const crumbsEl = document.getElementById('crumbs');
  const headerEl = document.getElementById('zoom-header');
  const outlineEl = document.getElementById('outline');

  let store = load();
  let zoomId = idFromHash();
  const editingData = new Set(); // ids of data blocks currently showing their editor
  let rendering = false;

  // ================================================================ persistence

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return OutlineStore.fromJSON(JSON.parse(raw));
    } catch (e) {
      console.warn('Failed to load outline, starting fresh', e);
    }
    return seed();
  }

  function seed() {
    const s = OutlineStore.create();
    const r = s.rootId;
    const welcome = s.addChild(r, -1, 'Outliner へようこそ');
    s.addChild(welcome.id, -1, 'Enter で新しい行、Tab / Shift+Tab でインデント');
    s.addChild(welcome.id, -1, '左の ● をクリックするとその項目にズームイン（パンくずでズームアウト）');
    s.addChild(welcome.id, -1, 'Alt+A で属性、Alt+D でデータを追加');

    const proj = s.addChild(r, -1, 'プロジェクト A');
    s.addAttribute(proj.id, 'status', '進行中');
    s.addAttribute(proj.id, 'due', '2026-12-01');
    const spec = s.addChild(proj.id, -1, '仕様');
    s.addData(
      spec.id,
      'markdown',
      '## 概要\n\nアウトラインの各行は **属性** と **データ** を持てます。\n\n- 属性: key / value のペア\n- データ: フォーマット付きの本文\n  - Markdown, JSON, CSV, Code, Text\n\n| 項目 | 状態 |\n| --- | :---: |\n| zoom | 済 |\n| attribute | 済 |'
    );
    const conf = s.addChild(proj.id, -1, '設定');
    s.addData(conf.id, 'json', '{"theme":"auto","fontSize":15,"tags":["outline","notes"],"beta":true}');
    const sales = s.addChild(proj.id, -1, '売上');
    s.addData(sales.id, 'csv', 'month,amount\n2026-09,120\n2026-10,135\n2026-11,150');

    const shop = s.addChild(r, -1, '買い物リスト');
    ['牛乳', '卵', 'パン'].forEach((t) => s.addChild(shop.id, -1, t));
    s.setCollapsed(shop.id, true);
    return s;
  }

  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 250);
  }
  function flush() {
    clearTimeout(saveTimer);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store.toJSON()));
    } catch (e) {
      console.error('Failed to save outline', e);
    }
  }
  window.addEventListener('beforeunload', flush);

  // ================================================================ zoom

  function idFromHash() {
    const m = location.hash.match(/^#\/(.+)$/);
    const id = m ? decodeURIComponent(m[1]) : store.rootId;
    return store.get(id) ? id : store.rootId;
  }

  const hashFor = (id) => (id === store.rootId ? '#/' : '#/' + encodeURIComponent(id));
  const zoomTo = (id) => {
    location.hash = hashFor(id);
  };

  window.addEventListener('hashchange', () => {
    const prev = zoomId;
    zoomId = idFromHash();
    editingData.clear();
    let focus = null;
    if (store.visible(zoomId).includes(prev)) {
      focus = fText(prev, 'end'); // zoomed out: land on the node we came from
    } else if (zoomId !== store.rootId) {
      focus = fText(zoomId, 'end');
    } else if (store.get(zoomId).children.length) {
      focus = fText(store.get(zoomId).children[0], 'end');
    }
    render(focus);
    window.scrollTo(0, 0);
  });

  // ================================================================ DOM helpers

  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'value') el.value = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
    return el;
  }

  function autosize(ta) {
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 'px';
  }

  function sizeInput(input) {
    input.size = Math.max(input.value.length, input.placeholder.length, 2);
  }

  // Focus is addressed by a stable key so it survives re-rendering.
  const fText = (id, start = 'end', end) => ({ key: 'text:' + id, start, end });

  function captureFocus() {
    const a = document.activeElement;
    if (!a || !a.dataset || !a.dataset.fk) return null;
    return { key: a.dataset.fk, start: a.selectionStart, end: a.selectionEnd };
  }

  function applyFocus(f) {
    if (!f) return;
    const el = document.querySelector(`[data-fk="${CSS.escape(f.key)}"]`);
    if (!el) return;
    el.focus();
    if (f.start == null || typeof el.setSelectionRange !== 'function') return;
    const len = el.value.length;
    const pos = (p) => (p === 'end' ? len : Math.min(p, len));
    const s = pos(f.start);
    el.setSelectionRange(s, f.end == null ? s : pos(f.end));
  }

  // ================================================================ rendering

  function render(focus) {
    const f = focus !== undefined ? focus : captureFocus();
    rendering = true;
    const zoom = store.get(zoomId);

    crumbsEl.replaceChildren(...renderCrumbs());
    headerEl.replaceChildren(...renderHeader(zoom).filter(Boolean));

    const list = h('ul', { class: 'children top' }, zoom.children.map(renderNode));
    outlineEl.replaceChildren(list);
    if (!zoom.children.length) {
      outlineEl.append(
        h('button', { class: 'add-first', onclick: () => commit(fText(store.addChild(zoomId).id, 0)) }, '+ 項目を追加')
      );
    }
    document.querySelectorAll('textarea.autosize').forEach(autosize);
    document.title = (zoomId === store.rootId ? 'Home' : zoom.text || '無題') + ' – Outliner';
    rendering = false;
    applyFocus(f);
  }

  function commit(focus) {
    save();
    render(focus);
  }

  function renderCrumbs() {
    if (zoomId === store.rootId) return [];
    const path = store.path(zoomId).slice(0, -1);
    return path.map((id) =>
      h('a', { href: hashFor(id), class: 'crumb' }, id === store.rootId ? 'Home' : store.get(id).text || '無題')
    );
  }

  function renderHeader(zoom) {
    const isRoot = zoom.id === store.rootId;
    const title = isRoot
      ? h('h1', { class: 'title-static' }, 'Home')
      : h('textarea', {
          class: 'text title autosize',
          rows: 1,
          placeholder: '無題',
          'data-id': zoom.id,
          'data-fk': 'text:' + zoom.id,
          value: zoom.text,
        });
    return [title, renderMeta(zoom), renderActions(zoom.id, 'header-actions')];
  }

  function renderActions(id, cls) {
    return h(
      'span',
      { class: cls },
      h('button', { class: 'mini nofocus', title: '属性を追加 (Alt+A)', onclick: () => addAttribute(id) }, '+ 属性'),
      h('button', { class: 'mini nofocus', title: 'データを追加 (Alt+D)', onclick: () => addData(id) }, '+ データ')
    );
  }

  function renderNode(id) {
    const n = store.get(id);
    const hasKids = n.children.length > 0;
    const li = h('li', { class: 'node' + (hasKids && n.collapsed ? ' collapsed' : ''), 'data-id': id });

    li.append(
      h(
        'div',
        { class: 'row' },
        h(
          'button',
          {
            class: 'toggle nofocus' + (hasKids ? '' : ' empty'),
            tabindex: -1,
            title: n.collapsed ? '展開' : '折りたたむ',
            onclick: () => hasKids && store.setCollapsed(id, !n.collapsed) && commit(),
          },
          hasKids ? '▾' : ''
        ),
        h('a', { class: 'bullet', href: hashFor(id), tabindex: -1, title: 'ズームイン' }, h('span', { class: 'dot' })),
        h('textarea', {
          class: 'text autosize',
          rows: 1,
          'data-id': id,
          'data-fk': 'text:' + id,
          value: n.text,
        }),
        renderActions(id, 'row-actions')
      )
    );

    const meta = renderMeta(n);
    if (meta) li.append(meta);
    if (hasKids && !n.collapsed) li.append(h('ul', { class: 'children' }, n.children.map(renderNode)));
    return li;
  }

  function renderMeta(n) {
    if (!n.attributes.length && !n.data.length) return null;
    return h(
      'div',
      { class: 'meta' },
      n.attributes.length ? h('div', { class: 'attrs' }, n.attributes.map((a) => renderAttribute(n.id, a))) : null,
      n.data.map((d) => renderDataBlock(n.id, d))
    );
  }

  function renderAttribute(nodeId, a) {
    const input = (cls, field, placeholder) => {
      const el = h('input', {
        class: cls,
        placeholder,
        spellcheck: 'false',
        'data-id': nodeId,
        'data-attr': a.id,
        'data-field': field,
        'data-fk': `${field}:${nodeId}:${a.id}`,
        value: a[field],
      });
      sizeInput(el);
      return el;
    };
    return h(
      'span',
      { class: 'attr' },
      input('attr-input attr-key', 'key', 'key'),
      h('span', { class: 'attr-sep' }, ':'),
      input('attr-input attr-value', 'value', 'value'),
      h(
        'button',
        {
          class: 'attr-del nofocus',
          tabindex: -1,
          title: '属性を削除',
          onclick: () => {
            store.removeAttribute(nodeId, a.id);
            commit();
          },
        },
        '×'
      )
    );
  }

  function renderDataBlock(nodeId, d) {
    const editing = editingData.has(d.id);
    const options = Formats.list().map((f) => h('option', { value: f.name, selected: f.name === d.format }, f.label));
    if (!Formats.has(d.format)) options.push(h('option', { value: d.format, selected: true }, d.format + ' (未定義)'));

    const head = h(
      'div',
      { class: 'data-head' },
      h(
        'button',
        {
          class: 'data-fold nofocus',
          tabindex: -1,
          title: d.collapsed ? '展開' : '折りたたむ',
          onclick: () => {
            store.updateData(nodeId, d.id, { collapsed: !d.collapsed });
            save();
            refreshDataBlock(nodeId, d.id);
          },
        },
        d.collapsed ? '▸' : '▾'
      ),
      h('select', { class: 'data-format', 'data-id': nodeId, 'data-data': d.id, title: 'フォーマット' }, options),
      d.collapsed ? h('span', { class: 'data-preview' }, d.content.split('\n')[0].slice(0, 80)) : null,
      h('span', { class: 'spacer' }),
      h(
        'button',
        { class: 'mini nofocus', onclick: () => (editing ? stopEditing(nodeId, d.id, true) : startEditing(nodeId, d.id)) },
        editing ? '完了' : '編集'
      ),
      h(
        'button',
        {
          class: 'mini danger nofocus',
          onclick: () => {
            store.removeData(nodeId, d.id);
            editingData.delete(d.id);
            commit(fText(nodeId));
          },
        },
        '削除'
      )
    );

    let body = null;
    if (!d.collapsed) {
      body = editing
        ? h('textarea', {
            class: 'data-editor autosize',
            spellcheck: 'false',
            placeholder: Formats.get(d.format).placeholder,
            'data-id': nodeId,
            'data-data': d.id,
            'data-fk': `data:${d.id}`,
            value: d.content,
          })
        : h('div', {
            class: 'data-view',
            title: 'クリックして編集',
            html: Formats.render(d.format, d.content),
            onclick: (e) => {
              if (!e.target.closest('a')) startEditing(nodeId, d.id);
            },
          });
    }
    return h(
      'div',
      { class: 'data' + (editing ? ' editing' : ''), 'data-data': d.id, 'data-format': d.format },
      head,
      body
    );
  }

  /** Re-render one data block in place, so the rest of the outline (and pending clicks) are untouched. */
  function refreshDataBlock(nodeId, dataId, focus) {
    const old = document.querySelector(`.data[data-data="${CSS.escape(dataId)}"]`);
    const d = store.getData(nodeId, dataId);
    if (!old || !d) return render(focus);
    const fresh = renderDataBlock(nodeId, d);
    old.replaceWith(fresh);
    fresh.querySelectorAll('textarea.autosize').forEach(autosize);
    if (focus) applyFocus(focus);
  }

  function startEditing(nodeId, dataId) {
    const d = store.getData(nodeId, dataId);
    if (d.collapsed) store.updateData(nodeId, dataId, { collapsed: false });
    editingData.add(dataId);
    refreshDataBlock(nodeId, dataId, { key: 'data:' + dataId, start: 'end' });
  }

  function stopEditing(nodeId, dataId, refocusNode) {
    if (!editingData.delete(dataId)) return;
    refreshDataBlock(nodeId, dataId, refocusNode ? fText(nodeId) : null);
  }

  // ================================================================ actions

  function addAttribute(id) {
    const a = store.addAttribute(id);
    commit({ key: `key:${id}:${a.id}`, start: 0 });
  }

  function addData(id, format = 'markdown') {
    const d = store.addData(id, format);
    editingData.add(d.id);
    commit({ key: 'data:' + d.id, start: 0 });
  }

  function zoomOut() {
    if (zoomId !== store.rootId) zoomTo(store.parentOf(zoomId));
  }

  const isMod = (e) => e.metaKey || e.ctrlKey;

  function onTextKeydown(e, ta) {
    const id = ta.dataset.id;
    const n = store.get(id);
    const isTitle = id === zoomId;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const vis = store.visible(zoomId);
    const idx = vis.indexOf(id);

    // ---- structure
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !isMod(e)) {
      e.preventDefault();
      if (isTitle) return commit(fText(store.addChild(id, 0).id, 0));
      const before = ta.value.slice(0, start);
      const after = ta.value.slice(end);
      if (start === 0 && end === 0 && after) {
        store.addSiblingBefore(id);
        return commit(fText(id, 0));
      }
      store.setText(id, before);
      const next = n.children.length && !n.collapsed ? store.addChild(id, 0, after) : store.addSiblingAfter(id, after);
      return commit(fText(next.id, 0));
    }
    if (e.key === 'Tab' && !isMod(e) && !e.altKey) {
      e.preventDefault();
      if (isTitle) return;
      const ok = e.shiftKey ? store.outdent(id, zoomId) : store.indent(id);
      if (ok) commit(fText(id, start, end));
      return;
    }
    if (e.key === 'Backspace' && isMod(e) && e.shiftKey) {
      e.preventDefault();
      if (isTitle) return;
      store.remove(id);
      return commit(vis[idx - 1] ? fText(vis[idx - 1]) : zoomId !== store.rootId ? fText(zoomId) : null);
    }
    if (e.key === 'Backspace' && start === 0 && end === 0 && !isTitle && !n.children.length) {
      const prev = vis[idx - 1];
      const hasMeta = n.attributes.length || n.data.length;
      if (!ta.value && !hasMeta) {
        e.preventDefault();
        store.remove(id);
        return commit(prev ? fText(prev) : zoomId !== store.rootId ? fText(zoomId) : null);
      }
      if (prev && !hasMeta) {
        e.preventDefault();
        const pos = store.get(prev).text.length;
        store.mergeInto(id, prev);
        return commit(fText(prev, pos));
      }
      return;
    }

    // ---- move / collapse
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && e.shiftKey && (e.altKey || isMod(e))) {
      e.preventDefault();
      if (!isTitle && store.move(id, e.key === 'ArrowUp' ? -1 : 1)) commit(fText(id, start, end));
      return;
    }
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && isMod(e) && !e.altKey) {
      e.preventDefault();
      if (!isTitle && store.setCollapsed(id, e.key === 'ArrowUp')) commit(fText(id, start, end));
      return;
    }
    if (e.key === 'Enter' && isMod(e)) {
      e.preventDefault();
      if (!isTitle && store.setCollapsed(id, !n.collapsed)) commit(fText(id, start, end));
      return;
    }

    // ---- zoom
    if ((e.key === 'ArrowRight' && e.altKey) || (e.key === '.' && isMod(e))) {
      e.preventDefault();
      if (!isTitle) zoomTo(id);
      return;
    }
    if ((e.key === 'ArrowLeft' && e.altKey) || (e.key === ',' && isMod(e))) {
      e.preventDefault();
      zoomOut();
      return;
    }

    // ---- attributes / data (e.code so macOS Option doesn't remap the key)
    if (e.altKey && !isMod(e) && e.code === 'KeyA') {
      e.preventDefault();
      return addAttribute(id);
    }
    if (e.altKey && !isMod(e) && e.code === 'KeyD') {
      e.preventDefault();
      return addData(id);
    }

    // ---- cursor movement between rows
    if (e.key === 'ArrowUp' && !e.shiftKey && !e.altKey && !isMod(e)) {
      if (ta.value.lastIndexOf('\n', start - 1) !== -1) return; // still lines above in this row
      const target = idx > 0 ? vis[idx - 1] : !isTitle && zoomId !== store.rootId ? zoomId : null;
      if (target) {
        e.preventDefault();
        applyFocus(fText(target, start));
      }
      return;
    }
    if (e.key === 'ArrowDown' && !e.shiftKey && !e.altKey && !isMod(e)) {
      if (ta.value.indexOf('\n', end) !== -1) return;
      const target = isTitle ? vis[0] : vis[idx + 1];
      if (target) {
        e.preventDefault();
        applyFocus(fText(target, start));
      }
    }
  }

  function onAttrKeydown(e, input) {
    const id = input.dataset.id;
    const attrId = input.dataset.attr;
    const field = input.dataset.field;
    if (e.key === 'Enter') {
      e.preventDefault();
      if (field === 'key') applyFocus({ key: `value:${id}:${attrId}`, start: 'end' });
      else applyFocus(fText(id));
    } else if (e.key === 'Escape') {
      e.preventDefault();
      applyFocus(fText(id));
    } else if (e.key === 'Backspace' && field === 'key' && !input.value) {
      const a = store.get(id).attributes.find((x) => x.id === attrId);
      if (a && !a.value) {
        e.preventDefault();
        store.removeAttribute(id, attrId);
        commit(fText(id));
      }
    }
  }

  function onDataKeydown(e, ta) {
    if (e.key === 'Escape' || (e.key === 'Enter' && isMod(e))) {
      e.preventDefault();
      stopEditing(ta.dataset.id, ta.dataset.data, true);
    } else if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      if (!document.execCommand('insertText', false, '  ')) {
        ta.setRangeText('  ', ta.selectionStart, ta.selectionEnd, 'end');
        ta.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
  }

  // Pasting multiple lines into a row creates one sibling per line.
  function onTextPaste(e, ta) {
    const text = (e.clipboardData || window.clipboardData).getData('text');
    if (!text.includes('\n')) return;
    const lines = text
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((l) => l.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '').trim())
      .filter(Boolean);
    if (lines.length < 2) return;
    e.preventDefault();
    const id = ta.dataset.id;
    const before = ta.value.slice(0, ta.selectionStart);
    const after = ta.value.slice(ta.selectionEnd);
    store.setText(id, before + lines[0]);
    let last = id;
    const isTitle = id === zoomId;
    lines.slice(1).forEach((l, i) => {
      last = isTitle ? store.addChild(id, i).id : store.addSiblingAfter(last, l).id;
      if (isTitle) store.setText(last, l);
    });
    const lastNode = store.get(last);
    const caret = lastNode.text.length;
    lastNode.text += after;
    commit(fText(last, caret));
  }

  // ================================================================ event wiring

  document.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return; // IME conversion in progress
    const t = e.target;
    if (t.classList.contains('text')) return onTextKeydown(e, t);
    if (t.classList.contains('attr-input')) return onAttrKeydown(e, t);
    if (t.classList.contains('data-editor')) return onDataKeydown(e, t);
    if (t === document.body && e.altKey && e.key === 'ArrowLeft') {
      e.preventDefault();
      zoomOut();
    }
  });

  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.classList.contains('text')) {
      store.setText(t.dataset.id, t.value);
      autosize(t);
      if (t.dataset.id === zoomId) document.title = (t.value || '無題') + ' – Outliner';
    } else if (t.classList.contains('attr-input')) {
      store.updateAttribute(t.dataset.id, t.dataset.attr, { [t.dataset.field]: t.value });
      sizeInput(t);
    } else if (t.classList.contains('data-editor')) {
      store.updateData(t.dataset.id, t.dataset.data, { content: t.value });
      autosize(t);
    } else return;
    save();
  });

  document.addEventListener('change', (e) => {
    const t = e.target;
    if (!t.classList.contains('data-format')) return;
    store.updateData(t.dataset.id, t.dataset.data, { format: t.value });
    save();
    refreshDataBlock(t.dataset.id, t.dataset.data);
  });

  document.addEventListener('paste', (e) => {
    if (e.target.classList && e.target.classList.contains('text')) onTextPaste(e, e.target);
  });

  // Leaving a data editor switches it back to its rendered view.
  document.addEventListener('focusout', (e) => {
    const t = e.target;
    if (rendering || !t.classList || !t.classList.contains('data-editor')) return;
    const { id, data } = t.dataset;
    setTimeout(() => {
      const a = document.activeElement;
      if (a && a.closest && a.closest(`.data[data-data="${CSS.escape(data)}"]`)) return;
      stopEditing(id, data, false);
    }, 0);
  });

  // Keep focus in the text while clicking toolbar-ish buttons.
  document.addEventListener('mousedown', (e) => {
    if (e.target.closest && e.target.closest('.nofocus')) e.preventDefault();
  });

  // ================================================================ toolbar

  document.getElementById('btn-export').addEventListener('click', () => {
    flush();
    const blob = new Blob([JSON.stringify(store.toJSON(), null, 2)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `outline-${new Date().toISOString().slice(0, 10)}.json` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  const fileInput = document.getElementById('file-import');
  document.getElementById('btn-import').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    try {
      const next = OutlineStore.fromJSON(JSON.parse(await file.text()));
      if (!confirm('現在のアウトラインを置き換えますか？')) return;
      store = next;
      editingData.clear();
      flush();
      if (!store.get(zoomId)) {
        zoomId = store.rootId;
        history.replaceState(null, '', hashFor(zoomId));
      }
      render(null);
    } catch (err) {
      alert('読み込みに失敗しました: ' + err.message);
    }
  });

  render(store.get(zoomId).children.length ? fText(store.get(zoomId).children[0]) : null);
})();
