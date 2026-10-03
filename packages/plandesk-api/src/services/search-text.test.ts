import { describe, expect, it } from 'vitest';
import {
  buildSearchExcerpt,
  decodeHtmlEntities,
  fts5MatchLiteral,
  stripHtmlToPlainText,
} from './search-text.js';

describe('search-text', () => {
  it('strips HTML and decodes entities for body matching', () => {
    const plain = stripHtmlToPlainText('<p>Hello &quot;world&quot;</p>');
    expect(plain).toBe('Hello "world"');
    expect(decodeHtmlEntities('&amp;lt;')).toBe('&lt;');
  });

  it('builds excerpts around the first match', () => {
    const text = 'aaaa bbbb cccc Zalando dddd eeee';
    const excerpt = buildSearchExcerpt(text, 'Zalando', 20);
    expect(excerpt).toContain('Zalando');
    expect(excerpt.length).toBeLessThanOrEqual(24);
  });

  it('quotes FTS5 match literals safely', () => {
    expect(fts5MatchLiteral('docs/foo.md')).toBe('"docs/foo.md"');
    expect(fts5MatchLiteral('say "hi"')).toBe('"say ""hi"""');
  });

  it('leaves an out-of-range numeric entity as text instead of throwing', () => {
    expect(stripHtmlToPlainText('<p>odd &#x110000; and &#1114112; here</p>')).toBe(
      'odd &#x110000; and &#1114112; here',
    );
  });
});
