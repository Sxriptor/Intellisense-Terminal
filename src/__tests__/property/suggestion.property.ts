import { describe, it, expect, beforeEach } from "vitest";
import fc from "fast-check";
import { KnownCommandsCorpus } from "../../corpus.js";
import {
  DefaultSuggestionProvider,
  CommandHistory,
  HistoryEntry,
} from "../../engines/suggestion.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a KnownCommandsCorpus from a list of top-level commands and an
 * optional map of subcommands. This avoids async $PATH scanning.
 */
function buildCorpusFromSpec(
  commands: string[],
  subcommands: Map<string, string[]> = new Map()
): KnownCommandsCorpus {
  const corpus = new KnownCommandsCorpus();
  for (const cmd of commands) {
    corpus.commands.add(cmd);
    corpus.trie.insert(cmd);
  }
  for (const [cmd, subs] of subcommands) {
    const subSet = new Set(subs);
    corpus.subcommands.set(cmd, subSet);
  }
  return corpus;
}

/**
 * Build a CommandHistory from an array of command strings.
 */
function makeHistory(commands: string[]): CommandHistory {
  const entries: HistoryEntry[] = commands.map((command, i) => ({
    command,
    timestamp: new Date(Date.now() + i * 1000).toISOString(),
    sessionId: "prop-test-session",
  }));
  return { entries, patterns: [] };
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/**
 * Generates a short lowercase word (2–8 chars) suitable as a command name.
 */
const wordArb = fc.stringMatching(/^[a-z]{2,8}$/);

/**
 * Generates a list of 1–4 unique short words for use as commands.
 */
const commandListArb = fc.uniqueArray(wordArb, { minLength: 1, maxLength: 4 });

/**
 * Generates a list of 1–5 unique short words for use as subcommands.
 */
const subcommandListArb = fc.uniqueArray(wordArb, { minLength: 1, maxLength: 5 });

/**
 * Generates a non-empty prefix of a given string.
 * Returns a prefix of length 1..str.length.
 */
function prefixOf(str: string, len: number): string {
  return str.slice(0, Math.max(1, Math.min(len, str.length)));
}

// ---------------------------------------------------------------------------
// Property 4: Ghost text is always a valid completion of the buffer
// ---------------------------------------------------------------------------

// Feature: terminal-autocorrect, Property 4: Ghost text is always a valid completion — for any buffer with a suggestion, buffer + ghost starts with buffer and full suggestion is in corpus/history
describe("Property 4: Ghost text is always a valid completion of the buffer", () => {
  it(
    "buffer + ghost starts with buffer for any non-empty ghost text (top-level commands)",
    () => {
      fc.assert(
        fc.property(
          commandListArb,
          fc.integer({ min: 1, max: 8 }),
          (commands, prefixLen) => {
            const corpus = buildCorpusFromSpec(commands);
            const provider = new DefaultSuggestionProvider(corpus);
            const history = makeHistory([]);

            // Try a prefix of the first command
            const target = commands[0]!;
            const buffer = prefixOf(target, prefixLen);

            const result = provider.suggest(buffer, history);

            if (result.ghost !== "" && result.source === "prefix") {
              const full = buffer + result.ghost;
              // Property: full suggestion starts with buffer
              expect(full.startsWith(buffer)).toBe(true);
              // Property: full suggestion is in the trie entries (corpus)
              const trieEntries = provider.getTrieEntries();
              expect(trieEntries.has(full)).toBe(true);
            }
          }
        ),
        { numRuns: 100 }
      );
    }
  );

  it(
    "buffer + ghost starts with buffer for compound 'cmd subcmd' suggestions",
    () => {
      fc.assert(
        fc.property(
          commandListArb,
          subcommandListArb,
          fc.integer({ min: 1, max: 12 }),
          (commands, subcommands, prefixLen) => {
            // Use first command with the generated subcommands
            const cmd = commands[0]!;
            const subMap = new Map([[cmd, subcommands]]);
            const corpus = buildCorpusFromSpec(commands, subMap);
            const provider = new DefaultSuggestionProvider(corpus);
            const history = makeHistory([]);

            // Build a compound string and take a prefix of it
            const sub = subcommands[0]!;
            const compound = `${cmd} ${sub}`;
            const buffer = prefixOf(compound, prefixLen);

            const result = provider.suggest(buffer, history);

            if (result.ghost !== "" && result.source === "prefix") {
              const full = buffer + result.ghost;
              // Property: full suggestion starts with buffer
              expect(full.startsWith(buffer)).toBe(true);
              // Property: full suggestion is in the trie entries (corpus)
              const trieEntries = provider.getTrieEntries();
              expect(trieEntries.has(full)).toBe(true);
            }
          }
        ),
        { numRuns: 100 }
      );
    }
  );

  it(
    "confidence is always in [0.0, 1.0] for any input",
    () => {
      fc.assert(
        fc.property(
          commandListArb,
          subcommandListArb,
          wordArb,
          (commands, subcommands, buffer) => {
            const cmd = commands[0]!;
            const subMap = new Map([[cmd, subcommands]]);
            const corpus = buildCorpusFromSpec(commands, subMap);
            const provider = new DefaultSuggestionProvider(corpus);
            const history = makeHistory([]);

            const result = provider.suggest(buffer, history);

            expect(result.confidence).toBeGreaterThanOrEqual(0);
            expect(result.confidence).toBeLessThanOrEqual(1);
          }
        ),
        { numRuns: 100 }
      );
    }
  );

  it(
    "source is always one of 'prefix', 'memory', or 'none'",
    () => {
      fc.assert(
        fc.property(
          commandListArb,
          wordArb,
          (commands, buffer) => {
            const corpus = buildCorpusFromSpec(commands);
            const provider = new DefaultSuggestionProvider(corpus);
            const history = makeHistory([]);

            const result = provider.suggest(buffer, history);

            expect(["prefix", "memory", "none"]).toContain(result.source);
          }
        ),
        { numRuns: 100 }
      );
    }
  );

  it(
    "when source is 'none', ghost is always empty string",
    () => {
      fc.assert(
        fc.property(
          commandListArb,
          wordArb,
          (commands, buffer) => {
            const corpus = buildCorpusFromSpec(commands);
            const provider = new DefaultSuggestionProvider(corpus);
            const history = makeHistory([]);

            const result = provider.suggest(buffer, history);

            if (result.source === "none") {
              expect(result.ghost).toBe("");
            }
          }
        ),
        { numRuns: 100 }
      );
    }
  );
});

// ---------------------------------------------------------------------------
// Property 5: Ranking respects history frequency
// ---------------------------------------------------------------------------

// Feature: terminal-autocorrect, Property 5: Ranking respects history frequency — for any buffer matching multiple completions, returned ghost text is the highest-frequency completion
describe("Property 5: Ranking respects history frequency", () => {
  it(
    "when multiple completions match, the returned ghost corresponds to the highest-frequency completion",
    () => {
      fc.assert(
        fc.property(
          // Generate a command and at least 2 subcommands that share a common prefix
          fc.record({
            cmd: wordArb,
            // Two subcommands that share a common prefix character
            sub1: fc.stringMatching(/^a[a-z]{1,6}$/),
            sub2: fc.stringMatching(/^a[a-z]{1,6}$/),
            // How many times each subcommand appears in history
            count1: fc.integer({ min: 0, max: 10 }),
            count2: fc.integer({ min: 0, max: 10 }),
          }).filter(({ sub1, sub2 }) => sub1 !== sub2),
          ({ cmd, sub1, sub2, count1, count2 }) => {
            // Build corpus with cmd having sub1 and sub2 as subcommands
            const subMap = new Map([[cmd, [sub1, sub2]]]);
            const corpus = buildCorpusFromSpec([cmd], subMap);
            const provider = new DefaultSuggestionProvider(corpus);

            // Build history: count1 occurrences of "cmd sub1", count2 of "cmd sub2"
            const historyCommands: string[] = [
              ...Array(count1).fill(`${cmd} ${sub1}`),
              ...Array(count2).fill(`${cmd} ${sub2}`),
            ];
            const history = makeHistory(historyCommands);

            // Use "cmd a" as the buffer (both sub1 and sub2 start with "a")
            const buffer = `${cmd} a`;
            const result = provider.suggest(buffer, history);

            if (result.source === "prefix" && result.ghost !== "") {
              const full = buffer + result.ghost;

              // Determine which completion has higher frequency
              const full1 = `${cmd} ${sub1}`;
              const full2 = `${cmd} ${sub2}`;

              if (count1 > count2) {
                // sub1 is more frequent — should be suggested
                expect(full).toBe(full1);
              } else if (count2 > count1) {
                // sub2 is more frequent — should be suggested
                expect(full).toBe(full2);
              }
              // When counts are equal, either is acceptable (no assertion on tie)
            }
          }
        ),
        { numRuns: 100 }
      );
    }
  );

  it(
    "when one completion has zero history and another has positive history, positive-history wins",
    () => {
      fc.assert(
        fc.property(
          fc.record({
            cmd: wordArb,
            sub1: fc.stringMatching(/^a[a-z]{1,6}$/),
            sub2: fc.stringMatching(/^a[a-z]{1,6}$/),
            count: fc.integer({ min: 1, max: 10 }),
          }).filter(({ sub1, sub2 }) => sub1 !== sub2),
          ({ cmd, sub1, sub2, count }) => {
            const subMap = new Map([[cmd, [sub1, sub2]]]);
            const corpus = buildCorpusFromSpec([cmd], subMap);
            const provider = new DefaultSuggestionProvider(corpus);

            // Only sub1 appears in history
            const historyCommands = Array(count).fill(`${cmd} ${sub1}`);
            const history = makeHistory(historyCommands);

            const buffer = `${cmd} a`;
            const result = provider.suggest(buffer, history);

            if (result.source === "prefix" && result.ghost !== "") {
              const full = buffer + result.ghost;
              // sub1 has history, sub2 does not — sub1 should win
              expect(full).toBe(`${cmd} ${sub1}`);
            }
          }
        ),
        { numRuns: 100 }
      );
    }
  );

  it(
    "frequency ranking is consistent: same history always produces same suggestion",
    () => {
      fc.assert(
        fc.property(
          fc.record({
            cmd: wordArb,
            sub1: fc.stringMatching(/^a[a-z]{1,6}$/),
            sub2: fc.stringMatching(/^a[a-z]{1,6}$/),
            count1: fc.integer({ min: 0, max: 10 }),
            count2: fc.integer({ min: 0, max: 10 }),
          }).filter(({ sub1, sub2 }) => sub1 !== sub2),
          ({ cmd, sub1, sub2, count1, count2 }) => {
            const subMap = new Map([[cmd, [sub1, sub2]]]);
            const corpus = buildCorpusFromSpec([cmd], subMap);
            const provider = new DefaultSuggestionProvider(corpus);

            const historyCommands: string[] = [
              ...Array(count1).fill(`${cmd} ${sub1}`),
              ...Array(count2).fill(`${cmd} ${sub2}`),
            ];
            const history = makeHistory(historyCommands);

            const buffer = `${cmd} a`;

            // Call suggest twice with the same inputs — must return same result
            const result1 = provider.suggest(buffer, history);
            const result2 = provider.suggest(buffer, history);

            expect(result1.ghost).toBe(result2.ghost);
            expect(result1.source).toBe(result2.source);
          }
        ),
        { numRuns: 100 }
      );
    }
  );
});
