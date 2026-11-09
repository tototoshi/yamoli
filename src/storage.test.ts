// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { OutlineStore } from './model';
import { flush, save, saveState } from './storage';

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
