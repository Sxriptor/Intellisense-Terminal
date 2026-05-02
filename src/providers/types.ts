/**
 * Canonical provider interfaces for the terminal-autocorrect extensibility layer.
 *
 * These interfaces define the contract that both built-in rule-based providers
 * and external AI/ML providers must satisfy (Req 8.1, 8.2, 8.5).
 *
 * Re-exports the types already defined in the engine modules so that external
 * provider authors only need to import from this single entry point.
 */

// ---------------------------------------------------------------------------
// Re-export shared types from engine modules
// ---------------------------------------------------------------------------

export type {
  CommandHistory,
  HistoryEntry,
  Pattern,
} from "../engines/suggestion.js";

export type { PredictionResult } from "../engines/memory.js";

// ---------------------------------------------------------------------------
// SuggestionResult (Req 8.1)
// ---------------------------------------------------------------------------

/**
 * The result returned by a SuggestionProvider for a given input buffer.
 */
export interface SuggestionResult {
  /** Text to append after the cursor (empty string when there is no suggestion). */
  ghost: string;
  /** Confidence score in the range [0.0, 1.0]. */
  confidence: number;
  /** Origin of the suggestion. */
  source: "prefix" | "memory" | "none";
}

// ---------------------------------------------------------------------------
// SuggestionProvider interface (Req 8.1, 8.5)
// ---------------------------------------------------------------------------

/**
 * A suggestion provider accepts the current input buffer and the user's
 * command history and returns a single best-match suggestion.
 *
 * Both the built-in rule-based provider and any external AI/ML provider
 * must implement this interface.
 */
export interface SuggestionProvider {
  /**
   * Return a suggestion for the given input buffer.
   *
   * @param buffer  - The current content of the terminal input line.
   * @param history - The user's command history and learned patterns.
   * @returns A SuggestionResult whose confidence is in [0.0, 1.0] and whose
   *          source is one of "prefix" | "memory" | "none".
   */
  suggest(
    buffer: string,
    history: import("../engines/suggestion.js").CommandHistory
  ): SuggestionResult;
}

// ---------------------------------------------------------------------------
// MemoryPredictor interface (Req 8.2)
// ---------------------------------------------------------------------------

/**
 * A memory predictor accepts the recent command sequence and returns an
 * ordered list of next-command predictions with confidence scores.
 *
 * Both the built-in rule-based predictor and any external AI/ML predictor
 * must implement this interface.
 */
export interface MemoryPredictor {
  /**
   * Predict the next command based on the recent command sequence.
   *
   * @param recentCommands - The most recent commands executed in the session.
   * @returns An array of PredictionResult objects, each with a confidence in
   *          [0.0, 1.0], sorted by confidence descending.
   */
  predict(
    recentCommands: string[]
  ): import("../engines/memory.js").PredictionResult[];

  /**
   * Record a command to the predictor's history.
   *
   * @param command   - The command that was executed.
   * @param sessionId - The current session identifier.
   */
  record(command: string, sessionId: string): void;
}
