import { describe, it, expect, beforeEach } from "vitest";
import fc from "fast-check";
import { distance } from "fastest-levenshtein";
import { KnownCommandsCorpus } from "../../corpus.js";
import { AutocorrectEngine, FuzzyMatcher } from "../../engines/autocorrect.js";

// ---------------------------------------------------------------------------
// Shared corpus — built once per describe block via beforeEach
// ---------------------------------------------------------------------------

let corpus: KnownCommandsCorpus;

beforeEach(async () => {
  corpus = new KnownCommandsCorpus();
  await corpus.build();
});

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/**
 * Generates a small, controlled corpus of 2–6 short lowercase words.
 * Using a small corpus keeps property tests fast and deterministic.
 */
const smallCorpusArb = fc
  .uniqueArray(
    fc.stringMatching(/^[a-z]{2,8}$/),
    { minLength: 2, maxLength: 6 }
  );

/**
 * Generates a token that is a short lowercase string.
 */
const tokenArb = fc.stringMatching(/^[a-z]{1,10}$/);

/**
 * Generates a maxEditDistance between 1 and 4.
 */
const maxDistArb = fc.integer({ min: 1, max: 4 });

// ---------------------------------------------------------------------------
// Helper: build a minimal KnownCommandsCorpus from a string array
// ---------------------------------------------------------------------------

function buildCorpusFromList(commands: string[]): KnownCommandsCorpus {
  const c = new KnownCommandsCorpus();
  for (const cmd of commands) {
    c.commands.add(cmd);
    c.trie.insert(cmd);
  }
  return c;
}

// ---------------------------------------------------------------------------
// Property 1: Autocorrect fires iff within threshold
// ---------------------------------------------------------------------------

// Feature: terminal-autocorrect, Property 1: Autocorrect fires iff within threshold — for any token and maxEditDistance, correction happens iff closest match distance ≤ threshold with no tie
describe("Property 1: Autocorrect fires iff within edit distance threshold", () => {
  it(
    "correction happens iff closest match distance ≤ threshold with no tie",
    () => {
      fc.assert(
        fc.property(tokenArb, smallCorpusArb, maxDistArb, (token, corpusWords, maxDist) => {
          // Skip if token is already in the corpus (would be "unchanged", not a correction case)
          if (corpusWords.includes(token)) return;

          const c = buildCorpusFromList(corpusWords);
          const eng = new AutocorrectEngine(c, { maxEditDistance: maxDist });
          const result = eng.correct(token);

          // Compute the minimum edit distance from token to any corpus entry
          const distances = corpusWords.map((w) => distance(token, w));
          const minDist = Math.min(...distances);
          const tiedCount = distances.filter((d) => d === minDist).length;

          if (result.status === "corrected") {
            // Must be within threshold and no tie
            expect(minDist).toBeLessThanOrEqual(maxDist);
            expect(tiedCount).toBe(1);
            // The corrected token must be the closest match
            expect(distance(token, result.corrected!)).toBe(minDist);
          } else if (result.status === "unchanged" || result.status === "unknown") {
            // Either distance exceeds threshold OR there's a tie
            const exceedsThreshold = minDist > maxDist;
            const hasTie = tiedCount > 1;
            expect(exceedsThreshold || hasTie).toBe(true);
          }
          // "ambiguous" is handled by Property 2
        }),
        { numRuns: 100 }
      );
    }
  );

  it(
    "when distance exceeds threshold, original is returned unchanged",
    () => {
      fc.assert(
        fc.property(tokenArb, smallCorpusArb, maxDistArb, (token, corpusWords, maxDist) => {
          if (corpusWords.includes(token)) return;

          const c = buildCorpusFromList(corpusWords);
          const eng = new AutocorrectEngine(c, { maxEditDistance: maxDist });

          const distances = corpusWords.map((w) => distance(token, w));
          const minDist = Math.min(...distances);

          if (minDist > maxDist) {
            const result = eng.correct(token);
            // Must NOT be corrected
            expect(result.status).not.toBe("corrected");
            expect(result.original).toBe(token);
          }
        }),
        { numRuns: 100 }
      );
    }
  );
});

// ---------------------------------------------------------------------------
// Property 2: Ambiguity produces no correction
// ---------------------------------------------------------------------------

// Feature: terminal-autocorrect, Property 2: Ambiguity produces no correction — for any token equidistant from multiple corpus entries, result is "ambiguous"
describe("Property 2: Ambiguity produces no correction", () => {
  it(
    "when two corpus entries tie at minimum distance within threshold, result is ambiguous",
    () => {
      fc.assert(
        fc.property(tokenArb, smallCorpusArb, maxDistArb, (token, corpusWords, maxDist) => {
          if (corpusWords.includes(token)) return;

          const c = buildCorpusFromList(corpusWords);
          const eng = new AutocorrectEngine(c, { maxEditDistance: maxDist });

          const distances = corpusWords.map((w) => distance(token, w));
          const minDist = Math.min(...distances);
          const tiedCount = distances.filter((d) => d === minDist).length;

          if (tiedCount > 1 && minDist <= maxDist) {
            const result = eng.correct(token);
            expect(result.status).toBe("ambiguous");
            // Must not have a corrected field
            expect(result.corrected).toBeUndefined();
            // Must have candidates
            expect(result.candidates).toBeDefined();
            expect(result.candidates!.length).toBeGreaterThanOrEqual(2);
          }
        }),
        { numRuns: 100 }
      );
    }
  );

  it(
    "ambiguous result always includes all tied candidates",
    () => {
      fc.assert(
        fc.property(tokenArb, smallCorpusArb, maxDistArb, (token, corpusWords, maxDist) => {
          if (corpusWords.includes(token)) return;

          const c = buildCorpusFromList(corpusWords);
          const eng = new AutocorrectEngine(c, { maxEditDistance: maxDist });

          const distances = corpusWords.map((w) => distance(token, w));
          const minDist = Math.min(...distances);
          const tiedWords = corpusWords.filter((_, i) => distances[i] === minDist);

          if (tiedWords.length > 1 && minDist <= maxDist) {
            const result = eng.correct(token);
            expect(result.status).toBe("ambiguous");
            for (const w of tiedWords) {
              expect(result.candidates).toContain(w);
            }
          }
        }),
        { numRuns: 100 }
      );
    }
  );
});

// ---------------------------------------------------------------------------
// Property 3: Corrected command preserves non-corrected tokens
// ---------------------------------------------------------------------------

// Feature: terminal-autocorrect, Property 3: Corrected command preserves non-corrected tokens — for any command with one mistyped token, all other tokens are unchanged in output
describe("Property 3: Corrected command preserves non-corrected tokens", () => {
  /**
   * Generates a list of 1–4 extra tokens (flags/args) that are not git subcommands.
   * These should be preserved verbatim in the output.
   */
  const extraTokensArb = fc.array(
    fc.oneof(
      fc.stringMatching(/^--[a-z]{2,10}$/),
      fc.stringMatching(/^-[a-z]$/),
      fc.stringMatching(/^[a-z0-9]{3,12}$/)
    ),
    { minLength: 0, maxLength: 4 }
  );

  it(
    "all non-corrected tokens are preserved in their original order after subcommand correction",
    () => {
      fc.assert(
        fc.property(extraTokensArb, (extraTokens) => {
          // Use "git comit" as a reliable correction case (built-in rule)
          const input = ["git", "comit", ...extraTokens].join(" ");
          const result = engine.correct(input);

          if (result.status === "corrected") {
            const correctedTokens = result.corrected!.split(" ");
            // First token must be "git" (unchanged)
            expect(correctedTokens[0]).toBe("git");
            // Second token must be "commit" (corrected)
            expect(correctedTokens[1]).toBe("commit");
            // All extra tokens must be preserved in order
            for (let i = 0; i < extraTokens.length; i++) {
              expect(correctedTokens[i + 2]).toBe(extraTokens[i]);
            }
          }
        }),
        { numRuns: 100 }
      );
    }
  );

  it(
    "all non-corrected tokens are preserved when correcting the first token",
    () => {
      fc.assert(
        fc.property(extraTokensArb, (extraTokens) => {
          // Build a corpus with only "git" so "gitt" → "git" is unambiguous
          const c = buildCorpusFromList(["git"]);
          const eng = new AutocorrectEngine(c, { maxEditDistance: 2 });

          const input = ["gitt", ...extraTokens].join(" ");
          const result = eng.correct(input);

          if (result.status === "corrected") {
            const correctedTokens = result.corrected!.split(" ");
            // First token must be "git" (corrected)
            expect(correctedTokens[0]).toBe("git");
            // All extra tokens must be preserved in order
            for (let i = 0; i < extraTokens.length; i++) {
              expect(correctedTokens[i + 1]).toBe(extraTokens[i]);
            }
          }
        }),
        { numRuns: 100 }
      );
    }
  );

  it(
    "total token count is preserved after correction",
    () => {
      fc.assert(
        fc.property(extraTokensArb, (extraTokens) => {
          const input = ["git", "comit", ...extraTokens].join(" ");
          const result = engine.correct(input);

          if (result.status === "corrected") {
            const originalTokens = input.split(" ");
            const correctedTokens = result.corrected!.split(" ");
            expect(correctedTokens.length).toBe(originalTokens.length);
          }
        }),
        { numRuns: 100 }
      );
    }
  );
});

// ---------------------------------------------------------------------------
// Shared engine reference for Property 3 tests that use the full corpus
// ---------------------------------------------------------------------------

let engine: AutocorrectEngine;

beforeEach(() => {
  engine = new AutocorrectEngine(corpus, { maxEditDistance: 2 });
});
