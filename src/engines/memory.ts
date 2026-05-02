import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { HISTORY_PATH } from "../paths.js";

// ---------------------------------------------------------------------------
// Types (re-exported so tests and other modules can import from here)
// ---------------------------------------------------------------------------

export interface HistoryEntry {
  command: string;
  timestamp: string; // ISO 8601 UTC
  sessionId: string;
}

export interface Pattern {
  trigger: string;    // command_A (normalized, may contain {branch} slot)
  prediction: string; // command_B (normalized, may contain {branch} slot)
  count: number;      // how many times this pair was observed
}

export interface CommandHistory {
  entries: HistoryEntry[];
  patterns: Pattern[];
}

export interface PredictionResult {
  command: string;
  confidence: number; // 0.0–1.0
}

// ---------------------------------------------------------------------------
// MemoryPredictor interface (Req 8.2)
// ---------------------------------------------------------------------------

export interface MemoryPredictor {
  predict(recentCommands: string[]): PredictionResult[];
  record(command: string, sessionId: string): void;
}

// ---------------------------------------------------------------------------
// On-disk format
// ---------------------------------------------------------------------------

interface HistoryFile {
  version: number;
  entries: HistoryEntry[];
  patterns: Pattern[];
}

// ---------------------------------------------------------------------------
// Branch variable helpers
// ---------------------------------------------------------------------------

/**
 * Regex to detect `git checkout <branch>` commands.
 * Captures the branch name in group 1.
 */
const GIT_CHECKOUT_RE = /^git\s+checkout\s+(\S+)$/;

/**
 * Regex to detect `git pull origin <branch>` commands.
 * Captures the branch name in group 1.
 */
const GIT_PULL_ORIGIN_RE = /^git\s+pull\s+origin\s+(\S+)$/;

/**
 * Normalize a command by replacing a concrete branch name with `{branch}`.
 * Only applies to `git checkout <branch>` and `git pull origin <branch>`.
 */
function normalizeCommand(command: string): string {
  const checkoutMatch = GIT_CHECKOUT_RE.exec(command);
  if (checkoutMatch) {
    return "git checkout {branch}";
  }
  const pullMatch = GIT_PULL_ORIGIN_RE.exec(command);
  if (pullMatch) {
    return "git pull origin {branch}";
  }
  return command;
}

/**
 * Extract the branch name from a `git checkout <branch>` command.
 * Returns null if the command is not a git checkout.
 */
function extractBranch(command: string): string | null {
  const match = GIT_CHECKOUT_RE.exec(command);
  return match ? (match[1] ?? null) : null;
}

/**
 * Substitute `{branch}` in a prediction string with the actual branch name.
 */
function substituteBranch(prediction: string, branch: string): string {
  return prediction.replace(/\{branch\}/g, branch);
}

// ---------------------------------------------------------------------------
// MemoryEngine
// ---------------------------------------------------------------------------

/**
 * The MemoryEngine records command history and learns sequential patterns.
 *
 * - Records commands to in-memory history and schedules a disk write within 500ms.
 * - Extracts (prev, current) patterns and increments their count.
 * - Predicts the next command when a pattern has been observed ≥ 2 times.
 * - Handles branch variable slots for `git checkout <branch>` patterns.
 * - Caps history at `maxHistoryEntries`, removing oldest entries.
 * - Persists to / loads from a JSON file on disk.
 * - Recovers from corrupt history files by renaming to `.bak`.
 */
export class MemoryEngine implements MemoryPredictor {
  private history: CommandHistory = { entries: [], patterns: [] };
  private readonly historyPath: string;
  private readonly maxHistoryEntries: number;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    historyPath: string = HISTORY_PATH,
    options: { maxHistoryEntries?: number } = {}
  ) {
    this.historyPath = historyPath;
    this.maxHistoryEntries = options.maxHistoryEntries ?? 10000;
  }

  // -------------------------------------------------------------------------
  // MemoryPredictor interface
  // -------------------------------------------------------------------------

  /**
   * Predict the next command based on the most recent command in the sequence.
   *
   * Returns predictions only for patterns with count ≥ 2 (Req 5.2).
   * Substitutes `{branch}` with the actual branch from the most recent checkout.
   */
  predict(recentCommands: string[]): PredictionResult[] {
    if (recentCommands.length === 0) {
      return [];
    }

    const lastCommand = recentCommands[recentCommands.length - 1]!;
    const normalizedLast = normalizeCommand(lastCommand);

    // Find the most recent branch name from the recent commands (for substitution)
    let recentBranch: string | null = null;
    for (let i = recentCommands.length - 1; i >= 0; i--) {
      const branch = extractBranch(recentCommands[i]!);
      if (branch !== null) {
        recentBranch = branch;
        break;
      }
    }

    // Also check the full history for the most recent checkout if not found in recent
    if (recentBranch === null) {
      for (let i = this.history.entries.length - 1; i >= 0; i--) {
        const branch = extractBranch(this.history.entries[i]!.command);
        if (branch !== null) {
          recentBranch = branch;
          break;
        }
      }
    }

    const results: PredictionResult[] = [];

    for (const pattern of this.history.patterns) {
      if (pattern.trigger === normalizedLast && pattern.count >= 2) {
        let prediction = pattern.prediction;

        // Substitute {branch} if present
        if (prediction.includes("{branch}") && recentBranch !== null) {
          prediction = substituteBranch(prediction, recentBranch);
        } else if (prediction.includes("{branch}") && recentBranch === null) {
          // Cannot substitute — skip this prediction
          continue;
        }

        // Confidence scales with count, capped at 1.0
        const confidence = Math.min(1.0, 0.5 + (pattern.count - 2) * 0.05);
        results.push({ command: prediction, confidence });
      }
    }

    // Sort by confidence descending
    results.sort((a, b) => b.confidence - a.confidence);
    return results;
  }

  /**
   * Record a command to in-memory history and schedule a disk write.
   *
   * - Appends to history (Req 6.2)
   * - Extracts patterns from (prev, current) pair (Req 5.6)
   * - Caps history at maxHistoryEntries (Req 6.7)
   * - Schedules disk write within 500ms (Req 6.2)
   */
  record(command: string, sessionId: string): void {
    const entry: HistoryEntry = {
      command,
      timestamp: new Date().toISOString(),
      sessionId,
    };

    // Find the previous command (last entry before this one)
    const prevEntry =
      this.history.entries.length > 0
        ? this.history.entries[this.history.entries.length - 1]
        : null;

    // Append to history
    this.history.entries.push(entry);

    // Cap history (Req 6.7)
    this._enforceHistoryCap();

    // Extract pattern from (prev, current) pair (Req 5.6)
    if (prevEntry !== null) {
      this._recordPattern(prevEntry.command, command);
    }

    // Schedule disk write within 500ms (Req 6.2)
    this._scheduleSave();
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  /**
   * Load history from disk (Req 6.1).
   *
   * - If file is missing, create an empty file (Req 6.4).
   * - If file is corrupt, rename to .bak, create empty file, log warning (Req 6.5).
   */
  async load(): Promise<void> {
    let raw: string;

    try {
      raw = await readFile(this.historyPath, "utf-8");
    } catch (err: unknown) {
      const nodeErr = err as NodeJS.ErrnoException;
      if (nodeErr.code === "ENOENT") {
        // File missing — create empty history file (Req 6.4)
        this.history = { entries: [], patterns: [] };
        await this.save();
        return;
      }
      // Other I/O error — start with empty history
      process.stderr.write(
        `[terminal-autocorrect] WARNING: could not read history file (${nodeErr.message}), starting empty\n`
      );
      this.history = { entries: [], patterns: [] };
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Corrupt JSON — rename to .bak, create empty file, log warning (Req 6.5)
      await this._recoverFromCorrupt();
      return;
    }

    if (!this._isValidHistoryFile(parsed)) {
      // Invalid structure — treat as corrupt
      await this._recoverFromCorrupt();
      return;
    }

    const file = parsed as HistoryFile;
    this.history = {
      entries: file.entries,
      patterns: file.patterns,
    };
  }

  /**
   * Save history to disk immediately.
   */
  async save(): Promise<void> {
    const dir = dirname(this.historyPath);
    await mkdir(dir, { recursive: true });

    const file: HistoryFile = {
      version: 1,
      entries: this.history.entries,
      patterns: this.history.patterns,
    };

    await writeFile(this.historyPath, JSON.stringify(file, null, 2) + "\n", "utf-8");
  }

  /**
   * Clear all history and patterns from memory and disk.
   * Used by the `history clear` CLI command (Req 6.6).
   */
  async clear(): Promise<void> {
    this.history = { entries: [], patterns: [] };
    await this.save();
  }

  /**
   * Return a copy of the current in-memory history.
   * Useful for testing and inspection.
   */
  getHistory(): CommandHistory {
    return {
      entries: [...this.history.entries],
      patterns: [...this.history.patterns],
    };
  }

  /**
   * Flush any pending save and cancel the timer.
   * Call this on daemon shutdown to ensure data is persisted.
   */
  async flush(): Promise<void> {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await this.save();
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Record a (prev, current) pattern pair.
   * Normalizes both commands (replacing branch names with {branch} slots).
   * Increments the count if the pattern already exists, otherwise creates it.
   */
  private _recordPattern(prevCommand: string, currentCommand: string): void {
    const trigger = normalizeCommand(prevCommand);
    const prediction = normalizeCommand(currentCommand);

    const existing = this.history.patterns.find(
      (p) => p.trigger === trigger && p.prediction === prediction
    );

    if (existing) {
      existing.count++;
    } else {
      this.history.patterns.push({ trigger, prediction, count: 1 });
    }
  }

  /**
   * Enforce the history cap by removing the oldest entries.
   */
  private _enforceHistoryCap(): void {
    if (this.history.entries.length > this.maxHistoryEntries) {
      const excess = this.history.entries.length - this.maxHistoryEntries;
      this.history.entries.splice(0, excess);
    }
  }

  /**
   * Schedule a disk write within 500ms (debounced).
   * If a write is already scheduled, reset the timer.
   */
  private _scheduleSave(): void {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.save().catch((err: unknown) => {
        process.stderr.write(
          `[terminal-autocorrect] WARNING: failed to save history: ${String(err)}\n`
        );
      });
    }, 500);
  }

  /**
   * Handle a corrupt history file:
   * 1. Rename to .bak
   * 2. Create empty history file
   * 3. Log warning to stderr
   */
  private async _recoverFromCorrupt(): Promise<void> {
    process.stderr.write(
      `[terminal-autocorrect] WARNING: history file was corrupt, reset to empty\n`
    );

    try {
      await rename(this.historyPath, `${this.historyPath}.bak`);
    } catch {
      // If rename fails (e.g., file was deleted between read and rename), ignore
    }

    this.history = { entries: [], patterns: [] };
    await this.save();
  }

  /**
   * Validate that a parsed JSON value has the expected HistoryFile structure.
   */
  private _isValidHistoryFile(value: unknown): value is HistoryFile {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return false;
    }
    const obj = value as Record<string, unknown>;
    if (!Array.isArray(obj["entries"]) || !Array.isArray(obj["patterns"])) {
      return false;
    }
    return true;
  }
}
