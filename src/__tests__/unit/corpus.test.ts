import { describe, it, expect, beforeEach } from "vitest";
import { PrefixTrie, KnownCommandsCorpus, STATIC_COMMANDS } from "../../corpus.js";

// ---------------------------------------------------------------------------
// 3.6 PrefixTrie unit tests
// ---------------------------------------------------------------------------

describe("PrefixTrie", () => {
  let trie: PrefixTrie;

  beforeEach(() => {
    trie = new PrefixTrie();
  });

  // --- insert + lookup ---

  it("returns the inserted word when looking up its exact string", () => {
    trie.insert("git");
    expect(trie.lookup("git")).toEqual(["git"]);
  });

  it("returns completions for a valid prefix", () => {
    trie.insert("git");
    trie.insert("grep");
    trie.insert("go");

    const results = trie.lookup("g");
    expect(results).toHaveLength(3);
    expect(results).toContain("git");
    expect(results).toContain("grep");
    expect(results).toContain("go");
  });

  it("returns only completions that share the given prefix", () => {
    trie.insert("git");
    trie.insert("grep");
    trie.insert("npm");

    const results = trie.lookup("gr");
    expect(results).toEqual(["grep"]);
  });

  it("returns an empty array when the prefix matches no entry", () => {
    trie.insert("git");
    trie.insert("npm");

    expect(trie.lookup("docker")).toEqual([]);
  });

  // --- empty prefix ---

  it("returns all inserted words when the prefix is an empty string", () => {
    trie.insert("git");
    trie.insert("npm");
    trie.insert("docker");

    const results = trie.lookup("");
    expect(results).toHaveLength(3);
    expect(results).toContain("git");
    expect(results).toContain("npm");
    expect(results).toContain("docker");
  });

  it("returns an empty array for an empty prefix when the trie is empty", () => {
    expect(trie.lookup("")).toEqual([]);
  });

  // --- no match ---

  it("returns an empty array when the trie is empty", () => {
    expect(trie.lookup("git")).toEqual([]);
  });

  it("returns an empty array when the prefix is longer than any inserted word", () => {
    trie.insert("git");
    expect(trie.lookup("github")).toEqual([]);
  });

  // --- idempotent insert ---

  it("does not duplicate results when the same word is inserted twice", () => {
    trie.insert("git");
    trie.insert("git");
    expect(trie.lookup("git")).toEqual(["git"]);
  });

  // --- multi-word completions ---

  it("handles commands with spaces (full command strings)", () => {
    trie.insert("git add");
    trie.insert("git commit");
    trie.insert("git push");

    const results = trie.lookup("git ");
    expect(results).toHaveLength(3);
    expect(results).toContain("git add");
    expect(results).toContain("git commit");
    expect(results).toContain("git push");
  });

  it("returns the prefix itself when it was inserted as a word", () => {
    trie.insert("git");
    trie.insert("git add");

    const results = trie.lookup("git");
    expect(results).toContain("git");
    expect(results).toContain("git add");
  });
});

// ---------------------------------------------------------------------------
// 3.7 KnownCommandsCorpus unit tests
// ---------------------------------------------------------------------------

describe("KnownCommandsCorpus", () => {
  let corpus: KnownCommandsCorpus;

  beforeEach(async () => {
    corpus = new KnownCommandsCorpus();
    await corpus.build();
  });

  // --- static list loaded ---

  it("includes all top-level commands from the static list", () => {
    for (const cmd of STATIC_COMMANDS.keys()) {
      expect(corpus.commands.has(cmd)).toBe(true);
    }
  });

  it("includes git in the commands set", () => {
    expect(corpus.commands.has("git")).toBe(true);
  });

  it("includes npm in the commands set", () => {
    expect(corpus.commands.has("npm")).toBe(true);
  });

  it("includes docker in the commands set", () => {
    expect(corpus.commands.has("docker")).toBe(true);
  });

  it("includes kubectl in the commands set", () => {
    expect(corpus.commands.has("kubectl")).toBe(true);
  });

  it("includes basic shell commands (cd, ls, mkdir, rm, cp, mv)", () => {
    for (const cmd of ["cd", "ls", "mkdir", "rm", "cp", "mv"]) {
      expect(corpus.commands.has(cmd)).toBe(true);
    }
  });

  it("includes curl, wget, ssh, scp, tar, zip, unzip", () => {
    for (const cmd of ["curl", "wget", "ssh", "scp", "tar", "zip", "unzip"]) {
      expect(corpus.commands.has(cmd)).toBe(true);
    }
  });

  // --- subcommands ---

  it("exposes git subcommands via the subcommands map", () => {
    const gitSubs = corpus.subcommands.get("git");
    expect(gitSubs).toBeDefined();
    for (const sub of [
      "init", "clone", "add", "commit", "push", "pull", "fetch",
      "merge", "rebase", "checkout", "branch", "status", "log",
      "diff", "stash", "tag", "remote", "reset", "clean", "cherry-pick",
    ]) {
      expect(gitSubs!.has(sub)).toBe(true);
    }
  });

  it("exposes npm subcommands via the subcommands map", () => {
    const npmSubs = corpus.subcommands.get("npm");
    expect(npmSubs).toBeDefined();
    for (const sub of [
      "install", "uninstall", "update", "run", "start", "test",
      "build", "publish", "init", "list", "outdated", "audit", "ci",
    ]) {
      expect(npmSubs!.has(sub)).toBe(true);
    }
  });

  it("exposes docker subcommands via the subcommands map", () => {
    const dockerSubs = corpus.subcommands.get("docker");
    expect(dockerSubs).toBeDefined();
    for (const sub of [
      "build", "run", "pull", "push", "ps", "images",
      "rm", "rmi", "exec", "logs", "stop", "start", "restart", "compose",
    ]) {
      expect(dockerSubs!.has(sub)).toBe(true);
    }
  });

  it("exposes kubectl subcommands via the subcommands map", () => {
    const kubeSubs = corpus.subcommands.get("kubectl");
    expect(kubeSubs).toBeDefined();
    for (const sub of [
      "get", "apply", "delete", "describe", "logs", "exec",
      "port-forward", "scale", "rollout", "create", "patch",
    ]) {
      expect(kubeSubs!.has(sub)).toBe(true);
    }
  });

  // --- trie ---

  it("trie returns completions for a known prefix", () => {
    const results = corpus.trie.lookup("git");
    expect(results).toContain("git");
  });

  it("trie returns multiple commands sharing a prefix", () => {
    const results = corpus.trie.lookup("g");
    expect(results).toContain("git");
    expect(results).toContain("grep");
  });

  it("trie returns empty array for an unknown prefix", () => {
    expect(corpus.trie.lookup("zzz_unknown_cmd_xyz")).toEqual([]);
  });

  // --- PATH executables included ---

  it("includes at least one executable from $PATH (node, npm, or sh)", async () => {
    // At least one of these should be on the PATH in any standard environment.
    const wellKnown = ["node", "npm", "sh", "bash", "ls", "cat"];
    const found = wellKnown.some((cmd) => corpus.commands.has(cmd));
    expect(found).toBe(true);
  });

  // --- rebuild is idempotent ---

  it("produces the same commands set after a second build() call", async () => {
    const firstSize = corpus.commands.size;
    await corpus.build();
    expect(corpus.commands.size).toBe(firstSize);
  });

  // --- subcommands map type ---

  it("subcommands values are Set instances", () => {
    for (const [, subs] of corpus.subcommands) {
      expect(subs).toBeInstanceOf(Set);
    }
  });
});
