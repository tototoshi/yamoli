/*
 * Line icons for diagrams (`icon: server`), drawn on a 24×24 grid as stroked
 * paths. Generic shapes only; any other short value (an emoji) is shown as
 * text instead.
 */

const rect = (x: number, y: number, w: number, h: number, r = 2) =>
  `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${-(w - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${-r}v${-(h - 2 * r)}a${r} ${r} 0 0 1 ${r} ${-r}z`;
const circle = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;

const ICONS: Record<string, string> = {
  server: rect(3, 3, 18, 8) + rect(3, 13, 18, 8) + 'M7 7h.01M7 17h.01',
  database: 'M4 6a8 3 0 1 0 16 0a8 3 0 1 0 -16 0M4 6v12a8 3 0 0 0 16 0V6M4 12a8 3 0 0 0 16 0',
  storage: rect(2, 8, 20, 9) + 'M6 12.5h.01M10 12.5h.01',
  cloud: 'M7 19h10.5a4.5 4.5 0 0 0 .6-8.96A6.5 6.5 0 0 0 5.6 11.2 4 4 0 0 0 7 19z',
  globe: circle(12, 12, 9) + 'M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18',
  user: circle(12, 8, 4) + 'M4 21a8 8 0 0 1 16 0',
  users: circle(9, 8, 3.5) + 'M2 20a7 7 0 0 1 14 0M16 4.6a3.5 3.5 0 0 1 0 6.8M18 13.6A7 7 0 0 1 22 20',
  mobile: rect(7, 2, 10, 20) + 'M11 18h2',
  desktop: rect(3, 4, 18, 12) + 'M8 20h8M12 16v4',
  browser: rect(3, 4, 18, 16) + 'M3 9h18M6.5 6.5h.01M9.5 6.5h.01',
  code: 'M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16',
  function: 'M5 20l6-10M8 4c2.5 0 3.5 1.5 4.5 3.5L19 20',
  queue: rect(2, 6, 20, 12) + 'M8 6v12M14 6v12',
  bolt: 'M13 2L4 14h7l-1 8 9-12h-7z',
  lock: rect(5, 11, 14, 10) + 'M8 11V7a4 4 0 0 1 8 0v4',
  key: circle(8, 15, 4) + 'M11 12l9-9M17 6l3 3M14.5 8.5l2 2',
  shield: 'M12 2l8 3v6c0 5.5-3.5 9.5-8 11-4.5-1.5-8-5.5-8-11V5z',
  mail: rect(3, 5, 18, 14) + 'M3 7l9 6 9-6',
  bell: 'M6 16v-5a6 6 0 0 1 12 0v5l2 2H4zM10 21h4',
  chart: 'M3 20h18M6 16v-5M11 16V6M16 16v-8',
  gear: circle(12, 12, 3.5) + 'M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9L7 7M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1',
  container: 'M12 2l9 5v10l-9 5-9-5V7zM3 7l9 5 9-5M12 12v10',
  file: 'M6 2h8l6 6v14H6zM14 2v6h6',
  search: circle(11, 11, 7) + 'M16 16l5 5',
  cpu: rect(6, 6, 12, 12) + 'M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4',
};

/** Other names people reach for. */
const ALIASES: Record<string, string> = {
  db: 'database',
  disk: 'storage',
  internet: 'globe',
  web: 'browser',
  person: 'user',
  phone: 'mobile',
  pc: 'desktop',
  api: 'code',
  lambda: 'function',
  cache: 'bolt',
  security: 'shield',
  email: 'mail',
  notification: 'bell',
  metrics: 'chart',
  monitoring: 'chart',
  settings: 'gear',
  service: 'gear',
  docker: 'container',
  cube: 'container',
  document: 'file',
};

export const iconNames = () => Object.keys(ICONS);

/** What an `icon` value draws: a known icon's path, text (an emoji), or nothing. */
export function iconOf(value: string | undefined): { path: string } | { text: string } | undefined {
  const v = value?.trim();
  if (!v) return undefined;
  const name = v.toLowerCase();
  const path = ICONS[ALIASES[name] ?? name];
  if (path) return { path };
  return [...v].length <= 4 && !/^[\x20-\x7e]+$/.test(v) ? { text: v } : undefined;
}
