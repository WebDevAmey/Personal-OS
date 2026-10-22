// lib/integrations/text.ts
//
// Plain-text helpers for third-party content. Output of these functions is
// text, never markup: callers put it into model context or render it as a
// React text node (escaped). `htmlToText` is a single-pass scanner rather
// than a chain of regexes so that malformed markup (unterminated tags or
// comments, `>` inside quoted attributes, nested script tags) cannot leak
// script/style contents or tag fragments into the result.

export interface Truncated {
  text: string;
  truncated: boolean;
}

/**
 * Truncates to at most `max` UTF-16 units (including the trailing ellipsis)
 * without splitting a surrogate pair.
 */
export function truncateText(text: string, max: number): Truncated {
  if (text.length <= max) return { text, truncated: false };
  let end = Math.max(0, max - 1);
  const code = text.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  return { text: `${text.slice(0, end).trimEnd()}…`, truncated: true };
}

/** Truncates and returns only the string. */
export function clip(text: string | null | undefined, max: number): string {
  return truncateText(text ?? '', max).text;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ensp: ' ', emsp: ' ', thinsp: ' ',
  ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', sbquo: '‚', ldquo: '“', rdquo: '”', bdquo: '„',
  hellip: '…', bull: '•', middot: '·', copy: '©', reg: '®', trade: '™', deg: '°', euro: '€',
  pound: '£', yen: '¥', cent: '¢', sect: '§', para: '¶', times: '×', divide: '÷', laquo: '«',
  raquo: '»', iexcl: '¡', iquest: '¿', zwnj: '', zwj: '', shy: '',
};

/** Decodes HTML character references. Unknown references are left as-is. */
export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z][a-z0-9]{1,31});?/gi, (match, ref: string) => {
    if (ref[0] === '#') {
      const cp = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      if (!Number.isFinite(cp) || cp <= 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return '\uFFFD';
      return String.fromCodePoint(cp);
    }
    const named = NAMED_ENTITIES[ref.toLowerCase()];
    return named ?? match;
  });
}

// Elements whose *contents* are never text for a reader.
const SKIP_CONTENT = new Set(['script', 'style', 'head', 'title', 'noscript', 'template', 'svg', 'math', 'iframe', 'object', 'xml']);
// Elements that imply a line break around them.
const BLOCK = new Set([
  'br', 'p', 'div', 'li', 'ul', 'ol', 'tr', 'table', 'section', 'article', 'header', 'footer',
  'blockquote', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'dd', 'dt', 'dl', 'address', 'center',
]);

/**
 * Reads a tag starting at `html[start] === '<'`. Returns the tag name
 * (lower-cased, '' for non-element constructs), whether it is a closing tag,
 * and the index just after the tag. Honours quoted attribute values, so a
 * `>` inside quotes does not end the tag. An unterminated tag consumes the
 * rest of the input.
 */
function readTag(html: string, start: number): { name: string; closing: boolean; end: number } {
  let i = start + 1;
  let closing = false;
  if (html[i] === '/') { closing = true; i++; }
  const nameStart = i;
  while (i < html.length && /[A-Za-z0-9:-]/.test(html[i])) i++;
  const name = html.slice(nameStart, i).toLowerCase();
  let quote: string | null = null;
  while (i < html.length) {
    const ch = html[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '>') {
      return { name, closing, end: i + 1 };
    }
    i++;
  }
  return { name, closing, end: html.length };
}

/**
 * Converts HTML to readable plain text: drops all tags, comments,
 * doctype/processing instructions and the contents of script/style/head and
 * similar elements; turns block boundaries into newlines; decodes entities;
 * collapses whitespace.
 */
export function htmlToText(html: string): string {
  let out = '';
  let i = 0;
  const n = html.length;
  const lower = html.toLowerCase();
  while (i < n) {
    const ch = html[i];
    if (ch !== '<') {
      const next = html.indexOf('<', i);
      const end = next === -1 ? n : next;
      out += html.slice(i, end);
      i = end;
      continue;
    }
    // Comments: skip to `-->`, or to the end if unterminated.
    if (html.startsWith('<!--', i)) {
      const close = html.indexOf('-->', i + 4);
      i = close === -1 ? n : close + 3;
      continue;
    }
    // CDATA, doctype, processing instructions: skip.
    if (html[i + 1] === '!' || html[i + 1] === '?') {
      const close = html.indexOf('>', i + 2);
      i = close === -1 ? n : close + 1;
      continue;
    }
    // A `<` not followed by a tag-name start (or `/`) is literal text.
    if (!/[A-Za-z/]/.test(html[i + 1] ?? '')) {
      out += '<';
      i++;
      continue;
    }
    const tag = readTag(html, i);
    i = tag.end;
    if (!tag.closing && SKIP_CONTENT.has(tag.name)) {
      // Skip to the matching close tag (case-insensitive); unterminated
      // means the rest of the document is skipped.
      const closeAt = lower.indexOf(`</${tag.name}`, i);
      if (closeAt === -1) { i = n; continue; }
      i = readTag(html, closeAt).end;
      continue;
    }
    if (BLOCK.has(tag.name)) out += '\n';
    else if (tag.name === 'td' || tag.name === 'th') out += '\t';
    else if (tag.name === 'img') out += ' ';
  }
  return normaliseWhitespace(decodeHtmlEntities(out));
}

/** Collapses runs of spaces/tabs, trims lines and limits blank lines to one. */
export function normaliseWhitespace(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\f\v \u00a0]+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
