import { describe, it, expect, afterEach } from "vitest";
import fc from "fast-check";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MemoryEngine } from "../../engines/memory.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "tac-mem-prop-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/**
 * Generates a simple command string (no special chars that would confuse
 * the branch regex). Avoids "git checkout" and "git pull origin" to keep
 * tests focused on the non-branch path unless explicitly testing branches.
 */
const simpleCommandArb = fc
  .stringMatching(/^[a-z][a-z0-9-]{1,15}(\s[a-z][a-z0-9-]{0,10})?$/)
  .filter(
    (s) =>
      !s.startsWith("git checkout") &&
      !s.startsWith("git pull origin")
  );

/**
 * Generates a sequence of 2–20 simple commands.
 */
const commandSequenceArb = fc.array(simpleCommandArb, {
  minLength: 2,
  maxLength: 20,
});

/**
 * Generates a valid branch name (alphanumeric + hyphens/slashes, no spaces).
 */
const branchNameArb = fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9/_-]{0,30}$/);

// ---------------------------------------------------------------------------
// Property 6: History persistence round-trip
// ---------------------------------------------------------------------------

// Feature: terminal-autocorrect, Property 6: History persistence round-trip — for any sequence of recorded commands, serialize then deserialize produces structurally equivalent history
describe("Property 6: History persistence round-trip", () => {
  it(
    "serializing then deserializing produces structurally equivalent history",
    async () => {
      const sharedDir = await makeTempDir();
      let runIndex = 0;

      await fc.assert(
        fc.asyncProperty(
          commandSequenceArb,
          async (commands) => {
            const path = join(sharedDir, `history-${runIndex++}.json`);
            const engine = new MemoryEngine(path, { maxHistoryEntries: 10000 });

            // Record all commands
            for (const cmd of commands) {
              engine.record(cmd, "session-prop");
            }

            // Flush to disk
            await engine.flush();

            // Load into a fresh engine
            const engine2 = new MemoryEngine(path, { maxHistoryEntries: 10000 });
            await engine2.load();

            const original = engine.getHistory();
            const loaded = engine2.getHistory();

            // Same number of entries
            expect(loaded.entries.length).toBe(original.entries.length);

            // Same command strings and session IDs
            for (let i = 0; i < original.entries.length; i++) {
              expect(loaded.entries[i]!.command).toBe(original.entries[i]!.command);
              expect(loaded.entries[i]!.sessionId).toBe(original.entries[i]!.sessionId);
              expect(loaded.entries[i]!.timestamp).toBe(original.entries[i]!.timestamp);
            }

            // Same number of patterns
            expect(loaded.patterns.length).toBe(original.patterns.length);

            // Same pattern content
            for (let i = 0; i < original.patterns.length; i++) {
              expect(loaded.patterns[i]!.trigger).toBe(original.patterns[i]!.trigger);
              expect(loaded.patterns[i]!.prediction).toBe(original.patterns[i]!.prediction);
              expect(loaded.patterns[i]!.count).toBe(original.patterns[i]!.count);
            }
          }
        ),
        { numRuns: 100 }
      );
    },
    30000
  );

  it(
    "empty history round-trips correctly",
    async () => {
      await fc.assert(
        fc.asyncProperty(fc.constant(null), async () => {
          const dir = await makeTempDir();
          const path = join(dir, "history.json");
          const engine = new MemoryEngine(path, { maxHistoryEntries: 10000 });

          await engine.flush();

          const engine2 = new MemoryEngine(path, { maxHistoryEntries: 10000 });
          await engine2.load();

          const loaded = engine2.getHistory();
          expect(loaded.entries).toHaveLength(0);
          expect(loaded.patterns).toHaveLength(0);
        }),
        { numRuns: 10 }
      );
    }
  );
});

// ---------------------------------------------------------------------------
// Property 7: History cap enforcement
// ---------------------------------------------------------------------------

// Feature: terminal-autocorrect, Property 7: History cap enforcement — for any history at max capacity, adding one entry keeps count at max with oldest removed
describe("Property 7: History cap enforcement", () => {
  it(
    "adding one entry to a full history keeps count at max and removes oldest",
    () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 2, max: 50 }),
          commandSequenceArb,
          simpleCommandArb,
          (maxEntries, fillCommands, newCommand) => {
            const engine = new MemoryEngine("/dev/null", { maxHistoryEntries: maxEntries });

            // Fill to exactly maxEntries
            const fillCount = Math.min(fillCommands.length, maxEntries);
            const usedCommands = fillCommands.slice(0, fillCount);
            for (const cmd of usedCommands) {
              engine.record(cmd, "session1");
            }

            // If we haven't filled to max yet, pad with a known command
            const currentCount = engine.getHistory().entries.length;
            for (let i = currentCount; i < maxEntries; i++) {
              engine.record("pad-command", "session1");
            }

            // Verify we're at max
            expect(engine.getHistory().entries.length).toBe(maxEntries);

            // Record the oldest entry's command for verification
            const oldestBefore = engine.getHistory().entries[0]!.command;

            // Add one more entry
            engine.record(newCommand, "session1");

            const history = engine.getHistory();

            // Count must still be exactly maxEntries
            expect(history.entries.length).toBe(maxEntries);

            // The new entry must be the last one
            expect(history.entries[history.entries.length - 1]!.command).toBe(newCommand);

            // The oldest entry must have been removed
            expect(history.entries[0]!.command).not.toBe(oldestBefore);
          }
        ),
        { numRuns: 100 }
      );
    }
  );

  it(
    "history never exceeds maxHistoryEntries regardless of how many commands are recorded",
    () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 20 }),
          fc.array(simpleCommandArb, { minLength: 1, maxLength: 50 }),
          (maxEntries, commands) => {
            const engine = new MemoryEngine("/dev/null", { maxHistoryEntries: maxEntries });

            for (const cmd of commands) {
              engine.record(cmd, "session1");
            }

            const history = engine.getHistory();
            expect(history.entries.length).toBeLessThanOrEqual(maxEntries);
          }
        ),
        { numRuns: 100 }
      );
    }
  );
});

// ---------------------------------------------------------------------------
// Property 10: Memory pattern threshold
// ---------------------------------------------------------------------------

// Feature: terminal-autocorrect, Property 10: Memory pattern threshold — for any command pair, prediction generated iff pattern count ≥ 2
describe("Property 10: Memory pattern threshold", () => {
  it(
    "prediction is generated if and only if pattern count >= 2",
    () => {
      fc.assert(
        fc.property(
          simpleCommandArb,
          simpleCommandArb,
          fc.integer({ min: 1, max: 10 }),
          (cmdA, cmdB, observationCount) => {
            // Use a fresh engine with a large cap so cap doesn't interfere
            const engine = new MemoryEngine("/dev/null", { maxHistoryEntries: 10000 });

            // Record the pair `observationCount` times
            for (let i = 0; i < observationCount; i++) {
              engine.record(cmdA, "session1");
              engine.record(cmdB, "session1");
            }

            const predictions = engine.predict([cmdA]);

            if (observationCount >= 2) {
              // Must predict cmdB
              const found = predictions.some((p) => p.command === cmdB);
              expect(found).toBe(true);
            } else {
              // Must NOT predict cmdB (count is 1)
              const found = predictions.some((p) => p.command === cmdB);
              expect(found).toBe(false);
            }
          }
        ),
        { numRuns: 100 }
      );
    }
  );

  it(
    "no prediction is generated for a pair observed exactly once",
    () => {
      fc.assert(
        fc.property(
          simpleCommandArb,
          simpleCommandArb,
          (cmdA, cmdB) => {
            const engine = new MemoryEngine("/dev/null", { maxHistoryEntries: 10000 });

            engine.record(cmdA, "session1");
            engine.record(cmdB, "session1");

            const predictions = engine.predict([cmdA]);
            const found = predictions.some((p) => p.command === cmdB);
            expect(found).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    }
  );

  it(
    "prediction confidence is always in [0, 1]",
    () => {
      fc.assert(
        fc.property(
          simpleCommandArb,
          simpleCommandArb,
          fc.integer({ min: 2, max: 20 }),
          (cmdA, cmdB, observationCount) => {
            const engine = new MemoryEngine("/dev/null", { maxHistoryEntries: 10000 });

            for (let i = 0; i < observationCount; i++) {
              engine.record(cmdA, "session1");
              engine.record(cmdB, "session1");
            }

            const predictions = engine.predict([cmdA]);
            for (const p of predictions) {
              expect(p.confidence).toBeGreaterThanOrEqual(0);
              expect(p.confidence).toBeLessThanOrEqual(1);
            }
          }
        ),
        { numRuns: 100 }
      );
    }
  );
});

// ---------------------------------------------------------------------------
// Property 11: Branch variable substitution
// ---------------------------------------------------------------------------

// Feature: terminal-autocorrect, Property 11: Branch variable substitution — for any branch name in git checkout, pattern uses {branch} slot and prediction substitutes actual branch name
describe("Property 11: Branch variable substitution", () => {
  it(
    "git checkout <branch> is stored with {branch} slot in pattern",
    () => {
      fc.assert(
        fc.property(branchNameArb, (branch) => {
          const engine = new MemoryEngine("/dev/null", { maxHistoryEntries: 10000 });

          engine.record("git fetch", "session1");
          engine.record(`git checkout ${branch}`, "session1");

          const history = engine.getHistory();
          const pattern = history.patterns.find(
            (p) => p.trigger === "git fetch"
          );

          expect(pattern).toBeDefined();
          expect(pattern!.prediction).toBe("git checkout {branch}");
        }),
        { numRuns: 100 }
      );
    }
  );

  it(
    "prediction substitutes the actual branch name from the most recent checkout",
    () => {
      fc.assert(
        fc.property(
          branchNameArb,
          branchNameArb,
          (branch1, branch2) => {
            const engine = new MemoryEngine("/dev/null", { maxHistoryEntries: 10000 });

            // Build up pattern count to ≥ 2 using branch1
            engine.record(`git checkout ${branch1}`, "session1");
            engine.record(`git pull origin ${branch1}`, "session1");
            engine.record(`git checkout ${branch1}`, "session1");
            engine.record(`git pull origin ${branch1}`, "session1");

            // Now predict after checking out branch2
            const predictions = engine.predict([`git checkout ${branch2}`]);

            expect(predictions.length).toBeGreaterThan(0);
            // The prediction should use branch2, not branch1
            expect(predictions[0]!.command).toBe(`git pull origin ${branch2}`);
          }
        ),
        { numRuns: 100 }
      );
    }
  );

  it(
    "git checkout trigger is normalized to git checkout {branch} in all patterns",
    () => {
      fc.assert(
        fc.property(
          branchNameArb,
          branchNameArb,
          (branch1, branch2) => {
            // Two different branches should produce the same normalized trigger
            const engine = new MemoryEngine("/dev/null", { maxHistoryEntries: 10000 });

            engine.record(`git checkout ${branch1}`, "session1");
            engine.record("git status", "session1");
            engine.record(`git checkout ${branch2}`, "session1");
            engine.record("git status", "session1");

            const history = engine.getHistory();
            const patterns = history.patterns.filter(
              (p) => p.prediction === "git status"
            );

            // Both checkouts should map to the same normalized trigger
            expect(patterns).toHaveLength(1);
            expect(patterns[0]!.trigger).toBe("git checkout {branch}");
            expect(patterns[0]!.count).toBe(2);
          }
        ),
        { numRuns: 100 }
      );
    }
  );

  it(
    "prediction with {branch} slot uses the branch from recentCommands",
    () => {
      fc.assert(
        fc.property(branchNameArb, (branch) => {
          const engine = new MemoryEngine("/dev/null", { maxHistoryEntries: 10000 });

          // Build pattern: git checkout {branch} → git pull origin {branch}
          engine.record("git checkout main", "session1");
          engine.record("git pull origin main", "session1");
          engine.record("git checkout develop", "session1");
          engine.record("git pull origin develop", "session1");

          // Predict with the generated branch
          const predictions = engine.predict([`git checkout ${branch}`]);

          expect(predictions.length).toBeGreaterThan(0);
          expect(predictions[0]!.command).toBe(`git pull origin ${branch}`);
        }),
        { numRuns: 100 }
      );
    }
  );
});
