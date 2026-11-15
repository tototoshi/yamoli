/*
 * The colours a word can name, wherever one is written: a box's `color`, a
 * line's look, or a stretch of text (`[words]{red}`).
 */

const COLORS: Record<string, string> = {
  red: '#d9534f',
  orange: '#e8892c',
  yellow: '#c9a227',
  green: '#3a9a5b',
  blue: '#3b6fd8',
  purple: '#8a4fc8',
  gray: '#7d848e',
  grey: '#7d848e',
};

/** The colours offered to pick from, in order. */
export const COLOR_CHOICES = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray'];

/** The colour words, for a pattern to find them by. */
export const COLOR_WORDS = Object.keys(COLORS);

/** A colour word (`blue`) or `#hex` as the colour drawn; undefined for anything else. */
export const colorValue = (v: string | undefined) =>
  v ? (COLORS[v.toLowerCase()] ?? (/^#[0-9a-f]{3,8}$/i.test(v) ? v : undefined)) : undefined;
