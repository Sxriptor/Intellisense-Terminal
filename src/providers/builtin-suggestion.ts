/**
 * Built-in rule-based suggestion provider.
 *
 * Wraps the DefaultSuggestionProvider from the suggestion engine and
 * implements the canonical SuggestionProvider interface defined in
 * src/providers/types.ts (Req 8.3, 8.5).
 */

import { KnownCommandsCorpus } from "../corpus.js";
import {
  DefaultSuggestionProvider,
} from "../engines/suggestion.js";
import type { CommandHistory } from "../engines/suggestion.js";
import type { MemoryPredictor as EngineMemoryPredictor } from "../engines/memory.js";
import type { SuggestionProvider, SuggestionResult } from "./types.js";

// ---------------------------------------------------------------------------
// BuiltinSuggestionProvider
// ---------------------------------------------------------------------------

/**
 * The built-in rule-based suggestion provider.
 *
 * Delegates to DefaultSuggestionProvider (trie-based prefix matching +
 * history-frequency ranking). Implements the canonical SuggestionProvider
 * interface so it is interchangeable with any external AI/ML provider.
 *
 * Req 8.3: Daemon defaults to this implementation.
 * Req 8.5: Implements the same interface as external providers.
 */
export class BuiltinSuggestionProvider implements SuggestionProvider {
  private readonly inner: DefaultSuggestionProvider;

  /**
   * @param corpus          - The known-commands corpus (trie + subcommands).
   * @param memoryPredictor - Optional memory predictor for empty-buffer suggestions.
   */
  constructor(
    corpus: KnownCommandsCorpus,
    memoryPredictor?: EngineMemoryPredictor
  ) {
    this.inner = new DefaultSuggestionProvider(corpus, memoryPredictor);
  }

  /**
   * Return a suggestion for the given input buffer.
   *
   * Guarantees:
   *  - confidence is always in [0.0, 1.0]
   *  - source is always one of "prefix" | "memory" | "none"
   *  - when source is "none", ghost is ""
   */
  suggest(buffer: string, history: CommandHistory): SuggestionResult {
    const result = this.inner.suggest(buffer, history);

    // Defensive clamp — the inner provider already guarantees this, but we
    // enforce it here so that the interface contract is always satisfied even
    // if the inner implementation changes.
    const confidence = Math.max(0, Math.min(1, result.confidence));

    return {
      ghost: result.ghost,
      confidence,
      source: result.source,
    };
  }
}
