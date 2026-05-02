/**
 * Built-in rule-based memory predictor.
 *
 * Wraps the MemoryEngine from the memory engine module and implements the
 * canonical MemoryPredictor interface defined in src/providers/types.ts
 * (Req 8.2, 8.3, 8.5).
 */

import { MemoryEngine } from "../engines/memory.js";
import type { PredictionResult } from "../engines/memory.js";
import { HISTORY_PATH } from "../paths.js";
import type { MemoryPredictor } from "./types.js";

// ---------------------------------------------------------------------------
// BuiltinMemoryPredictor
// ---------------------------------------------------------------------------

/**
 * The built-in rule-based memory predictor.
 *
 * Delegates to MemoryEngine (pattern-based sequential prediction with branch
 * variable substitution). Implements the canonical MemoryPredictor interface
 * so it is interchangeable with any external AI/ML predictor.
 *
 * Req 8.2: Exposes the predictor interface.
 * Req 8.3: Daemon defaults to this implementation.
 * Req 8.5: Implements the same interface as external predictors.
 */
export class BuiltinMemoryPredictor implements MemoryPredictor {
  private readonly inner: MemoryEngine;

  /**
   * @param historyPath        - Path to the history JSON file on disk.
   * @param maxHistoryEntries  - Maximum number of history entries to retain.
   */
  constructor(
    historyPath: string = HISTORY_PATH,
    options: { maxHistoryEntries?: number } = {}
  ) {
    this.inner = new MemoryEngine(historyPath, options);
  }

  /**
   * Predict the next command based on the recent command sequence.
   *
   * Guarantees:
   *  - Each PredictionResult has confidence in [0.0, 1.0].
   *  - Results are sorted by confidence descending.
   *  - Returns [] when no pattern matches or the sequence is empty.
   */
  predict(recentCommands: string[]): PredictionResult[] {
    const results = this.inner.predict(recentCommands);

    // Defensive clamp — MemoryEngine already guarantees this, but we enforce
    // it here so the interface contract is always satisfied.
    return results.map((r) => ({
      command: r.command,
      confidence: Math.max(0, Math.min(1, r.confidence)),
    }));
  }

  /**
   * Record a command to the predictor's history.
   */
  record(command: string, sessionId: string): void {
    this.inner.record(command, sessionId);
  }

  /**
   * Load history from disk.
   * Call this once at startup before using predict() or record().
   */
  async load(): Promise<void> {
    await this.inner.load();
  }

  /**
   * Flush any pending writes and save history to disk.
   * Call this on shutdown.
   */
  async flush(): Promise<void> {
    await this.inner.flush();
  }

  /**
   * Expose the underlying MemoryEngine for use by the daemon's persistence layer.
   */
  getEngine(): MemoryEngine {
    return this.inner;
  }
}
