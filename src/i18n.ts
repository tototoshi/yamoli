/*
 * Japanese and English UI text. Strings are written in place as
 * t('日本語', 'English'); the language comes from the browser unless the
 * user picks one.
 */
export type Lang = 'ja' | 'en';

let current: Lang = 'ja';

export const lang = () => current;

export function setLang(l: Lang) {
  current = l;
  document.documentElement.lang = l;
}

/** The browser's language when it is Japanese, else English. */
export const browserLang = (): Lang => (navigator.language?.toLowerCase().startsWith('ja') ? 'ja' : 'en');

/** The string for the current language. */
export const t = (ja: string, en: string) => (current === 'en' ? en : ja);
