const COMBINING_MARKS_RE = /\p{M}/gu;
// Strip zero-width chars: ZWSP (U+200B), ZWNJ (U+200C), ZWJ (U+200D), BOM (U+FEFF)
const ZERO_WIDTH_RE = new RegExp('[\\u200B-\\u200D\\uFEFF]', 'g');
const WHITESPACE_RE = /\s+/g;

export function normalize(text: string, caseSensitive = false): string {
  let s = text.normalize('NFKD');
  s = s.replace(COMBINING_MARKS_RE, '');
  s = s.replace(ZERO_WIDTH_RE, '');
  s = s.replace(WHITESPACE_RE, ' ').trim();
  if (!caseSensitive) s = s.toLowerCase();
  return s;
}
