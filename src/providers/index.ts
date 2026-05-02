/**
 * Provider module for terminal-autocorrect.
 *
 * Exports:
 *  - Canonical interfaces (SuggestionProvider, MemoryPredictor, SuggestionResult, PredictionResult)
 *  - Built-in rule-based implementations (BuiltinSuggestionProvider, BuiltinMemoryPredictor)
 *  - Dynamic provider loader (loadProvider, loadMemoryPredictor)
 */

// ---------------------------------------------------------------------------
// Re-export canonical interfaces and types
// ---------------------------------------------------------------------------

export type {
  SuggestionProvider,
  SuggestionResult,
  MemoryPredictor,
  CommandHistory,
  HistoryEntry,
  Pattern,
  PredictionResult,
} from "./types.js";

// ---------------------------------------------------------------------------
// Built-in implementations
// ---------------------------------------------------------------------------

export { BuiltinSuggestionProvider } from "./builtin-suggestion.js";
export { BuiltinMemoryPredictor } from "./builtin-memory.js";

// ---------------------------------------------------------------------------
// Dynamic provider loading
// ---------------------------------------------------------------------------

export { loadProvider, loadMemoryPredictor } from "./loader.js";
