import { distance } from "fastest-levenshtein";
import type { KnownCommandsCorpus } from "../corpus.js";
import { getDefaultCorrectionsDictionary } from "../corrections-dictionary.js";
import type { CorrectionsDictionaryManager } from "../corrections-dictionary.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AutocorrectResult {
  status: "corrected" | "ambiguous" | "unchanged" | "unknown";
  corrected?: string;
  candidates?: string[];
  original: string;
}

export interface MatchResult {
  token: string;
  distance: number;
}

export interface AutocorrectEngineOptions {
  maxEditDistance?: number;
  correctionsDictionary?: CorrectionsDictionaryManager;
}

// ---------------------------------------------------------------------------
// Built-in git correction rules (4.6)
// Applied before fuzzy matching for performance (4.7)
// ---------------------------------------------------------------------------

export const GIT_CORRECTIONS: Record<string, string> = {
  // merge variants
  meg: "merge",
  mege: "merge",
  mrge: "merge",
  merg: "merge",
  // checkout variants
  chekout: "checkout",
  chekcout: "checkout",
  chekotu: "checkout",
  chekout2: "checkout",
  ckeckout: "checkout",
  // commit variants
  comit: "commit",
  comitt: "commit",
  commti: "commit",
  comiit: "commit",
  // status variants
  statsu: "status",
  stauts: "status",
  staus: "status",
  sttaus: "status",
  // push variants
  psuh: "push",
  pus: "push",
  // pull variants
  pul: "pull",
  plul: "pull",
  // branch variants
  barnch: "branch",
  branh: "branch",
  brach: "branch",
  // fetch variants
  ftch: "fetch",
  fecth: "fetch",
  // rebase variants
  reabse: "rebase",
  rebas: "rebase",
  // stash variants
  stsh: "stash",
  stas: "stash",
  // diff variants
  dif: "diff",
  dff: "diff",
  // log variants
  lgo: "log",
  // add variants
  ad: "add",
  // clone variants
  clon: "clone",
  cloen: "clone",
  // init variants
  iint: "init",
  inti: "init",
  // reset variants
  rset: "reset",
  resett: "reset",
  // remote variants
  remtoe: "remote",
  reomte: "remote",
};

// ---------------------------------------------------------------------------
// FuzzyMatcher (4.1)
// ---------------------------------------------------------------------------

/**
 * Uses `fastest-levenshtein` to find the closest entries in a corpus
 * for a given token. Returns all entries tied at the minimum distance.
 */
export class FuzzyMatcher {
  /**
   * Find the closest matches for `token` within `corpus`.
   *
   * Returns all MatchResult entries that share the minimum edit distance.
   * If the corpus is empty, returns an empty array.
   */
  findClosest(token: string, corpus: string[]): MatchResult[] {
    if (corpus.length === 0) return [];

    let minDist = Infinity;
    const results: MatchResult[] = [];

    for (const entry of corpus) {
      const d = distance(token, entry);
      if (d < minDist) {
        minDist = d;
        results.length = 0;
        results.push({ token: entry, distance: d });
      } else if (d === minDist) {
        results.push({ token: entry, distance: d });
      }
    }

    return results;
  }
}

// ---------------------------------------------------------------------------
// AutocorrectEngine (4.2 – 4.8)
// ---------------------------------------------------------------------------

/**
 * The main autocorrect engine.
 *
 * Tokenizes the input, checks the first token against the corpus, and
 * optionally checks the second token (subcommand) when the first token is
 * a known command.
 *
 * Built-in git correction rules are applied before fuzzy matching.
 */
export class AutocorrectEngine {
  private readonly corpus: KnownCommandsCorpus;
  private readonly maxEditDistance: number;
  private readonly fuzzy: FuzzyMatcher;
  private readonly corrections: CorrectionsDictionaryManager;

  constructor(corpus: KnownCommandsCorpus, options: AutocorrectEngineOptions = {}) {
    this.corpus = corpus;
    this.maxEditDistance = options.maxEditDistance ?? 2;
    this.fuzzy = new FuzzyMatcher();
    this.corrections = options.correctionsDictionary ?? getDefaultCorrectionsDictionary();
  }

  /**
   * Attempt to autocorrect `input`.
   *
   * Decision tree:
   *  1. Empty input → status "unchanged"
   *  2. First token is in Known_Commands:
   *     a. No second token → status "unchanged"
   *     b. Second token is a known subcommand → status "unchanged"
   *     c. Second token is unknown → apply built-in rules (if git), then fuzzy
   *        match against known subcommands
   *  3. First token is NOT in Known_Commands:
   *     a. Apply built-in git rules (if applicable) — not used here since we
   *        don't know the command yet; fuzzy match against all commands
   *     b. Fuzzy match against all known commands
   */
  correct(input: string): AutocorrectResult {
    const original = input;

    // 4.10 edge case: empty input
    if (!input.trim()) {
      return { status: "unchanged", original };
    }

    const tokens = input.trim().split(/\s+/);
    const firstToken = tokens[0]!;

    // Check if first token is a known command
    if (this.corpus.commands.has(firstToken)) {
      // First token is known — check subcommand (4.5)
      return this._correctSubcommand(tokens, original);
    }

    // First token is unknown — fuzzy match against all commands (4.2, 4.3, 4.4)
    return this._correctCommand(tokens, original);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * First token is a known command. Try to correct the subcommand token.
   */
  private _correctSubcommand(tokens: string[], original: string): AutocorrectResult {
    const command = tokens[0]!;

    if (tokens.length < 2) {
      // Single known token, nothing to correct
      return { status: "unchanged", original };
    }

    const subToken = tokens[1]!;
    const knownSubs = this.corpus.subcommands.get(command);

    if (!knownSubs || knownSubs.size === 0) {
      // No known subcommands for this command
      return { status: "unchanged", original };
    }

    // If subcommand is already correct, leave unchanged
    if (knownSubs.has(subToken)) {
      return { status: "unchanged", original };
    }

    // Check corrections dictionary first (replaces built-in git rules)
    const dictionaryCorrection = this.corrections.getCorrection(command, subToken);
    if (dictionaryCorrection && knownSubs.has(dictionaryCorrection)) {
      const corrected = this._rebuildCommand(tokens, 1, dictionaryCorrection);
      return { status: "corrected", corrected, original };
    }

    // Fuzzy match against known subcommands
    const subCorpus = Array.from(knownSubs);
    const matches = this.fuzzy.findClosest(subToken, subCorpus);

    return this._resolveMatches(matches, tokens, 1, original);
  }

  /**
   * First token is unknown. Try to correct it against all known commands.
   */
  private _correctCommand(tokens: string[], original: string): AutocorrectResult {
    const firstToken = tokens[0]!;

    // Check corrections dictionary first for command-level corrections
    const dictionaryCorrection = this.corrections.getCommandCorrection(firstToken);
    if (dictionaryCorrection && this.corpus.commands.has(dictionaryCorrection)) {
      const corrected = this._rebuildCommand(tokens, 0, dictionaryCorrection);
      return { status: "corrected", corrected, original };
    }

    // Fuzzy match against all known commands
    const commandCorpus = Array.from(this.corpus.commands);
    const matches = this.fuzzy.findClosest(firstToken, commandCorpus);

    return this._resolveMatches(matches, tokens, 0, original);
  }

  /**
   * Given fuzzy match results, apply threshold and ambiguity checks.
   *
   * @param matches   - Results from FuzzyMatcher.findClosest
   * @param tokens    - Full token array
   * @param tokenIdx  - Index of the token being corrected
   * @param original  - Original input string
   */
  private _resolveMatches(
    matches: MatchResult[],
    tokens: string[],
    tokenIdx: number,
    original: string
  ): AutocorrectResult {
    if (matches.length === 0) {
      return { status: "unknown", original };
    }

    const minDist = matches[0]!.distance;

    // 4.3 Threshold check (Req 3.5): distance must be ≤ maxEditDistance
    if (minDist > this.maxEditDistance) {
      return { status: "unchanged", original };
    }

    // 4.4 Ambiguity check (Req 3.6): two or more entries share the minimum distance
    if (matches.length > 1) {
      const candidates = matches.map((m) => m.token);
      return { status: "ambiguous", candidates, original };
    }

    // Single unambiguous match within threshold
    const corrected = this._rebuildCommand(tokens, tokenIdx, matches[0]!.token);
    return { status: "corrected", corrected, original };
  }

  /**
   * Rebuild the full command string, replacing the token at `tokenIdx`
   * with `replacement`. All other tokens are preserved unchanged (4.8).
   */
  private _rebuildCommand(tokens: string[], tokenIdx: number, replacement: string): string {
    const rebuilt = [...tokens];
    rebuilt[tokenIdx] = replacement;
    return rebuilt.join(" ");
  }
}
