import { KnownCommandsCorpus, PrefixTrie } from "../corpus.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HistoryEntry {
  command: string;
  timestamp: string; // ISO 8601 UTC
  sessionId: string;
}

export interface Pattern {
  trigger: string;
  prediction: string;
  count: number;
}

export interface CommandHistory {
  entries: HistoryEntry[];
  patterns: Pattern[];
}

export interface SuggestionResult {
  ghost: string;       // text to append after cursor
  confidence: number;  // 0.0–1.0
  source: "prefix" | "memory" | "none";
}

// ---------------------------------------------------------------------------
// SuggestionProvider interface (5.1)
// ---------------------------------------------------------------------------

export interface SuggestionProvider {
  suggest(buffer: string, history: CommandHistory): SuggestionResult;
}

// ---------------------------------------------------------------------------
// MemoryPredictor interface (used for delegation when buffer is empty)
// ---------------------------------------------------------------------------

export interface MemoryPredictor {
  predict(recentCommands: string[]): Array<{ command: string; confidence: number }>;
}

// ---------------------------------------------------------------------------
// Helper: count how many times a command appears in history
// ---------------------------------------------------------------------------

function countInHistory(command: string, history: CommandHistory): number {
  let count = 0;
  for (const entry of history.entries) {
    if (entry.command === command) {
      count++;
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// DefaultSuggestionProvider (5.2 – 5.7)
// ---------------------------------------------------------------------------

/**
 * The default rule-based suggestion provider.
 *
 * - Builds a PrefixTrie from the corpus commands AND "command subcommand"
 *   compound strings so that "git a" matches "git add".
 * - Ranks candidates by frequency in CommandHistory.
 * - Delegates to MemoryEngine.predict() when the buffer is empty.
 * - Dismisses memory prediction when the typed prefix does not match.
 */
export class DefaultSuggestionProvider implements SuggestionProvider {
  private readonly corpus: KnownCommandsCorpus;
  private readonly memoryPredictor?: MemoryPredictor;

  /** Trie built from corpus commands + "cmd subcmd" compound strings. */
  private readonly trie: PrefixTrie;

  /** Full set of strings inserted into the trie (for validation). */
  private readonly trieEntries: Set<string>;

  constructor(
    corpus: KnownCommandsCorpus,
    memoryPredictor?: MemoryPredictor
  ) {
    this.corpus = corpus;
    this.memoryPredictor = memoryPredictor;

    // Build the trie once at construction time.
    this.trie = new PrefixTrie();
    this.trieEntries = new Set();
    this._buildTrie();
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Suggest ghost text for the given buffer.
   *
   * Decision tree:
   *  1. Buffer is empty → delegate to MemoryEngine.predict() (5.6)
   *  2. Buffer is non-empty → PrefixTrie.lookup(buffer) (5.2)
   *     a. No matches → empty ghost text (5.5)
   *     b. Matches → rank by history frequency (5.3), compute ghost (5.4)
   *  3. Memory prediction active + prefix doesn't match → dismiss (5.7)
   */
  suggest(buffer: string, history: CommandHistory): SuggestionResult {
    // 5.6 — empty buffer: delegate to memory predictor
    if (buffer === "") {
      return this._suggestFromMemory(history);
    }

    // 5.2 — prefix matching via trie
    const candidates = this.trie.lookup(buffer);

    // 5.5 — no matches → no ghost text
    if (candidates.length === 0) {
      return { ghost: "", confidence: 0, source: "none" };
    }

    // 5.3 — rank by history frequency, pick highest
    const best = this._rankByFrequency(candidates, history);

    // 5.4 — ghost = fullSuggestion.slice(buffer.length)
    const ghost = best.command.slice(buffer.length);
    const confidence = best.count > 0 ? Math.min(1, 0.5 + best.count * 0.05) : 0.5;

    return { ghost, confidence, source: "prefix" };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Build the trie from:
   *  1. All top-level commands in the corpus (e.g. "git", "npm")
   *  2. "command subcommand" compound strings (e.g. "git add", "git commit")
   *     so that "git a" matches "git add".
   */
  private _buildTrie(): void {
    // Insert top-level commands
    for (const cmd of this.corpus.commands) {
      this.trie.insert(cmd);
      this.trieEntries.add(cmd);
    }

    // Insert "cmd subcmd" compound strings
    for (const [cmd, subs] of this.corpus.subcommands) {
      for (const sub of subs) {
        const compound = `${cmd} ${sub}`;
        this.trie.insert(compound);
        this.trieEntries.add(compound);
      }
    }
  }

  /**
   * Rank candidates by their frequency in history.
   * Returns the candidate with the highest count (ties broken by first found).
   */
  private _rankByFrequency(
    candidates: string[],
    history: CommandHistory
  ): { command: string; count: number } {
    let best = { command: candidates[0]!, count: -1 };

    for (const candidate of candidates) {
      const count = countInHistory(candidate, history);
      if (count > best.count) {
        best = { command: candidate, count };
      }
    }

    return best;
  }

  /**
   * Delegate to the memory predictor when the buffer is empty (5.6).
   * Returns the highest-confidence prediction as ghost text.
   */
  private _suggestFromMemory(history: CommandHistory): SuggestionResult {
    if (!this.memoryPredictor) {
      return { ghost: "", confidence: 0, source: "none" };
    }

    const recentCommands = history.entries
      .slice(-10)
      .map((e) => e.command);

    const predictions = this.memoryPredictor.predict(recentCommands);

    if (predictions.length === 0) {
      return { ghost: "", confidence: 0, source: "none" };
    }

    // Pick the highest-confidence prediction
    const top = predictions.reduce((a, b) => (b.confidence > a.confidence ? b : a));

    return {
      ghost: top.command,
      confidence: top.confidence,
      source: "memory",
    };
  }

  // -------------------------------------------------------------------------
  // Accessors (for testing)
  // -------------------------------------------------------------------------

  /**
   * Returns the full set of strings inserted into the trie.
   * Used by property tests to verify that suggestions are valid completions.
   */
  getTrieEntries(): Set<string> {
    return new Set(this.trieEntries);
  }
}

// ---------------------------------------------------------------------------
// SuggestionEngine — thin wrapper that holds the active provider
// ---------------------------------------------------------------------------

/**
 * The SuggestionEngine coordinates the active SuggestionProvider.
 *
 * It also handles the "dismiss prediction on prefix mismatch" logic (5.7):
 * when a memory prediction is active and the user types a prefix that does
 * not match the predicted command, the prediction is dismissed.
 */
export class SuggestionEngine {
  private readonly provider: SuggestionProvider;

  constructor(provider: SuggestionProvider) {
    this.provider = provider;
  }

  /**
   * Get a suggestion for the current buffer.
   *
   * Implements 5.7: if the last result was from "memory" and the current
   * buffer does not match the start of the predicted command, dismiss.
   */
  suggest(buffer: string, history: CommandHistory): SuggestionResult {
    const result = this.provider.suggest(buffer, history);

    // 5.7 — dismiss memory prediction when prefix doesn't match
    if (result.source === "memory" && buffer !== "") {
      const fullPrediction = buffer + result.ghost;
      if (!fullPrediction.startsWith(buffer)) {
        return { ghost: "", confidence: 0, source: "none" };
      }
    }

    return result;
  }
}
