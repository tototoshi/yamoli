import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import type { Controller } from './controller';

export const Ctx = createContext<Controller>(null!);
export const useCtl = () => useContext(Ctx);
