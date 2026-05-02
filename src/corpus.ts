import { readdir, stat } from "node:fs/promises";
import { join, extname } from "node:path";
import { IS_WINDOWS } from "./paths.js";

// ---------------------------------------------------------------------------
// PrefixTrie
// ---------------------------------------------------------------------------

/**
 * A simple trie node used internally by PrefixTrie.
 */
interface TrieNode {
  children: Map<string, TrieNode>;
  /** True when this node marks the end of an inserted word. */
  isEnd: boolean;
}

function makeNode(): TrieNode {
  return { children: new Map(), isEnd: false };
}

/**
 * A prefix trie that supports O(k) insertion and O(k + m) prefix lookup,
 * where k is the length of the key/prefix and m is the number of results.
 *
 * All operations are case-sensitive.
 */
export class PrefixTrie {
  private readonly root: TrieNode = makeNode();

  /**
   * Insert a command string into the trie.
   * Inserting the same string multiple times is idempotent.
   */
  insert(command: string): void {
    let node = this.root;
    for (const ch of command) {
      let child = node.children.get(ch);
      if (child === undefined) {
        child = makeNode();
        node.children.set(ch, child);
      }
      node = child;
    }
    node.isEnd = true;
  }

  /**
   * Return all strings in the trie that start with `prefix`.
   *
   * - An empty prefix returns every string in the trie.
   * - Returns an empty array when no string matches the prefix.
   */
  lookup(prefix: string): string[] {
    // Walk to the node that represents the end of the prefix.
    let node = this.root;
    for (const ch of prefix) {
      const child = node.children.get(ch);
      if (child === undefined) {
        return [];
      }
      node = child;
    }

    // Collect all completions rooted at that node.
    const results: string[] = [];
    this._collect(node, prefix, results);
    return results;
  }

  /** DFS helper that appends all complete words reachable from `node`. */
  private _collect(node: TrieNode, current: string, results: string[]): void {
    if (node.isEnd) {
      results.push(current);
    }
    for (const [ch, child] of node.children) {
      this._collect(child, current + ch, results);
    }
  }
}

// ---------------------------------------------------------------------------
// Static command/subcommand list
// ---------------------------------------------------------------------------

/**
 * Bundled static list of common commands and their subcommands.
 * This is merged with $PATH executables at startup.
 */
export const STATIC_COMMANDS: ReadonlyMap<string, ReadonlyArray<string>> = new Map([
  [
    "git",
    [
      "init",
      "clone",
      "add",
      "commit",
      "push",
      "pull",
      "fetch",
      "merge",
      "rebase",
      "checkout",
      "branch",
      "status",
      "log",
      "diff",
      "stash",
      "tag",
      "remote",
      "reset",
      "clean",
      "cherry-pick",
      "archive",
      "bisect",
      "blame",
      "config",
      "describe",
      "format-patch",
      "gc",
      "grep",
      "mv",
      "notes",
      "reflog",
      "rm",
      "shortlog",
      "show",
      "submodule",
      "switch",
      "worktree",
    ],
  ],
  [
    "npm",
    [
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
      "cache",
      "config",
      "dedupe",
      "diff",
      "exec",
      "explain",
      "fund",
      "help",
      "link",
      "login",
      "logout",
      "pack",
      "ping",
      "prefix",
      "prune",
      "rebuild",
      "repo",
      "restart",
      "root",
      "search",
      "shrinkwrap",
      "stop",
      "token",
      "unlink",
      "version",
      "view",
      "whoami",
    ],
  ],
  [
    "docker",
    [
      "build",
      "run",
      "pull",
      "push",
      "ps",
      "images",
      "rm",
      "rmi",
      "exec",
      "logs",
      "stop",
      "start",
      "restart",
      "compose",
      "attach",
      "commit",
      "container",
      "context",
      "cp",
      "create",
      "diff",
      "events",
      "export",
      "history",
      "image",
      "import",
      "info",
      "inspect",
      "kill",
      "load",
      "login",
      "logout",
      "manifest",
      "network",
      "node",
      "pause",
      "plugin",
      "port",
      "rename",
      "save",
      "search",
      "secret",
      "service",
      "stack",
      "stats",
      "swarm",
      "system",
      "tag",
      "top",
      "trust",
      "unpause",
      "update",
      "version",
      "volume",
      "wait",
    ],
  ],
  [
    "kubectl",
    [
      "get",
      "apply",
      "delete",
      "describe",
      "logs",
      "exec",
      "port-forward",
      "scale",
      "rollout",
      "create",
      "patch",
      "annotate",
      "api-resources",
      "api-versions",
      "attach",
      "auth",
      "autoscale",
      "certificate",
      "cluster-info",
      "completion",
      "config",
      "cordon",
      "cp",
      "debug",
      "diff",
      "drain",
      "edit",
      "events",
      "explain",
      "expose",
      "kustomize",
      "label",
      "options",
      "proxy",
      "replace",
      "run",
      "set",
      "taint",
      "top",
      "uncordon",
      "version",
      "wait",
    ],
  ],
  // Simple commands with no tracked subcommands — empty array means the
  // command itself is added to the corpus but no subcommand entries are stored.
  ["cd", []],
  ["ls", []],
  ["mkdir", []],
  ["rm", []],
  ["cp", []],
  ["mv", []],
  ["cat", []],
  ["grep", []],
  ["find", []],
  ["echo", []],
  ["pwd", []],
  ["chmod", []],
  ["chown", []],
  ["curl", []],
  ["wget", []],
  ["ssh", []],
  ["scp", []],
  ["tar", []],
  ["zip", []],
  ["unzip", []],
  // Additional common commands
  ["node", []],
  ["npx", []],
  ["yarn", []],
  ["pnpm", []],
  ["python", []],
  ["python3", []],
  ["pip", []],
  ["pip3", []],
  ["make", []],
  ["cargo", []],
  ["rustc", []],
  ["go", []],
  ["java", []],
  ["javac", []],
  ["mvn", []],
  ["gradle", []],
  ["vim", []],
  ["nvim", []],
  ["nano", []],
  ["less", []],
  ["more", []],
  ["head", []],
  ["tail", []],
  ["sort", []],
  ["uniq", []],
  ["wc", []],
  ["awk", []],
  ["sed", []],
  ["cut", []],
  ["tr", []],
  ["xargs", []],
  ["tee", []],
  ["touch", []],
  ["ln", []],
  ["df", []],
  ["du", []],
  ["ps", []],
  ["top", []],
  ["kill", []],
  ["killall", []],
  ["which", []],
  ["whereis", []],
  ["man", []],
  ["history", []],
  ["alias", []],
  ["export", []],
  ["source", []],
  ["env", []],
  ["printenv", []],
  ["date", []],
  ["whoami", []],
  ["hostname", []],
  ["uname", []],
  ["uptime", []],
  ["free", []],
  ["lsof", []],
  ["netstat", []],
  ["ifconfig", []],
  ["ping", []],
  ["traceroute", []],
  ["nslookup", []],
  ["dig", []],
  ["rsync", []],
  ["mount", []],
  ["umount", []],
  ["crontab", []],
  ["systemctl", []],
  ["service", []],
  ["apt", []],
  ["apt-get", []],
  ["brew", []],
  ["yum", []],
  ["dnf", []],
  ["pacman", []],
]);

// ---------------------------------------------------------------------------
// KnownCommandsCorpus
// ---------------------------------------------------------------------------

/**
 * Builds and exposes the corpus of known commands used by the autocorrect
 * and suggestion engines.
 *
 * The corpus is assembled from two sources:
 *  1. A bundled static list of common commands and their subcommands.
 *  2. Executable files discovered by scanning every directory in $PATH.
 *
 * After `build()` completes:
 *  - `commands`    — flat set of all top-level command names
 *  - `subcommands` — map from command name → set of known subcommands
 *  - `trie`        — prefix trie containing every entry in `commands`
 */
export class KnownCommandsCorpus {
  /** All known top-level command names. */
  readonly commands: Set<string> = new Set();

  /**
   * Per-command subcommand sets.
   * e.g. subcommands.get("git") → Set { "add", "commit", "push", ... }
   */
  readonly subcommands: Map<string, Set<string>> = new Map();

  /** Prefix trie built from all entries in `commands`. */
  readonly trie: PrefixTrie = new PrefixTrie();

  /**
   * Build the corpus.
   *
   * Safe to call multiple times — each call resets and rebuilds from scratch.
   */
  async build(): Promise<void> {
    // Reset state
    this.commands.clear();
    this.subcommands.clear();
    // Replace the trie with a fresh instance
    (this as { trie: PrefixTrie }).trie = new PrefixTrie();

    // 1. Load the bundled static list
    this._loadStaticList();

    // 2. Scan $PATH for executables
    await this._loadPathExecutables();
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /** Populate commands and subcommands from the bundled static list. */
  private _loadStaticList(): void {
    for (const [cmd, subs] of STATIC_COMMANDS) {
      this._addCommand(cmd);
      for (const sub of subs) {
        this._addSubcommand(cmd, sub);
      }
    }
  }

  /**
   * Scan every directory listed in the PATH environment variable and add
   * executable file names to the commands set.
   */
  private async _loadPathExecutables(): Promise<void> {
    const pathEnv = process.env["PATH"] ?? "";
    // Windows uses semicolons as PATH separators; Unix uses colons.
    const separator = IS_WINDOWS ? ";" : ":";
    const dirs = pathEnv.split(separator).filter((d) => d.length > 0);

    await Promise.all(
      dirs.map(async (dir) => {
        try {
          const entries = await readdir(dir);
          await Promise.all(
            entries.map(async (entry) => {
              try {
                const fullPath = join(dir, entry);
                const info = await stat(fullPath);
                if (info.isFile() && this._isExecutable(info.mode, entry)) {
                  // On Windows, strip the extension so "git.exe" → "git"
                  const name = IS_WINDOWS ? _stripExeExtension(entry) : entry;
                  this._addCommand(name);
                }
              } catch {
                // Skip entries we cannot stat (broken symlinks, permission errors, etc.)
              }
            })
          );
        } catch {
          // Skip directories we cannot read (missing, permission errors, etc.)
        }
      })
    );
  }

  /**
   * Returns true when the file should be treated as an executable command.
   *
   * On Unix: checks the execute bits in the file mode.
   * On Windows: checks for known executable extensions (.exe, .cmd, .bat, .ps1, .com).
   */
  private _isExecutable(mode: number, filename: string): boolean {
    if (IS_WINDOWS) {
      const ext = extname(filename).toLowerCase();
      return [".exe", ".cmd", ".bat", ".ps1", ".com"].includes(ext);
    }
    // Owner, group, or other execute bit
    // eslint-disable-next-line no-bitwise
    return (mode & 0o111) !== 0;
  }

  /** Add a top-level command to the corpus and trie. */
  private _addCommand(name: string): void {
    if (!this.commands.has(name)) {
      this.commands.add(name);
      this.trie.insert(name);
    }
  }

  /** Add a subcommand entry for the given parent command. */
  private _addSubcommand(command: string, sub: string): void {
    let set = this.subcommands.get(command);
    if (set === undefined) {
      set = new Set();
      this.subcommands.set(command, set);
    }
    set.add(sub);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Strip common Windows executable extensions from a filename.
 * e.g. "git.exe" → "git", "npm.cmd" → "npm"
 */
function _stripExeExtension(filename: string): string {
  const ext = extname(filename).toLowerCase();
  if ([".exe", ".cmd", ".bat", ".ps1", ".com"].includes(ext)) {
    return filename.slice(0, filename.length - ext.length);
  }
  return filename;
}
