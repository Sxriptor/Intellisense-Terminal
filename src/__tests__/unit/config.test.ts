import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ConfigManager,
  DEFAULT_CONFIG,
  VALID_CONFIG_KEYS,
  UnknownConfigKeyError,
  InvalidConfigValueError,
} from "../../config.js";

/**
 * Helper: create a temporary directory and return a config path inside it.
 */
async function makeTempConfigPath(): Promise<{ dir: string; configPath: string }> {
  const dir = await mkdtemp(join(tmpdir(), "tac-config-test-"));
  const configPath = join(dir, "config.json");
  return { dir, configPath };
}

describe("ConfigManager", () => {
  let dir: string;
  let configPath: string;
  let manager: ConfigManager;

  beforeEach(async () => {
    ({ dir, configPath } = await makeTempConfigPath());
    manager = new ConfigManager(configPath);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // 2.3 Missing config file → apply defaults and create file
  // -------------------------------------------------------------------------
  describe("missing config file", () => {
    it("applies all defaults when config file does not exist", async () => {
      await manager.load();
      const config = manager.list();
      expect(config.maxEditDistance).toBe(DEFAULT_CONFIG.maxEditDistance);
      expect(config.maxHistoryEntries).toBe(DEFAULT_CONFIG.maxHistoryEntries);
      expect(config.historyPath).toBe(DEFAULT_CONFIG.historyPath);
      expect(config.suggestionColor).toBe(DEFAULT_CONFIG.suggestionColor);
      expect(config.enabled).toBe(DEFAULT_CONFIG.enabled);
      expect(config.autocorrectEnabled).toBe(DEFAULT_CONFIG.autocorrectEnabled);
      expect(config.suggestionsEnabled).toBe(DEFAULT_CONFIG.suggestionsEnabled);
      expect(config.memoryEnabled).toBe(DEFAULT_CONFIG.memoryEnabled);
    });

    it("creates the config file with defaults when it does not exist", async () => {
      await manager.load();
      const raw = await readFile(configPath, "utf-8");
      const parsed = JSON.parse(raw);
      expect(parsed.maxEditDistance).toBe(DEFAULT_CONFIG.maxEditDistance);
      expect(parsed.enabled).toBe(DEFAULT_CONFIG.enabled);
    });
  });

  // -------------------------------------------------------------------------
  // 2.4 Corrupt config file → apply defaults, overwrite, log warning
  // -------------------------------------------------------------------------
  describe("corrupt config file", () => {
    it("applies defaults when config file contains invalid JSON", async () => {
      await writeFile(configPath, "{ this is not valid json }", "utf-8");
      await manager.load();
      const config = manager.list();
      expect(config.maxEditDistance).toBe(DEFAULT_CONFIG.maxEditDistance);
      expect(config.enabled).toBe(DEFAULT_CONFIG.enabled);
    });

    it("overwrites corrupt config file with defaults", async () => {
      await writeFile(configPath, "CORRUPT", "utf-8");
      await manager.load();
      const raw = await readFile(configPath, "utf-8");
      const parsed = JSON.parse(raw);
      expect(parsed.maxEditDistance).toBe(DEFAULT_CONFIG.maxEditDistance);
    });

    it("applies defaults when config file contains a JSON array instead of object", async () => {
      await writeFile(configPath, JSON.stringify([1, 2, 3]), "utf-8");
      await manager.load();
      const config = manager.list();
      expect(config.maxEditDistance).toBe(DEFAULT_CONFIG.maxEditDistance);
    });

    it("applies defaults when config file contains a JSON primitive", async () => {
      await writeFile(configPath, JSON.stringify(42), "utf-8");
      await manager.load();
      const config = manager.list();
      expect(config.enabled).toBe(DEFAULT_CONFIG.enabled);
    });
  });

  // -------------------------------------------------------------------------
  // 2.2 Valid get/set
  // -------------------------------------------------------------------------
  describe("get and set", () => {
    beforeEach(async () => {
      await manager.load();
    });

    it("get returns the default value for a key", () => {
      expect(manager.get("maxEditDistance")).toBe(2);
    });

    it("set updates the in-memory value", () => {
      manager.set("maxEditDistance", 3);
      expect(manager.get("maxEditDistance")).toBe(3);
    });

    it("set and get work for all 8 required keys", () => {
      manager.set("maxEditDistance", 5);
      manager.set("maxHistoryEntries", 500);
      manager.set("historyPath", "/tmp/history.json");
      manager.set("suggestionColor", "blue");
      manager.set("enabled", false);
      manager.set("autocorrectEnabled", false);
      manager.set("suggestionsEnabled", false);
      manager.set("memoryEnabled", false);

      expect(manager.get("maxEditDistance")).toBe(5);
      expect(manager.get("maxHistoryEntries")).toBe(500);
      expect(manager.get("historyPath")).toBe("/tmp/history.json");
      expect(manager.get("suggestionColor")).toBe("blue");
      expect(manager.get("enabled")).toBe(false);
      expect(manager.get("autocorrectEnabled")).toBe(false);
      expect(manager.get("suggestionsEnabled")).toBe(false);
      expect(manager.get("memoryEnabled")).toBe(false);
    });

    it("list returns a copy of the full config", () => {
      manager.set("maxEditDistance", 4);
      const listed = manager.list();
      expect(listed.maxEditDistance).toBe(4);
      // Mutating the returned copy should not affect the manager
      listed.maxEditDistance = 99;
      expect(manager.get("maxEditDistance")).toBe(4);
    });
  });

  // -------------------------------------------------------------------------
  // 2.2 save() and load() round-trip
  // -------------------------------------------------------------------------
  describe("save and load", () => {
    it("persists changes to disk and reloads them correctly", async () => {
      await manager.load();
      manager.set("maxEditDistance", 4);
      manager.set("enabled", false);
      manager.set("suggestionColor", "cyan");
      await manager.save();

      const manager2 = new ConfigManager(configPath);
      await manager2.load();
      expect(manager2.get("maxEditDistance")).toBe(4);
      expect(manager2.get("enabled")).toBe(false);
      expect(manager2.get("suggestionColor")).toBe("cyan");
    });

    it("creates parent directory if it does not exist", async () => {
      const nestedPath = join(dir, "nested", "deep", "config.json");
      const nestedManager = new ConfigManager(nestedPath);
      await nestedManager.load(); // triggers save() for missing file
      const raw = await readFile(nestedPath, "utf-8");
      expect(JSON.parse(raw)).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // 2.5 Invalid key validation
  // -------------------------------------------------------------------------
  describe("invalid key validation", () => {
    beforeEach(async () => {
      await manager.load();
    });

    it("throws UnknownConfigKeyError for an unrecognized key on set", () => {
      expect(() => manager.set("unknownKey" as never, "value" as never)).toThrow(
        UnknownConfigKeyError
      );
    });

    it("error message lists all valid keys", () => {
      try {
        manager.set("badKey" as never, 1 as never);
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(UnknownConfigKeyError);
        const msg = (err as UnknownConfigKeyError).message;
        for (const key of VALID_CONFIG_KEYS) {
          expect(msg).toContain(key);
        }
      }
    });

    it("throws UnknownConfigKeyError for an unrecognized key on get", () => {
      expect(() => manager.get("notAKey" as never)).toThrow(UnknownConfigKeyError);
    });

    it("does not modify config when an invalid key is used", () => {
      const before = manager.list();
      try {
        manager.set("invalidKey" as never, 999 as never);
      } catch {
        // expected
      }
      expect(manager.list()).toEqual(before);
    });
  });

  // -------------------------------------------------------------------------
  // 2.6 Value type validation
  // -------------------------------------------------------------------------
  describe("value type validation", () => {
    beforeEach(async () => {
      await manager.load();
    });

    it("throws InvalidConfigValueError when setting a number key to a string", () => {
      expect(() => manager.set("maxEditDistance", "three" as never)).toThrow(
        InvalidConfigValueError
      );
    });

    it("throws InvalidConfigValueError when setting a boolean key to a number", () => {
      expect(() => manager.set("enabled", 1 as never)).toThrow(InvalidConfigValueError);
    });

    it("throws InvalidConfigValueError when setting a string key to a boolean", () => {
      expect(() => manager.set("historyPath", true as never)).toThrow(InvalidConfigValueError);
    });

    it("error message includes the key name and expected type", () => {
      try {
        manager.set("maxEditDistance", "bad" as never);
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(InvalidConfigValueError);
        const msg = (err as InvalidConfigValueError).message;
        expect(msg).toContain("maxEditDistance");
        expect(msg).toContain("number");
      }
    });

    it("does not modify config when an invalid type is used", () => {
      const before = manager.list();
      try {
        manager.set("maxEditDistance", "bad" as never);
      } catch {
        // expected
      }
      expect(manager.list()).toEqual(before);
    });

    it("accepts valid number for maxEditDistance", () => {
      expect(() => manager.set("maxEditDistance", 3)).not.toThrow();
    });

    it("accepts valid boolean for enabled", () => {
      expect(() => manager.set("enabled", false)).not.toThrow();
    });

    it("accepts valid string for historyPath", () => {
      expect(() => manager.set("historyPath", "/some/path")).not.toThrow();
    });
  });
});
