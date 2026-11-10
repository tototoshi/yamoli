/*
 * Colouring YAML and JSON for reading: the text cut into pieces, each with
 * what it is. Joined back, the pieces are the text unchanged. Made for what
 * serialize.ts writes (and pretty-printed JSON), not every corner of YAML.
 */

export type TokenKind = 'key' | 'str' | 'num' | 'lit' | 'tag' | 'punct';
export interface Token {
  text: string;
  kind?: TokenKind;
}

const NUMBER = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

/** pretty-printed JSON in pieces: keys, strings, numbers, true / false / null. */
export function jsonTokens(json: string): Token[] {
  const out: Token[] = [];
  const re = /("(?:\\.|[^"\\])*")(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
  let at = 0;
  for (const m of json.matchAll(re)) {
    if (m.index > at) out.push({ text: json.slice(at, m.index) });
    if (m[1]) {
      out.push({ text: m[1], kind: m[2] ? 'key' : 'str' });
      if (m[2]) out.push({ text: m[2] });
    } else out.push({ text: m[0], kind: NUMBER.test(m[0]) ? 'num' : 'lit' });
    at = m.index + m[0].length;
  }
  if (at < json.length) out.push({ text: json.slice(at) });
  return out;
}

/** A scalar's kind as YAML reads it. */
function scalar(v: string): TokenKind {
  if (/^(?:true|false|null|~)$/.test(v)) return 'lit';
  return NUMBER.test(v) ? 'num' : 'str';
}

/** YAML in pieces: keys, `- ` and block markers, `!tags`, scalars; a block's lines are one string. */
export function yamlTokens(yaml: string): Token[] {
  const out: Token[] = [];
  const push = (text: string, kind?: TokenKind) => text && out.push(kind ? { text, kind } : { text });
  let blockAt = -1; // indentation of the line that opened a block scalar
  yaml.split('\n').forEach((line, i) => {
    if (i) push('\n');
    const indent = line.match(/^ */)![0].length;
    if (blockAt >= 0 && (!line.trim() || indent > blockAt)) return push(line, 'str');
    blockAt = -1;
    let rest = line;
    const take = (n: number, kind?: TokenKind) => {
      push(rest.slice(0, n), kind);
      rest = rest.slice(n);
    };
    take(indent);
    while (/^-(?= |$)/.test(rest)) {
      take(1, 'punct');
      take(rest.match(/^ */)![0].length);
    }
    const key = rest.match(/^("(?:\\.|[^"\\])*"|[^\s"#][^]*?)(?=:(?: |$))/);
    if (key) {
      take(key[1].length, 'key');
      take(1, 'punct');
      take(rest.match(/^ */)![0].length);
    }
    const tag = rest.match(/^!\S+/);
    if (tag) {
      take(tag[0].length, 'tag');
      take(rest.match(/^ */)![0].length);
    }
    if (/^[|>][-+]?$/.test(rest)) {
      blockAt = indent;
      return take(rest.length, 'punct');
    }
    if (/^(?:\[\]|\{\})$/.test(rest)) return take(rest.length, 'punct');
    if (rest) take(rest.length, /^"/.test(rest) ? 'str' : scalar(rest));
  });
  return out;
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Tokens as HTML, each coloured piece in a `j-` span. */
export const tokensHtml = (tokens: Token[]) =>
  tokens.map((t) => (t.kind ? `<span class="j-${t.kind}">${escapeHtml(t.text)}</span>` : escapeHtml(t.text))).join('');
