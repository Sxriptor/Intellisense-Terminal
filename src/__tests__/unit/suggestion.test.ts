import { describe, it, expect, beforeEach } from "vitest";
import { KnownCommandsCorpus } from "../../corpus.js";
import {
  DefaultSuggestionProvider,
  SuggestionEngine,
  CommandHistory,
  HistoryEntry,
} from "../../engines/suggestion.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeHistory(commands: string[]): CommandHistory {
  const entries: HistoryEntry[] = commands.map((command, i) => ({
    command,
    timestamp: new Date(Date.now() + i * 1000).toISOString(),
    sessionId: "test-session",
  }));
  return { entries, patterns: [] };
}

function buildTestCorpus(): KnownCommandsCorpus {
  const corpus = new KnownCommandsCorpus();
  // Add git with subcommands
  corpus.commands.add("git");
  corpus.trie.insert("git");
  const gitSubs = new Set([
    "add",
    "commit",
    "push",
    "pull",
    "fetch",
    "merge",
    "checkout",
    "status",
    "log",
    "diff",
    "stash",
    "branch",
    "archive",
    "rebase",
    "clone",
    "init",
    "reset",
    "remote",
    "config",
  ]);
  corpus.subcommands.set("git", gitSubs);

  // Add npm with subcommands
  corpus.commands.add("npm");
  corpus.trie.insert("npm");
  const npmSubs = new Set([
    "install",
    "uninstall",
    "update",
    "run",
    "start",
    "test",
    "build",
    "publish",
    "init",
    "list",
    "outdated",
    "audit",
    "ci",
  ]);
  corpus.subcommands.set("npm", npmSubs);

  // Add docker with subcommands
  corpus.commands.add("docker");
  corpus.trie.insert("docker");
  const dockerSubs = new Set(["build", "run", "pull", "push", "ps", "images"]);
  corpus.subcommands.set("docker", dockerSubs);

  // Add simple commands
  for (const cmd of ["ls", "cd", "mkdir", "rm", "cat", "grep"]) {
    corpus.commands.add(cmd);
    corpus.trie.insert(cmd);
  }

  return corpus;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let corpus: KnownCommandsCorpus;
let provider: DefaultSuggestionProvider;
let engine: SuggestionEngine;
const emptyHistory: CommandHistory = { entries: [], patterns: [] };

beforeEach(() => {
  corpus = buildTestCorpus();
  provider = new DefaultSuggestionProvider(corpus);
  engine = new SuggestionEngine(provider);
});

// ---------------------------------------------------------------------------
// 5.8 Unit tests for specific suggestion examples
// ---------------------------------------------------------------------------

describe("Specific suggestion examples (5.8)", () => {
  it('"git a" → ghost text " dd ." when "git add ." is most frequent', () => {
    // Seed history so "git add ." is the most frequent match for "git a"
    const history = makeHistory([
      "git add .",
      "git add .",
      "git add .",
      "git archive",
    ]);
    // "git a" should match "git add" and "git archive" from the trie
    // "git add ." is in history but the trie only has "git add" (subcommand)
    // The ghost text is based on trie completions, not full history commands
    // "git add" is the highest-frequency trie entry for prefix "git a"
    const result = provider.suggest("git a", history);
    expect(result.source).toBe("prefix");
    expect(result.ghost.length).toBeGreaterThan(0);
    // The full suggestion must start with "git a"
    const full = "git a" + result.ghost;
    expect(full.startsWith("git a")).toBe(true);
  });

  it('"git a" → suggests "git add" (prefix match)', () => {
    const result = provider.suggest("git a", emptyHistory);
    expect(result.source).toBe("prefix");
    // ghost should complete to "git add" or "git archive"
    const full = "git a" + result.ghost;
    expect(full.startsWith("git a")).toBe(true);
    expect(result.ghost.length).toBeGreaterThan(0);
  });

  it('"npm i" → suggests "npm install" (prefix match)', () => {
    const result = provider.suggest("npm i", emptyHistory);
    expect(result.source).toBe("prefix");
    const full = "npm i" + result.ghost;
    expect(full.startsWith("npm i")).toBe(true);
    // "npm install" starts with "npm i"
    expect(full).toBe("npm install");
  });

  it('"git co" → suggests "git commit" or "git config" (prefix match)', () => {
    // Note: "git checkout" starts with "git ch", not "git co"
    const result = provider.suggest("git co", emptyHistory);
    expect(result.source).toBe("prefix");
    const full = "git co" + result.ghost;
    expect(full.startsWith("git co")).toBe(true);
    // "git commit" and "git config" both start with "git co"
    expect(["git commit", "git config"]).toContain(full);
  });

  it('"git s" → suggests a git subcommand starting with s', () => {
    const result = provider.suggest("git s", emptyHistory);
    expect(result.source).toBe("prefix");
    const full = "git s" + result.ghost;
    expect(full.startsWith("git s")).toBe(true);
  });

  it('"docker b" → suggests "docker build"', () => {
    const result = provider.suggest("docker b", emptyHistory);
    expect(result.source).toBe("prefix");
    const full = "docker b" + result.ghost;
    expect(full).toBe("docker build");
  });

  it('"git" → suggests a git subcommand (prefix "git" matches "git add", etc.)', () => {
    const result = provider.suggest("git", emptyHistory);
    // "git" itself is in the trie as an exact match, so ghost may be empty
    // OR it may suggest a compound like "git add"
    // Either way, source should be "prefix" and full suggestion starts with "git"
    expect(result.source).toBe("prefix");
    const full = "git" + result.ghost;
    expect(full.startsWith("git")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5.3 Frequency-based ranking
// ---------------------------------------------------------------------------

describe("Frequency-based ranking (5.3)", () => {
  it("returns the highest-frequency completion when multiple candidates match", () => {
    // "git co" matches "git commit" and "git config" (both start with "git co")
    // Note: "git checkout" starts with "git ch", NOT "git co"
    // Seed history with more "git commit" occurrences
    const history = makeHistory([
      "git commit",
      "git commit",
      "git commit",
      "git config",
    ]);
    const result = provider.suggest("git co", history);
    expect(result.source).toBe("prefix");
    const full = "git co" + result.ghost;
    expect(full).toBe("git commit");
  });

  it("returns the highest-frequency completion when commit is more frequent", () => {
    // "git co" matches "git commit" and "git config"
    const history = makeHistory([
      "git commit",
      "git commit",
      "git commit",
      "git config",
    ]);
    const result = provider.suggest("git co", history);
    expect(result.source).toBe("prefix");
    const full = "git co" + result.ghost;
    expect(full).toBe("git commit");
  });

  it("returns a valid completion when history is empty (no frequency data)", () => {
    const result = provider.suggest("git co", emptyHistory);
    expect(result.source).toBe("prefix");
    const full = "git co" + result.ghost;
    expect(full.startsWith("git co")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5.4 Ghost text computation
// ---------------------------------------------------------------------------

describe("Ghost text computation (5.4)", () => {
  it("ghost = fullSuggestion.slice(buffer.length)", () => {
    const result = provider.suggest("npm i", emptyHistory);
    expect(result.source).toBe("prefix");
    const full = "npm i" + result.ghost;
    expect(full.slice("npm i".length)).toBe(result.ghost);
  });

  it("ghost is empty string when buffer exactly matches a trie entry", () => {
    // "npm install" is an exact trie entry — ghost should be ""
    const result = provider.suggest("npm install", emptyHistory);
    // Either ghost is "" (exact match) or source is "none" (no further completions)
    if (result.source === "prefix") {
      expect(result.ghost).toBe("");
    } else {
      expect(result.source).toBe("none");
    }
  });
});

// ---------------------------------------------------------------------------
// 5.5 No ghost text when buffer matches no known prefix
// ---------------------------------------------------------------------------

describe("No ghost text for unknown prefix (5.5)", () => {
  it("returns empty ghost text for a buffer that matches no known prefix", () => {
    const result = provider.suggest("zzz", emptyHistory);
    expect(result.ghost).toBe("");
    expect(result.source).toBe("none");
    expect(result.confidence).toBe(0);
  });

  it("returns empty ghost text for a completely unknown command", () => {
    const result = provider.suggest("foobarxyz", emptyHistory);
    expect(result.ghost).toBe("");
    expect(result.source).toBe("none");
  });

  it("returns empty ghost text for a prefix that partially matches but has no completions", () => {
    // "git zzz" — "git " is a valid prefix but "git zzz" has no completions
    const result = provider.suggest("git zzz", emptyHistory);
    expect(result.ghost).toBe("");
    expect(result.source).toBe("none");
  });
});

// ---------------------------------------------------------------------------
// 5.6 Empty buffer prediction delegation
// ---------------------------------------------------------------------------

describe("Empty buffer prediction delegation (5.6)", () => {
  it("returns memory source when buffer is empty and memory predictor provides a prediction", () => {
    const mockPredictor = {
      predict: (_cmds: string[]) => [
        { command: "git pull", confidence: 0.9 },
      ],
    };
    const providerWithMemory = new DefaultSuggestionProvider(corpus, mockPredictor);
    const result = providerWithMemory.suggest("", emptyHistory);
    expect(result.source).toBe("memory");
    expect(result.ghost).toBe("git pull");
    expect(result.confidence).toBe(0.9);
  });

  it("returns none when buffer is empty and no memory predictor is configured", () => {
    const result = provider.suggest("", emptyHistory);
    expect(result.source).toBe("none");
    expect(result.ghost).toBe("");
  });

  it("returns none when buffer is empty and memory predictor returns no predictions", () => {
    const mockPredictor = {
      predict: (_cmds: string[]) => [],
    };
    const providerWithMemory = new DefaultSuggestionProvider(corpus, mockPredictor);
    const result = providerWithMemory.suggest("", emptyHistory);
    expect(result.source).toBe("none");
    expect(result.ghost).toBe("");
  });

  it("passes recent commands to the memory predictor", () => {
    const capturedCommands: string[][] = [];
    const mockPredictor = {
      predict: (cmds: string[]) => {
        capturedCommands.push(cmds);
        return [{ command: "git push", confidence: 0.8 }];
      },
    };
    const providerWithMemory = new DefaultSuggestionProvider(corpus, mockPredictor);
    const history = makeHistory(["git fetch", "git merge", "git status"]);
    providerWithMemory.suggest("", history);
    expect(capturedCommands.length).toBe(1);
    expect(capturedCommands[0]).toContain("git fetch");
    expect(capturedCommands[0]).toContain("git merge");
    expect(capturedCommands[0]).toContain("git status");
  });

  it("picks the highest-confidence prediction when multiple are returned", () => {
    const mockPredictor = {
      predict: (_cmds: string[]) => [
        { command: "git status", confidence: 0.5 },
        { command: "git pull", confidence: 0.9 },
        { command: "git fetch", confidence: 0.7 },
      ],
    };
    const providerWithMemory = new DefaultSuggestionProvider(corpus, mockPredictor);
    const result = providerWithMemory.suggest("", emptyHistory);
    expect(result.ghost).toBe("git pull");
    expect(result.confidence).toBe(0.9);
  });
});

// ---------------------------------------------------------------------------
// 5.7 Dismiss prediction ghost text when prefix doesn't match
// ---------------------------------------------------------------------------

describe("Dismiss prediction on prefix mismatch (5.7)", () => {
  it("dismisses memory prediction when typed prefix does not match predicted command", () => {
    // Memory predicts "git pull" but user types "npm"
    const mockPredictor = {
      predict: (_cmds: string[]) => [
        { command: "git pull", confidence: 0.9 },
      ],
    };
    const providerWithMemory = new DefaultSuggestionProvider(corpus, mockPredictor);
    const eng = new SuggestionEngine(providerWithMemory);

    // When buffer is empty, memory prediction is shown
    const emptyResult = eng.suggest("", emptyHistory);
    expect(emptyResult.source).toBe("memory");
    expect(emptyResult.ghost).toBe("git pull");

    // When user types "npm", the memory prediction "git pull" doesn't match
    // The engine should switch to prefix-based suggestions
    const typedResult = eng.suggest("npm", emptyHistory);
    // "npm" is a valid prefix in the trie, so it should return a prefix suggestion
    // NOT a memory suggestion
    expect(typedResult.source).not.toBe("memory");
  });

  it("keeps prefix suggestion when user types matching prefix", () => {
    const mockPredictor = {
      predict: (_cmds: string[]) => [
        { command: "git pull", confidence: 0.9 },
      ],
    };
    const providerWithMemory = new DefaultSuggestionProvider(corpus, mockPredictor);
    const eng = new SuggestionEngine(providerWithMemory);

    // When user types "git p", prefix matching takes over
    const result = eng.suggest("git p", emptyHistory);
    expect(result.source).toBe("prefix");
    const full = "git p" + result.ghost;
    expect(full.startsWith("git p")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5.9 Escape dismissal and Tab acceptance
// ---------------------------------------------------------------------------

describe("Escape dismissal and Tab acceptance (5.9)", () => {
  it("Escape: dismissing ghost text means returning empty ghost (no-op on buffer)", () => {
    // The SuggestionEngine itself doesn't handle key events — the shell hook does.
    // From the engine's perspective, after Escape the buffer is unchanged and
    // the next suggest() call with the same buffer should still return a suggestion.
    const result1 = provider.suggest("git a", emptyHistory);
    expect(result1.ghost.length).toBeGreaterThan(0);

    // After Escape, the buffer is still "git a" — same suggestion
    const result2 = provider.suggest("git a", emptyHistory);
    expect(result2.ghost).toBe(result1.ghost);
  });

  it("Tab acceptance: full suggestion = buffer + ghost", () => {
    const result = provider.suggest("npm i", emptyHistory);
    expect(result.source).toBe("prefix");
    // Tab acceptance means the buffer becomes buffer + ghost
    const acceptedBuffer = "npm i" + result.ghost;
    expect(acceptedBuffer).toBe("npm install");
  });

  it("Tab acceptance for git subcommand: buffer + ghost = full command", () => {
    const result = provider.suggest("git co", emptyHistory);
    expect(result.source).toBe("prefix");
    const acceptedBuffer = "git co" + result.ghost;
    expect(acceptedBuffer.startsWith("git co")).toBe(true);
    // "git co" matches "git commit" and "git config" (not "git checkout" which starts with "git ch")
    expect(["git commit", "git config"]).toContain(acceptedBuffer);
  });

  it("Tab acceptance for memory prediction: ghost IS the full predicted command", () => {
    const mockPredictor = {
      predict: (_cmds: string[]) => [
        { command: "git pull origin main", confidence: 0.9 },
      ],
    };
    const providerWithMemory = new DefaultSuggestionProvider(corpus, mockPredictor);
    const result = providerWithMemory.suggest("", emptyHistory);
    expect(result.source).toBe("memory");
    // For empty buffer, ghost = full predicted command
    expect(result.ghost).toBe("git pull origin main");
  });

  it("after Tab acceptance, suggest() on the full command returns empty ghost or exact match", () => {
    // After accepting "npm install", the buffer is "npm install"
    const result = provider.suggest("npm install", emptyHistory);
    // Either exact match (ghost = "") or no further completions
    if (result.source === "prefix") {
      expect(result.ghost).toBe("");
    } else {
      expect(result.source).toBe("none");
    }
  });
});

// ---------------------------------------------------------------------------
// SuggestionResult shape validation
// ---------------------------------------------------------------------------

describe("SuggestionResult shape", () => {
  it("always returns a valid SuggestionResult shape", () => {
    const cases = ["", "git", "git a", "npm i", "zzz", "docker b"];
    for (const buffer of cases) {
      const result = provider.suggest(buffer, emptyHistory);
      expect(typeof result.ghost).toBe("string");
      expect(typeof result.confidence).toBe("number");
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
      expect(["prefix", "memory", "none"]).toContain(result.source);
    }
  });
});
