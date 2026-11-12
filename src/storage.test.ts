// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { OutlineStore } from './model';
import { flush, loadPrefs, save, saveState } from './storage';

afterEach(() => vi.restoreAllMocks());

test('a failed save to the browser shows, with no file to fall back on, and clears once saving works', () => {
  const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('full', 'QuotaExceededError');
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  save(OutlineStore.create());
  flush();
  expect(saveState().kind).toBe('error');

  setItem.mockRestore();
  save(OutlineStore.create());
  flush();
  expect(saveState().kind).toBe('local');
});

test('a Gantt day width saved before the narrower ones were added stays the same width', () => {
  localStorage.setItem('yamoli:prefs', JSON.stringify({ ganttScale: 1 }));
  expect(loadPrefs().ganttZoom).toBe(4); // 12px a day, then and now
});
