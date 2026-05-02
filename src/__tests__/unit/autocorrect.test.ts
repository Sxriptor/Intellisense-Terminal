import { describe, it, expect, beforeEach } from "vitest";
import { KnownCommandsCorpus } from "../../corpus.js";
import {
  AutocorrectEngine,
  FuzzyMatcher,
  GIT_CORRECTIONS,
} from "../../engines/autocorrect.js";

// ---------------------------------------------------------------------------
// Shared corpus setup
// ---------------------------------------------------------------------------

let corpus: KnownCommandsCorpus;
let engine: AutocorrectEngine;

beforeEach(async () => {
  corpus = new KnownCommandsCorpus();
  await corpus.build();
  engine = new AutocorrectEngine(corpus, { maxEditDistance: 2 });
});

// ---------------------------------------------------------------------------
// 4.9 Unit tests for each built-in git correction rule
// ---------------------------------------------------------------------------

describe("Built-in git correction rules", () => {
  // Verify every key in GIT_CORRECTIONS is handled
  for (const [typo, correction] of Object.entries(GIT_CORRECTIONS)) {
    it(`corrects "git ${typo}" → "git ${correction}"`, () => {
      const result = engine.correct(`git ${typo}`);
      expect(result.status).toBe("corrected");
      expect(result.corrected).toBe(`git ${correction}`);
    });
  }

  it('corrects "git meg origin main" → "git merge origin main" (preserves extra tokens)', () => {
    const result = engine.correct("git meg origin main");
    expect(result.status).toBe("corrected");
    expect(result.corrected).toBe("git merge origin main");
  });

  it('corrects "git comit -m msg" → "git commit -m msg" (preserves flags)', () => {
    const result = engine.correct("git comit -m msg");
    expect(result.status).toBe("corrected");
    expect(result.corrected).toBe("git commit -m msg");
  });

  it('corrects "git chekout main" → "git checkout main" (preserves branch arg)', () => {
    const result = engine.correct("git chekout main");
    expect(result.status).toBe("corrected");
    expect(result.corrected).toBe("git checkout main");
  });

  it('corrects "git statsu" → "git status"', () => {
    const result = engine.correct("git statsu");
    expect(result.status).toBe("corrected");
    expect(result.corrected).toBe("git status");
  });

  it('corrects "git stauts" → "git status"', () => {
    const result = engine.correct("git stauts");
    expect(result.status).toBe("corrected");
    expect(result.corrected).toBe("git status");
  });

  it('corrects "git psuh origin main" → "git push origin main"', () => {
    const result = engine.correct("git psuh origin main");
    expect(result.status).toBe("corrected");
    expect(result.corrected).toBe("git push origin main");
  });
});

// ---------------------------------------------------------------------------
// 4.10 Edge cases
// ---------------------------------------------------------------------------

describe("Edge cases", () => {
  // Empty input
  it("returns unchanged for empty string", () => {
    const result = engine.correct("");
    expect(result.status).toBe("unchanged");
    expect(result.original).toBe("");
  });

  it("returns unchanged for whitespace-only input", () => {
    const result = engine.correct("   ");
    expect(result.status).toBe("unchanged");
  });

  // Single known token
  it("returns unchanged for a single known command with no subcommand", () => {
    const result = engine.correct("git");
    expect(result.status).toBe("unchanged");
    expect(result.original).toBe("git");
  });

  it("returns unchanged for a single known command (ls)", () => {
    const result = engine.correct("ls");
    expect(result.status).toBe("unchanged");
  });

  // Distance exactly at threshold (should correct)
  it("corrects when edit distance equals maxEditDistance (distance = 2)", () => {
    // "gitt" → "git" has distance 1; use a token with distance exactly 2
    // "gitt" has distance 1 from "git"; "giit" also 1; "giitt" has distance 2
    // Let's use a custom engine with maxEditDistance=2 and a small corpus
    const smallCorpus = new KnownCommandsCorpus();
    // Manually add a command to test threshold
    smallCorpus.commands.add("git");
    smallCorpus.trie.insert("git");

    const eng2 = new AutocorrectEngine(smallCorpus, { maxEditDistance: 2 });
    // "giit" → distance("giit","git") = 1 ≤ 2 → corrected
    const r1 = eng2.correct("giit");
    expect(r1.status).toBe("corrected");
    expect(r1.corrected).toBe("git");

    // "giiit" → distance("giiit","git") = 2 ≤ 2 → corrected
    const r2 = eng2.correct("giiit");
    expect(r2.status).toBe("corrected");
    expect(r2.corrected).toBe("git");
  });

  // Distance one above threshold (should NOT correct)
  it("returns unchanged when edit distance is one above maxEditDistance", () => {
    // maxEditDistance = 2; use a token with distance 3 from all known commands
    // "giiiit" → distance from "git" = 3 > 2 → unchanged
    const smallCorpus = new KnownCommandsCorpus();
    smallCorpus.commands.add("git");
    smallCorpus.trie.insert("git");

    const eng2 = new AutocorrectEngine(smallCorpus, { maxEditDistance: 2 });
    const result = eng2.correct("giiiit");
    // distance("giiiit","git") = 3 > 2
    expect(result.status).toBe("unchanged");
  });

  // Unknown command with no close match
  it("returns unknown for a completely unrecognized command far from all known commands", () => {
    const smallCorpus = new KnownCommandsCorpus();
    smallCorpus.commands.add("git");
    smallCorpus.trie.insert("git");

    const eng2 = new AutocorrectEngine(smallCorpus, { maxEditDistance: 2 });
    // "xyzabc" is far from "git"
    const result = eng2.correct("xyzabc");
    expect(result.status).toBe("unchanged");
  });

  // Known command with correct subcommand
  it("returns unchanged when subcommand is already correct", () => {
    const result = engine.correct("git commit");
    expect(result.status).toBe("unchanged");
  });

  // Known command with no subcommands tracked
  it("returns unchanged for a known command with no tracked subcommands", () => {
    const result = engine.correct("ls -la");
    expect(result.status).toBe("unchanged");
  });
});

// ---------------------------------------------------------------------------
// Ambiguity detection (4.4)
// ---------------------------------------------------------------------------

describe("Ambiguity detection", () => {
  it("returns ambiguous when two corpus entries tie at minimum distance", () => {
    // Build a corpus with two entries equidistant from the typo
    const smallCorpus = new KnownCommandsCorpus();
    smallCorpus.commands.add("abc");
    smallCorpus.commands.add("abd");
    smallCorpus.trie.insert("abc");
    smallCorpus.trie.insert("abd");

    const eng = new AutocorrectEngine(smallCorpus, { maxEditDistance: 2 });
    // "abe" → distance("abe","abc") = 1, distance("abe","abd") = 1 → tie
    const result = eng.correct("abe");
    expect(result.status).toBe("ambiguous");
    expect(result.candidates).toContain("abc");
    expect(result.candidates).toContain("abd");
  });

  it("does not include corrected field when ambiguous", () => {
    const smallCorpus = new KnownCommandsCorpus();
    smallCorpus.commands.add("abc");
    smallCorpus.commands.add("abd");
    smallCorpus.trie.insert("abc");
    smallCorpus.trie.insert("abd");

    const eng = new AutocorrectEngine(smallCorpus, { maxEditDistance: 2 });
    const result = eng.correct("abe");
    expect(result.status).toBe("ambiguous");
    expect(result.corrected).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Token preservation (4.8)
// ---------------------------------------------------------------------------

describe("Token preservation", () => {
  it("preserves flags after corrected command", () => {
    const result = engine.correct("git comit --amend");
    expect(result.status).toBe("corrected");
    expect(result.corrected).toBe("git commit --amend");
  });

  it("preserves multiple arguments after corrected subcommand", () => {
    const result = engine.correct("git chekout -b feature/my-branch");
    expect(result.status).toBe("corrected");
    expect(result.corrected).toBe("git checkout -b feature/my-branch");
  });

  it("preserves all tokens when correcting the first token", () => {
    // Use a small corpus where "gitt" → "git" is unambiguous
    const smallCorpus = new KnownCommandsCorpus();
    smallCorpus.commands.add("git");
    smallCorpus.trie.insert("git");

    const eng = new AutocorrectEngine(smallCorpus, { maxEditDistance: 2 });
    const result = eng.correct("gitt status --short");
    expect(result.status).toBe("corrected");
    expect(result.corrected).toBe("git status --short");
  });
});

// ---------------------------------------------------------------------------
// FuzzyMatcher unit tests
// ---------------------------------------------------------------------------

describe("FuzzyMatcher", () => {
  const matcher = new FuzzyMatcher();

  it("returns empty array for empty corpus", () => {
    expect(matcher.findClosest("git", [])).toEqual([]);
  });

  it("returns the single closest match", () => {
    const results = matcher.findClosest("gitt", ["git", "npm", "docker"]);
    expect(results).toHaveLength(1);
    expect(results[0]!.token).toBe("git");
    expect(results[0]!.distance).toBe(1);
  });

  it("returns all tied matches when multiple entries share minimum distance", () => {
    const results = matcher.findClosest("abe", ["abc", "abd", "xyz"]);
    expect(results).toHaveLength(2);
    const tokens = results.map((r) => r.token);
    expect(tokens).toContain("abc");
    expect(tokens).toContain("abd");
  });

  it("returns exact match with distance 0", () => {
    const results = matcher.findClosest("git", ["git", "npm"]);
    expect(results).toHaveLength(1);
    expect(results[0]!.token).toBe("git");
    expect(results[0]!.distance).toBe(0);
  });
});
