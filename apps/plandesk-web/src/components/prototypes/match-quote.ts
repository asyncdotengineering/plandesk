/**
 * Hypothesis-style quote matching for shell-side anchor re-resolution.
 * Port of hypothesis/client `src/annotator/anchoring/match-quote.ts` (BSD-2),
 * with an explicit quality floor so a deleted quote orphans rather than
 * attaching to unrelated text.
 */
import approxSearch from 'approx-string-match';
import type { Match as StringMatch } from 'approx-string-match';

/**
 * Minimum combined score (0–1) for a match to be accepted.
 * Below this the anchor is orphaned — never silently moved to different text.
 * Tuned against the baseline corpus in `match-quote-baselines/`.
 */
export const MIN_QUOTE_MATCH_SCORE = 0.5;

/**
 * Minimum quote-only similarity (`1 - errors/quote.length`). Context can boost
 * a weak quote match above {@link MIN_QUOTE_MATCH_SCORE}; this floor stops a
 * short quote from latching onto unrelated text that shares prefix/suffix.
 */
export const MIN_QUOTE_SIMILARITY = 0.65;

export type QuoteMatch = {
  start: number;
  end: number;
  score: number;
};

export type QuoteContext = {
  prefix?: string;
  suffix?: string;
  hint?: number;
};

function search(text: string, str: string, maxErrors: number): StringMatch[] {
  let matchPos = 0;
  const exactMatches: StringMatch[] = [];
  while (matchPos !== -1) {
    matchPos = text.indexOf(str, matchPos);
    if (matchPos !== -1) {
      exactMatches.push({
        start: matchPos,
        end: matchPos + str.length,
        errors: 0,
      });
      matchPos += 1;
    }
  }
  if (exactMatches.length > 0) {
    return exactMatches;
  }
  return approxSearch(text, str, maxErrors);
}

function textMatchScore(text: string, str: string): number {
  if (str.length === 0 || text.length === 0) {
    return 0.0;
  }
  const matches = search(text, str, str.length);
  const best = matches[0];
  if (best === undefined) {
    return 0.0;
  }
  return 1 - best.errors / str.length;
}

/**
 * Find the best approximate match for `quote` in `text`.
 * Returns null when no candidate clears {@link MIN_QUOTE_MATCH_SCORE}.
 */
export function matchQuote(
  text: string,
  quote: string,
  context: QuoteContext = {},
): QuoteMatch | null {
  if (quote.length === 0) {
    return null;
  }

  const maxErrors = Math.min(256, Math.floor(quote.length / 2));
  const matches = search(text, quote, maxErrors);
  if (matches.length === 0) {
    return null;
  }

  const scoreMatch = (match: StringMatch): { score: number; quoteScore: number } => {
    const quoteWeight = 50;
    const prefixWeight = 20;
    const suffixWeight = 20;
    const posWeight = 2;

    const quoteScore = 1 - match.errors / quote.length;

    const prefixScore = context.prefix
      ? textMatchScore(
          text.slice(Math.max(0, match.start - context.prefix.length), match.start),
          context.prefix,
        )
      : 1.0;
    const suffixScore = context.suffix
      ? textMatchScore(text.slice(match.end, match.end + context.suffix.length), context.suffix)
      : 1.0;

    let posScore = 1.0;
    if (typeof context.hint === 'number') {
      const offset = Math.abs(match.start - context.hint);
      posScore = text.length === 0 ? 0 : 1.0 - offset / text.length;
    }

    const rawScore =
      quoteWeight * quoteScore +
      prefixWeight * prefixScore +
      suffixWeight * suffixScore +
      posWeight * posScore;
    const maxScore = quoteWeight + prefixWeight + suffixWeight + posWeight;
    return { score: rawScore / maxScore, quoteScore };
  };

  const scoredMatches = matches.map((m) => {
    const { score, quoteScore } = scoreMatch(m);
    return { start: m.start, end: m.end, score, quoteScore };
  });
  scoredMatches.sort((a, b) => b.score - a.score);
  const best = scoredMatches[0];
  if (
    best === undefined ||
    best.score < MIN_QUOTE_MATCH_SCORE ||
    best.quoteScore < MIN_QUOTE_SIMILARITY
  ) {
    return null;
  }
  return { start: best.start, end: best.end, score: best.score };
}
