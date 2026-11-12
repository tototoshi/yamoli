import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import type { Controller } from './controller';

export const Ctx = createContext<Controller>(null!);
export const useCtl = () => useContext(Ctx);

/** Keep focus in the text while clicking toolbar-ish buttons. */
export const keepFocus = (e: MouseEvent) => e.preventDefault();
