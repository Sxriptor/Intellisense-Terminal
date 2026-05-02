import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fc from "fast-check";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ConfigManager,
  DEFAULT_CONFIG,
  VALID_CONFIG_KEYS,
  UnknownConfigKeyError,
  type Config,
} from "../../config.js";

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Generates a valid Config object with all 8 required keys populated. */
const validConfigArb = fc.record<Config>({
  maxEditDistance: fc.integer({ min: 0, max: 10 }),
  maxHistoryEntries: fc.integer({ min: 1, max: 100000 }),
  historyPath: fc.string({ minLength: 1, maxLength: 200 }).filter((s) => !s.includes("\0")),
  suggestionColor: fc.constantFrom("dim", "red", "green", "blue", "yellow", "cyan", "magenta"),
  enabled: fc.boolean(),
  autocorrectEnabled: fc.boolean(),
  suggestionsEnabled: fc.boolean(),
  memoryEnabled: fc.boolean(),
});

/** Generates strings that are NOT valid config keys. */
const invalidKeyArb = fc
  .string({ minLength: 1, maxLength: 50 })
  .filter((s) => !(VALID_CONFIG_KEYS as ReadonlyArray<string>).includes(s));

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let tempDirs: string[] = [];

async function makeTempConfigPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "tac-prop-test-"));
  tempDirs.push(dir);
  return join(dir, "config.json");
}

afterEach(async () => {
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

// ---------------------------------------------------------------------------
// Property 8: Config round-trip
// ---------------------------------------------------------------------------

// Feature: terminal-autocorrect, Property 8: Config round-trip — for any valid config object, write then read produces deeply equal result
describe("Property 8: Config round-trip", () => {
  it("writing then reading a valid config produces a deeply equal result", async () => {
    // Use a single shared temp dir for all runs to avoid per-run mkdtemp
    // overhead (especially slow on Windows).
    const sharedDir = await mkdtemp(join(tmpdir(), "tac-prop8-"));
    tempDirs.push(sharedDir);
    let runIndex = 0;

    await fc.assert(
      fc.asyncProperty(validConfigArb, async (originalConfig) => {
        const configPath = join(sharedDir, `config-${runIndex++}.json`);
        const writer = new ConfigManager(configPath);

        // Load defaults first (creates the file), then apply all keys from the generated config
        await writer.load();
        for (const key of VALID_CONFIG_KEYS) {
          const value = originalConfig[key as keyof Config];
          if (value !== undefined) {
            writer.set(key as keyof Config, value as never);
          }
        }
        await writer.save();

        // Read back with a fresh manager
        const reader = new ConfigManager(configPath);
        await reader.load();
        const readConfig = reader.list();

        // Every key we set must round-trip exactly
        for (const key of VALID_CONFIG_KEYS) {
          const originalValue = originalConfig[key as keyof Config];
          if (originalValue !== undefined) {
            expect(readConfig[key as keyof Config]).toStrictEqual(originalValue);
          }
        }
      }),
      { numRuns: 100 }
    );
  }, 30000);

  it("default config round-trips without loss", async () => {
    await fc.assert(
      fc.asyncProperty(fc.constant(null), async () => {
        const configPath = await makeTempConfigPath();
        const writer = new ConfigManager(configPath);
        await writer.load(); // creates file with defaults
        await writer.save();

        const reader = new ConfigManager(configPath);
        await reader.load();
        const readConfig = reader.list();

        // All 8 required default keys must survive the round-trip
        expect(readConfig.maxEditDistance).toBe(DEFAULT_CONFIG.maxEditDistance);
        expect(readConfig.maxHistoryEntries).toBe(DEFAULT_CONFIG.maxHistoryEntries);
        expect(readConfig.suggestionColor).toBe(DEFAULT_CONFIG.suggestionColor);
        expect(readConfig.enabled).toBe(DEFAULT_CONFIG.enabled);
        expect(readConfig.autocorrectEnabled).toBe(DEFAULT_CONFIG.autocorrectEnabled);
        expect(readConfig.suggestionsEnabled).toBe(DEFAULT_CONFIG.suggestionsEnabled);
        expect(readConfig.memoryEnabled).toBe(DEFAULT_CONFIG.memoryEnabled);
      }),
      { numRuns: 10 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 9: Config rejects invalid keys without side effects
// ---------------------------------------------------------------------------

// Feature: terminal-autocorrect, Property 9: Config rejects invalid keys — for any string not in valid key set, config set returns error without modifying stored config
describe("Property 9: Config rejects invalid keys without side effects", () => {
  it("set with an invalid key throws UnknownConfigKeyError and does not modify config", async () => {
    const sharedDir = await mkdtemp(join(tmpdir(), "tac-prop9a-"));
    tempDirs.push(sharedDir);
    let runIndex = 0;

    await fc.assert(
      fc.asyncProperty(invalidKeyArb, async (invalidKey) => {
        const configPath = join(sharedDir, `config-${runIndex++}.json`);
        const manager = new ConfigManager(configPath);
        await manager.load();

        // Capture the config state before the invalid set attempt
        const configBefore = manager.list();

        // Attempt to set an invalid key — must throw
        let threw = false;
        try {
          manager.set(invalidKey as never, "someValue" as never);
        } catch (err) {
          threw = true;
          expect(err).toBeInstanceOf(UnknownConfigKeyError);
        }
        expect(threw).toBe(true);

        // Config must be unchanged after the failed set
        const configAfter = manager.list();
        expect(configAfter).toEqual(configBefore);
      }),
      { numRuns: 100 }
    );
  }, 30000);

  it("set with an invalid key does not modify the persisted config file", async () => {
    const sharedDir = await mkdtemp(join(tmpdir(), "tac-prop9b-"));
    tempDirs.push(sharedDir);
    let runIndex = 0;

    await fc.assert(
      fc.asyncProperty(invalidKeyArb, async (invalidKey) => {
        const configPath = join(sharedDir, `config-${runIndex++}.json`);
        const manager = new ConfigManager(configPath);
        await manager.load(); // creates file with defaults
        await manager.save();

        // Read the file content before the invalid attempt
        const { readFile } = await import("node:fs/promises");
        const contentBefore = await readFile(configPath, "utf-8");

        // Attempt invalid set (should throw, not write)
        try {
          manager.set(invalidKey as never, "value" as never);
        } catch {
          // expected
        }

        // File must not have changed (we did not call save())
        const contentAfter = await readFile(configPath, "utf-8");
        expect(contentAfter).toBe(contentBefore);
      }),
      { numRuns: 100 }
    );
  }, 30000);
});
