const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
};

// String.fromCodePoint throws outside this range; stored text can hold anything.
function fromCodePointOr(code: number, fallback: string): string {
  return Number.isInteger(code) && code >= 0 && code <= 0x10ffff
    ? String.fromCodePoint(code)
    : fallback;
}

export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body.startsWith('#x')) {
      return fromCodePointOr(Number.parseInt(body.slice(2), 16), match);
    }
    if (body.startsWith('#')) {
      return fromCodePointOr(Number.parseInt(body.slice(1), 10), match);
    }
    const named = NAMED_ENTITIES[body];
    return named ?? match;
  });
}

export function stripHtmlToPlainText(html: string): string {
  const withoutTags = html.replace(/<[^>]*>/g, ' ');
  return decodeHtmlEntities(withoutTags).replace(/\s+/g, ' ').trim();
}

export function plainBodyForSearch(kind: string, rawBody: string): string {
  if (kind === 'task') {
    return rawBody;
  }
  return stripHtmlToPlainText(rawBody);
}

export function buildSearchExcerpt(plainText: string, needle: string, maxLen = 120): string {
  const lowerText = plainText.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  const idx = lowerText.indexOf(lowerNeedle);
  if (idx === -1) {
    const slice = plainText.slice(0, maxLen);
    return plainText.length > maxLen ? `${slice}…` : slice;
  }
  const half = Math.floor((maxLen - lowerNeedle.length) / 2);
  const start = Math.max(0, idx - half);
  const end = Math.min(plainText.length, idx + lowerNeedle.length + half);
  let excerpt = plainText.slice(start, end);
  if (start > 0) {
    excerpt = `…${excerpt}`;
  }
  if (end < plainText.length) {
    excerpt = `${excerpt}…`;
  }
  return excerpt;
}

export function fts5MatchLiteral(query: string): string {
  return `"${query.replaceAll('"', '""')}"`;
}

/**
 * The FTS5 MATCH expression for a user query. Document and note bodies are
 * stored as HTML, so `Tom & Jerry` sits in the index as `Tom &amp; Jerry`:
 * match the escaped spelling too whenever it differs.
 */
export function fts5MatchExpression(query: string): string {
  const escaped = query
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
  return escaped === query
    ? fts5MatchLiteral(query)
    : `${fts5MatchLiteral(query)} OR ${fts5MatchLiteral(escaped)}`;
}
