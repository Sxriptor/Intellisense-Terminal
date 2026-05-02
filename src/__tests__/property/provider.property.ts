/**
 * Property-based tests for Property 12: Provider interface conformance.
 *
 * Feature: terminal-autocorrect, Property 12: Provider interface conformance —
 * for any input, built-in provider returns SuggestionResult with confidence in
 * [0,1] and valid source enum value. The built-in predictor similarly returns
 * PredictionResult entries with confidence in [0,1].
 *
 * Validates: Requirements 8.1, 8.2, 8.5
 */

import { describe, it } from "vitest";
import fc from "fast-check";
import { KnownCommandsCorpus } from "../../corpus.js";
import { BuiltinSuggestionProvider } from "../../providers/builtin-suggestion.js";
import { BuiltinMemoryPredictor } from "../../providers/builtin-memory.js";
import type { CommandHistory, HistoryEntry, Pattern } from "../../engines/suggestion.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a KnownCommandsCorpus from a list of top-level commands and an
 * optional map of subcommands. Avoids async $PATH scanning.
 */
function buildCorpus(
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
    sessionId: "prop12-session",
  }));
  const patterns: Pattern[] = [];
  return { entries, patterns };
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Short lowercase word (2–8 chars) suitable as a command name. */
const wordArb = fc.stringMatching(/^[a-z]{2,8}$/);

/** List of 1–4 unique short words for use as commands. */
const commandListArb = fc.uniqueArray(wordArb, { minLength: 1, maxLength: 4 });

/** List of 1–5 unique short words for use as subcommands. */
const subcommandListArb = fc.uniqueArray(wordArb, { minLength: 1, maxLength: 5 });

/** Arbitrary string buffer (may or may not match any command). */
const bufferArb = fc.oneof(
  fc.constant(""),
  wordArb,
  fc.string({ minLength: 1, maxLength: 20 })
);

/** Arbitrary list of recent commands (0–10 entries). */
const recentCommandsArb = fc.array(wordArb, { minLength: 0, maxLength: 10 });

// ---------------------------------------------------------------------------
// Property 12: SuggestionProvider interface conformance
// ---------------------------------------------------------------------------

// Feature: terminal-autocorrect, Property 12: Provider interface conformance
describe("Property 12: BuiltinSuggestionProvider interface conformance", () => {
  it(
    "confidence is always in [0.0, 1.0] for any buffer and history",
    () => {
      fc.assert(
        fc.property(
          commandListArb,
          subcommandListArb,
          bufferArb,
          recentCommandsArb,
          (commands, subcommands, buffer, historyCommands) => {
            const cmd = commands[0]!;
            const subMap = new Map([[cmd, subcommands]]);
            const corpus = buildCorpus(commands, subMap);
            const provider = new BuiltinSuggestionProvider(corpus);
            const history = makeHistory(historyCommands);

            const result = provider.suggest(buffer, history);

            return result.confidence >= 0.0 && result.confidence <= 1.0;
          }
        ),
        { numRuns: 100 }
      );
    }
  );

  it(
    "source is always one of 'prefix', 'memory', or 'none' for any input",
    () => {
      const validSources = new Set(["prefix", "memory", "none"]);

      fc.assert(
        fc.property(
          commandListArb,
          bufferArb,
          recentCommandsArb,
          (commands, buffer, historyCommands) => {
            const corpus = buildCorpus(commands);
            const provider = new BuiltinSuggestionProvider(corpus);
            const history = makeHistory(historyCommands);

            const result = provider.suggest(buffer, history);

            return validSources.has(result.source);
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
          bufferArb,
          (commands, buffer) => {
            const corpus = buildCorpus(commands);
            const provider = new BuiltinSuggestionProvider(corpus);
            const history = makeHistory([]);

            const result = provider.suggest(buffer, history);

            if (result.source === "none") {
              return result.ghost === "";
            }
            return true;
          }
        ),
        { numRuns: 100 }
      );
    }
  );

  it(
    "result is deterministic: same inputs always produce same output",
    () => {
      fc.assert(
        fc.property(
          commandListArb,
          bufferArb,
          recentCommandsArb,
          (commands, buffer, historyCommands) => {
            const corpus = buildCorpus(commands);
            const provider = new BuiltinSuggestionProvider(corpus);
            const history = makeHistory(historyCommands);

            const r1 = provider.suggest(buffer, history);
            const r2 = provider.suggest(buffer, history);

            return (
              r1.ghost === r2.ghost &&
              r1.confidence === r2.confidence &&
              r1.source === r2.source
            );
          }
        ),
        { numRuns: 100 }
      );
    }
  );
});

// ---------------------------------------------------------------------------
// Property 12: MemoryPredictor interface conformance
// ---------------------------------------------------------------------------

// Feature: terminal-autocorrect, Property 12: Provider interface conformance
describe("Property 12: BuiltinMemoryPredictor interface conformance", () => {
  it(
    "all PredictionResult entries have confidence in [0.0, 1.0]",
    () => {
      fc.assert(
        fc.property(
          recentCommandsArb,
          (recentCommands) => {
            // Use an in-memory predictor (no disk I/O needed for predict())
            const predictor = new BuiltinMemoryPredictor(
              "/tmp/prop12-test-history.json"
            );

            const results = predictor.predict(recentCommands);

            return results.every(
              (r) => r.confidence >= 0.0 && r.confidence <= 1.0
            );
          }
        ),
        { numRuns: 100 }
      );
    }
  );

  it(
    "predict returns an array (never throws) for any recent command sequence",
    () => {
      fc.assert(
        fc.property(
          recentCommandsArb,
          (recentCommands) => {
            const predictor = new BuiltinMemoryPredictor(
              "/tmp/prop12-test-history.json"
            );

            const results = predictor.predict(recentCommands);

            return Array.isArray(results);
          }
        ),
        { numRuns: 100 }
      );
    }
  );

  it(
    "after recording command pairs, predictions for known patterns have confidence in [0.0, 1.0]",
    () => {
      fc.assert(
        fc.property(
          // Generate two distinct commands and a repeat count ≥ 2
          fc.record({
            cmdA: wordArb,
            cmdB: wordArb,
            repeatCount: fc.integer({ min: 2, max: 6 }),
          }).filter(({ cmdA, cmdB }) => cmdA !== cmdB),
          ({ cmdA, cmdB, repeatCount }) => {
            const predictor = new BuiltinMemoryPredictor(
              "/tmp/prop12-test-history.json"
            );

            // Record the pair enough times to trigger a prediction
            for (let i = 0; i < repeatCount; i++) {
              predictor.record(cmdA, "session-prop12");
              predictor.record(cmdB, "session-prop12");
            }

            const results = predictor.predict([cmdA]);

            return results.every(
              (r) => r.confidence >= 0.0 && r.confidence <= 1.0
            );
          }
        ),
        { numRuns: 100 }
      );
    }
  );
});
