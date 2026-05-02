import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MemoryEngine } from "../../engines/memory.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "tac-memory-test-"));
}

function historyPath(dir: string): string {
  return join(dir, "history.json");
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let dir: string;
let engine: MemoryEngine;

beforeEach(async () => {
  dir = await makeTempDir();
  engine = new MemoryEngine(historyPath(dir), { maxHistoryEntries: 10 });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 6.1 / 6.2 — Pattern recording
// ---------------------------------------------------------------------------

describe("Pattern recording", () => {
  it("records a command and adds it to history", () => {
    engine.record("git fetch", "session1");
    const history = engine.getHistory();
    expect(history.entries).toHaveLength(1);
    expect(history.entries[0]!.command).toBe("git fetch");
    expect(history.entries[0]!.sessionId).toBe("session1");
  });

  it("records a UTC ISO 8601 timestamp for each entry", () => {
    const before = Date.now();
    engine.record("git status", "session1");
    const after = Date.now();
    const history = engine.getHistory();
    const ts = new Date(history.entries[0]!.timestamp).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it("creates a pattern after two consecutive commands", () => {
    engine.record("git fetch", "session1");
    engine.record("git checkout main", "session1");
    const history = engine.getHistory();
    expect(history.patterns).toHaveLength(1);
    expect(history.patterns[0]!.trigger).toBe("git fetch");
    expect(history.patterns[0]!.prediction).toBe("git checkout {branch}");
    expect(history.patterns[0]!.count).toBe(1);
  });

  it("increments pattern count when the same pair is observed again", () => {
    engine.record("git fetch", "session1");
    engine.record("git checkout main", "session1");
    engine.record("git fetch", "session1");
    engine.record("git checkout develop", "session1");
    const history = engine.getHistory();
    const pattern = history.patterns.find(
      (p) => p.trigger === "git fetch" && p.prediction === "git checkout {branch}"
    );
    expect(pattern).toBeDefined();
    expect(pattern!.count).toBe(2);
  });

  it("creates separate patterns for different pairs", () => {
    engine.record("git fetch", "session1");
    engine.record("git status", "session1");
    engine.record("git status", "session1");
    engine.record("git commit", "session1");
    const history = engine.getHistory();
    // Pairs: (fetch→status), (status→status), (status→commit) = 3 patterns
    expect(history.patterns).toHaveLength(3);
    const triggers = history.patterns.map((p) => p.trigger);
    expect(triggers).toContain("git fetch");
    expect(triggers).toContain("git status");
  });

  it("does not create a pattern for the first command (no previous)", () => {
    engine.record("git fetch", "session1");
    const history = engine.getHistory();
    expect(history.patterns).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 6.5 — Prediction threshold (count ≥ 2)
// ---------------------------------------------------------------------------

describe("Prediction threshold", () => {
  it("does not predict when pattern count is 1", () => {
    engine.record("git fetch", "session1");
    engine.record("git checkout main", "session1");
    const predictions = engine.predict(["git fetch"]);
    expect(predictions).toHaveLength(0);
  });

  it("predicts when pattern count reaches 2", () => {
    engine.record("git fetch", "session1");
    engine.record("git checkout main", "session1");
    engine.record("git fetch", "session1");
    engine.record("git checkout develop", "session1");
    const predictions = engine.predict(["git fetch"]);
    expect(predictions).toHaveLength(1);
    // Branch substitution: most recent checkout was "develop"
    expect(predictions[0]!.command).toBe("git checkout develop");
  });

  it("predicts when pattern count is greater than 2", () => {
    for (let i = 0; i < 5; i++) {
      engine.record("npm install", "session1");
      engine.record("npm test", "session1");
    }
    const predictions = engine.predict(["npm install"]);
    expect(predictions).toHaveLength(1);
    expect(predictions[0]!.command).toBe("npm test");
  });

  it("returns empty array when no commands are provided", () => {
    const predictions = engine.predict([]);
    expect(predictions).toHaveLength(0);
  });

  it("returns empty array when no matching pattern exists", () => {
    engine.record("git fetch", "session1");
    engine.record("git status", "session1");
    engine.record("git fetch", "session1");
    engine.record("git status", "session1");
    const predictions = engine.predict(["npm install"]);
    expect(predictions).toHaveLength(0);
  });

  it("confidence is in [0, 1] for all predictions", () => {
    for (let i = 0; i < 10; i++) {
      engine.record("git fetch", "session1");
      engine.record("git status", "session1");
    }
    const predictions = engine.predict(["git fetch"]);
    for (const p of predictions) {
      expect(p.confidence).toBeGreaterThanOrEqual(0);
      expect(p.confidence).toBeLessThanOrEqual(1);
    }
  });
});

// ---------------------------------------------------------------------------
// 6.6 / 6.7 — Branch variable extraction and substitution
// ---------------------------------------------------------------------------

describe("Branch variable handling", () => {
  it("normalizes git checkout <branch> to git checkout {branch} in patterns", () => {
    engine.record("git fetch", "session1");
    engine.record("git checkout feature-x", "session1");
    const history = engine.getHistory();
    const pattern = history.patterns[0]!;
    expect(pattern.prediction).toBe("git checkout {branch}");
  });

  it("normalizes git pull origin <branch> to git pull origin {branch} in patterns", () => {
    engine.record("git checkout main", "session1");
    engine.record("git pull origin main", "session1");
    const history = engine.getHistory();
    const pattern = history.patterns[0]!;
    expect(pattern.trigger).toBe("git checkout {branch}");
    expect(pattern.prediction).toBe("git pull origin {branch}");
  });

  it("substitutes actual branch name in prediction", () => {
    // Build up pattern count to ≥ 2
    engine.record("git checkout main", "session1");
    engine.record("git pull origin main", "session1");
    engine.record("git checkout develop", "session1");
    engine.record("git pull origin develop", "session1");

    // Now predict after "git checkout feature-y"
    const predictions = engine.predict(["git checkout feature-y"]);
    expect(predictions).toHaveLength(1);
    expect(predictions[0]!.command).toBe("git pull origin feature-y");
  });

  it("uses most recent checkout branch for substitution", () => {
    engine.record("git checkout main", "session1");
    engine.record("git pull origin main", "session1");
    engine.record("git checkout develop", "session1");
    engine.record("git pull origin develop", "session1");

    // Most recent checkout in recentCommands is "git checkout hotfix"
    const predictions = engine.predict(["git checkout main", "git checkout hotfix"]);
    expect(predictions).toHaveLength(1);
    expect(predictions[0]!.command).toBe("git pull origin hotfix");
  });

  it("does not predict when {branch} cannot be substituted", () => {
    // Build pattern: git checkout {branch} → git pull origin {branch}
    engine.record("git checkout main", "session1");
    engine.record("git pull origin main", "session1");
    engine.record("git checkout develop", "session1");
    engine.record("git pull origin develop", "session1");

    // Predict with a non-checkout trigger that has no branch context
    const predictions = engine.predict(["git fetch"]);
    expect(predictions).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 6.8 — History cap
// ---------------------------------------------------------------------------

describe("History cap", () => {
  it("caps history at maxHistoryEntries", () => {
    // maxHistoryEntries is 10 for this engine
    for (let i = 0; i < 15; i++) {
      engine.record(`command-${i}`, "session1");
    }
    const history = engine.getHistory();
    expect(history.entries).toHaveLength(10);
  });

  it("removes oldest entries when cap is exceeded", () => {
    for (let i = 0; i < 12; i++) {
      engine.record(`command-${i}`, "session1");
    }
    const history = engine.getHistory();
    // Oldest 2 entries (command-0, command-1) should be removed
    expect(history.entries[0]!.command).toBe("command-2");
    expect(history.entries[history.entries.length - 1]!.command).toBe("command-11");
  });

  it("keeps exactly maxHistoryEntries after adding one beyond cap", () => {
    const eng = new MemoryEngine(historyPath(dir), { maxHistoryEntries: 5 });
    for (let i = 0; i < 5; i++) {
      eng.record(`cmd-${i}`, "session1");
    }
    eng.record("cmd-5", "session1");
    const history = eng.getHistory();
    expect(history.entries).toHaveLength(5);
    expect(history.entries[0]!.command).toBe("cmd-1");
    expect(history.entries[4]!.command).toBe("cmd-5");
  });
});

// ---------------------------------------------------------------------------
// 6.9 — Load and save
// ---------------------------------------------------------------------------

describe("Load and save", () => {
  it("creates an empty history file when none exists", async () => {
    await engine.load();
    const raw = await readFile(historyPath(dir), "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.version).toBe(1);
    expect(parsed.entries).toEqual([]);
    expect(parsed.patterns).toEqual([]);
  });

  it("persists history to disk and reloads it", async () => {
    await engine.load();
    engine.record("git fetch", "session1");
    engine.record("git status", "session1");
    await engine.flush();

    const engine2 = new MemoryEngine(historyPath(dir), { maxHistoryEntries: 10 });
    await engine2.load();
    const history = engine2.getHistory();
    expect(history.entries).toHaveLength(2);
    expect(history.entries[0]!.command).toBe("git fetch");
    expect(history.entries[1]!.command).toBe("git status");
  });

  it("persists patterns to disk and reloads them", async () => {
    await engine.load();
    engine.record("git fetch", "session1");
    engine.record("git status", "session1");
    engine.record("git fetch", "session1");
    engine.record("git status", "session1");
    await engine.flush();

    const engine2 = new MemoryEngine(historyPath(dir), { maxHistoryEntries: 10 });
    await engine2.load();
    const history = engine2.getHistory();
    // Pairs: (fetch→status) count=2, (status→fetch) count=1
    const fetchToStatus = history.patterns.find(
      (p) => p.trigger === "git fetch" && p.prediction === "git status"
    );
    expect(fetchToStatus).toBeDefined();
    expect(fetchToStatus!.count).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 6.10 — Corrupt file recovery
// ---------------------------------------------------------------------------

describe("Corrupt file recovery", () => {
  it("renames corrupt file to .bak", async () => {
    await writeFile(historyPath(dir), "{ this is not valid json }", "utf-8");
    await engine.load();

    // .bak file should exist
    await expect(access(`${historyPath(dir)}.bak`)).resolves.toBeUndefined();
  });

  it("creates a new empty history file after corrupt recovery", async () => {
    await writeFile(historyPath(dir), "CORRUPT DATA", "utf-8");
    await engine.load();

    const raw = await readFile(historyPath(dir), "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.entries).toEqual([]);
    expect(parsed.patterns).toEqual([]);
  });

  it("starts with empty history after corrupt recovery", async () => {
    await writeFile(historyPath(dir), "null", "utf-8");
    await engine.load();

    const history = engine.getHistory();
    expect(history.entries).toHaveLength(0);
    expect(history.patterns).toHaveLength(0);
  });

  it("recovers from a history file that is valid JSON but wrong structure", async () => {
    await writeFile(historyPath(dir), JSON.stringify({ foo: "bar" }), "utf-8");
    await engine.load();

    const history = engine.getHistory();
    expect(history.entries).toHaveLength(0);
  });

  it("recovers from a history file that is a JSON array", async () => {
    await writeFile(historyPath(dir), JSON.stringify([1, 2, 3]), "utf-8");
    await engine.load();

    const history = engine.getHistory();
    expect(history.entries).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// History clear
// ---------------------------------------------------------------------------

describe("History clear", () => {
  it("clears all entries and patterns from memory", async () => {
    await engine.load();
    engine.record("git fetch", "session1");
    engine.record("git status", "session1");
    engine.record("git fetch", "session1");
    engine.record("git status", "session1");

    await engine.clear();

    const history = engine.getHistory();
    expect(history.entries).toHaveLength(0);
    expect(history.patterns).toHaveLength(0);
  });

  it("persists the cleared state to disk", async () => {
    await engine.load();
    engine.record("git fetch", "session1");
    await engine.clear();

    const raw = await readFile(historyPath(dir), "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.entries).toEqual([]);
    expect(parsed.patterns).toEqual([]);
  });
});
