import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { CONFIG_PATH, HISTORY_PATH } from "./paths.js";

/**
 * All configurable keys and their types.
 * The 8 required keys are defined here along with optional provider paths.
 */
export interface Config {
  /** Maximum edit distance for autocorrect to fire. Default: 2 */
  maxEditDistance: number;
  /** Maximum number of history entries to retain. Default: 10000 */
  maxHistoryEntries: number;
  /** Path to the history JSON file. Default: ~/.terminal-autocorrect/history.json */
  historyPath: string;
  /** ANSI color name for ghost-text suggestions. Default: "dim" */
  suggestionColor: string;
  /** Master on/off switch for the daemon. Default: true */
  enabled: boolean;
  /** Enable/disable autocorrect feature. Default: true */
  autocorrectEnabled: boolean;
  /** Enable/disable inline suggestions feature. Default: true */
  suggestionsEnabled: boolean;
  /** Enable/disable memory-based prediction feature. Default: true */
  memoryEnabled: boolean;
  /** Optional path to an external suggestion provider module. */
  suggestionProvider?: string;
  /** Optional path to an external memory predictor module. */
  memoryProvider?: string;
}

/**
 * The 8 required configurable keys (from requirements 7.6).
 * These are the keys that can be set via `config set`.
 */
export const VALID_CONFIG_KEYS: ReadonlyArray<keyof Config> = [
  "maxEditDistance",
  "maxHistoryEntries",
  "historyPath",
  "suggestionColor",
  "enabled",
  "autocorrectEnabled",
  "suggestionsEnabled",
  "memoryEnabled",
  "suggestionProvider",
  "memoryProvider",
] as const;

/**
 * Default configuration values applied when the config file is missing
 * or when a key is not present in the loaded config.
 */
export const DEFAULT_CONFIG: Config = {
  maxEditDistance: 2,
  maxHistoryEntries: 10000,
  historyPath: HISTORY_PATH,
  suggestionColor: "dim",
  enabled: true,
  autocorrectEnabled: true,
  suggestionsEnabled: true,
  memoryEnabled: true,
};

/**
 * Expected types for each config key, used for value validation.
 */
const CONFIG_KEY_TYPES: Record<keyof Config, string> = {
  maxEditDistance: "number",
  maxHistoryEntries: "number",
  historyPath: "string",
  suggestionColor: "string",
  enabled: "boolean",
  autocorrectEnabled: "boolean",
  suggestionsEnabled: "boolean",
  memoryEnabled: "boolean",
  suggestionProvider: "string",
  memoryProvider: "string",
};

/**
 * Error thrown when an unknown config key is used.
 */
export class UnknownConfigKeyError extends Error {
  constructor(key: string) {
    super(
      `Unknown configuration key: "${key}". Valid keys are: ${VALID_CONFIG_KEYS.join(", ")}`
    );
    this.name = "UnknownConfigKeyError";
  }
}

/**
 * Error thrown when a value of the wrong type is passed to config set.
 */
export class InvalidConfigValueError extends Error {
  constructor(key: string, expectedType: string, actualType: string) {
    super(
      `Invalid value type for "${key}": expected ${expectedType}, got ${actualType}`
    );
    this.name = "InvalidConfigValueError";
  }
}

/**
 * Manages reading, writing, and validating the terminal-autocorrect configuration.
 *
 * Usage:
 *   const manager = new ConfigManager();
 *   await manager.load();
 *   manager.set("maxEditDistance", 3);
 *   await manager.save();
 */
export class ConfigManager {
  private config: Config;
  private readonly configPath: string;

  constructor(configPath: string = CONFIG_PATH) {
    this.configPath = configPath;
    // Start with a deep copy of defaults
    this.config = { ...DEFAULT_CONFIG };
  }

  /**
   * Load configuration from disk.
   *
   * - If the file is missing, applies all defaults and creates the file (req 7.8).
   * - If the file is corrupt/unparseable, applies defaults, overwrites the file,
   *   and logs a warning to stderr (design: Corrupt Config File).
   */
  async load(): Promise<void> {
    let raw: string;

    try {
      raw = await readFile(this.configPath, "utf-8");
    } catch (err: unknown) {
      // File missing — apply defaults and create the file
      const nodeErr = err as NodeJS.ErrnoException;
      if (nodeErr.code === "ENOENT") {
        this.config = { ...DEFAULT_CONFIG };
        await this.save();
        return;
      }
      // Other I/O error — apply defaults and warn
      process.stderr.write(
        `[terminal-autocorrect] WARNING: could not read config file (${nodeErr.message}), using defaults\n`
      );
      this.config = { ...DEFAULT_CONFIG };
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Corrupt JSON — apply defaults, overwrite, warn
      process.stderr.write(
        `[terminal-autocorrect] WARNING: config file was corrupt, resetting to defaults\n`
      );
      this.config = { ...DEFAULT_CONFIG };
      await this.save();
      return;
    }

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      process.stderr.write(
        `[terminal-autocorrect] WARNING: config file had unexpected format, resetting to defaults\n`
      );
      this.config = { ...DEFAULT_CONFIG };
      await this.save();
      return;
    }

    // Merge loaded values over defaults (unknown keys are silently ignored on load)
    this.config = { ...DEFAULT_CONFIG };
    const record = parsed as Record<string, unknown>;
    for (const key of VALID_CONFIG_KEYS) {
      if (Object.prototype.hasOwnProperty.call(record, key)) {
        const value = record[key];
        const expectedType = CONFIG_KEY_TYPES[key];
        if (typeof value === expectedType) {
          // Safe cast: we've verified the type matches
          (this.config as unknown as Record<string, unknown>)[key] = value;
        }
        // If type doesn't match, silently fall back to default for that key
      }
    }
  }

  /**
   * Persist the current configuration to disk.
   * Creates the parent directory if it does not exist.
   */
  async save(): Promise<void> {
    const dir = dirname(this.configPath);
    await mkdir(dir, { recursive: true });
    await writeFile(this.configPath, JSON.stringify(this.config, null, 2) + "\n", "utf-8");
  }

  /**
   * Get the value for a config key.
   *
   * @throws {UnknownConfigKeyError} if the key is not in VALID_CONFIG_KEYS
   */
  get<K extends keyof Config>(key: K): Config[K] {
    if (!VALID_CONFIG_KEYS.includes(key)) {
      throw new UnknownConfigKeyError(key as string);
    }
    return this.config[key];
  }

  /**
   * Set a config key to a new value (in-memory only; call save() to persist).
   *
   * @throws {UnknownConfigKeyError} if the key is not in VALID_CONFIG_KEYS (req 7.4)
   * @throws {InvalidConfigValueError} if the value type does not match (req 7.5)
   */
  set<K extends keyof Config>(key: K, value: Config[K]): void {
    if (!VALID_CONFIG_KEYS.includes(key)) {
      throw new UnknownConfigKeyError(key as string);
    }

    const expectedType = CONFIG_KEY_TYPES[key];
    const actualType = typeof value;

    // Optional string keys (suggestionProvider, memoryProvider) may be set to undefined
    if (value === undefined && (key === "suggestionProvider" || key === "memoryProvider")) {
      (this.config as unknown as Record<string, unknown>)[key] = undefined;
      return;
    }

    if (actualType !== expectedType) {
      throw new InvalidConfigValueError(key as string, expectedType, actualType);
    }

    (this.config as unknown as Record<string, unknown>)[key] = value;
  }

  /**
   * Return a shallow copy of the entire current configuration.
   */
  list(): Config {
    return { ...this.config };
  }
}
