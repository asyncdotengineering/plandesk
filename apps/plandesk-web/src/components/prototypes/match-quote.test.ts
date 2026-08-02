import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { matchQuote, MIN_QUOTE_MATCH_SCORE } from './match-quote.js';

describe('matchQuote', () => {
  it('returns exact match with score 1', () => {
    const text = 'Hello world, welcome back.';
    const m = matchQuote(text, 'welcome', { hint: 13 });
    expect(m).not.toBeNull();
    if (m === null) {
      return;
    }
    expect(m.start).toBe(13);
    expect(m.end).toBe(20);
    expect(m.score).toBeGreaterThanOrEqual(MIN_QUOTE_MATCH_SCORE);
  });

  it('survives a light edit of the anchored sentence', () => {
    const original = 'Please confirm your shipping address before checkout.';
    const edited = 'Please confirm your shipping address prior to checkout.';
    const quote = 'confirm your shipping address before checkout';
    const start = original.indexOf(quote);
    const m = matchQuote(edited, quote, {
      prefix: 'Please ',
      suffix: '.',
      hint: start,
    });
    expect(m).not.toBeNull();
    if (m === null) {
      return;
    }
    expect(edited.slice(m.start, m.end)).toContain('shipping address');
  });

  it('orphans when the quote is deleted — never attaches to different text', () => {
    const original =
      'Alpha sentence one. The unique anchored clause about purple widgets. Beta sentence two.';
    const deleted =
      'Alpha sentence one. An entirely different paragraph about green gadgets. Beta sentence two.';
    const quote = 'The unique anchored clause about purple widgets';
    const start = original.indexOf(quote);
    const m = matchQuote(deleted, quote, {
      prefix: 'one. ',
      suffix: '. Beta',
      hint: start,
    });
    expect(m).toBeNull();
  });

  it('does not prefer a wrong repeated quote when context disagrees', () => {
    const text = 'Pay now. Later: Pay now. Done.';
    const m = matchQuote(text, 'Pay now', {
      prefix: 'Later: ',
      suffix: '. Done',
      hint: 16,
    });
    expect(m).not.toBeNull();
    if (m === null) {
      return;
    }
    expect(m.start).toBe(16);
  });

  it('returns null for empty quote', () => {
    expect(matchQuote('abc', '')).toBeNull();
  });
});

type BaselineCase = {
  name: string;
  text: string;
  quote: string;
  context?: { prefix?: string; suffix?: string; hint?: number };
  expect: 'match' | 'orphan';
  mustInclude?: string;
  mustNotAttachTo?: string;
};

describe('matchQuote baseline corpus', () => {
  const dir = join(dirname(fileURLToPath(import.meta.url)), 'match-quote-baselines');
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));

  it('has seeded baseline fixtures', () => {
    expect(files.length).toBeGreaterThanOrEqual(4);
  });

  for (const file of files) {
    it(file, () => {
      const raw = readFileSync(join(dir, file), 'utf8');
      const c = JSON.parse(raw) as BaselineCase;
      const m = matchQuote(c.text, c.quote, c.context ?? {});
      if (c.expect === 'orphan') {
        expect(m).toBeNull();
        return;
      }
      expect(m).not.toBeNull();
      if (m === null) {
        return;
      }
      if (c.mustInclude !== undefined) {
        expect(c.text.slice(m.start, m.end)).toContain(c.mustInclude);
      }
    });
  }
});
