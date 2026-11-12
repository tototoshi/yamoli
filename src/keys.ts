/** ⌘ or Ctrl: either counts as the modifier for shortcuts. */
export const isMod = (e: KeyboardEvent) => e.metaKey || e.ctrlKey;
export const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);

/** macOS's Emacs keys (Ctrl+P / N / B / F) as the arrow they stand for. */
const EMACS: Record<string, string> = { KeyP: 'ArrowUp', KeyN: 'ArrowDown', KeyB: 'ArrowLeft', KeyF: 'ArrowRight' };
export const arrowOf = (e: KeyboardEvent) => (IS_MAC && e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && EMACS[e.code]) || e.key;
