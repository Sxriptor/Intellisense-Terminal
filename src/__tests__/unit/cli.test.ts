/**
 * Unit tests for CLI commands (Task 10.11, 10.12).
 *
 * Tests verify:
 *  - Correct output for each command
 *  - Error messages and non-zero exit codes
 *  - init command bash/zsh snippet content
 *
 * Strategy: mock process.stdout.write, process.stderr.write, and
 * process.exit to capture output and exit codes without actually exiting.
 * File system operations use real temp directories.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  cmdStart,
  cmdStop,
  cmdStatus,
  cmdInit,
  cmdSetup,
  cmdCorrections,
  cmdConfigSet,
  cmdConfigGet,
  cmdConfigList,
  cmdHistoryClear,
} from "../../cli.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "tac-cli-test-"));
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Capture stdout and stderr writes during an async operation.
 * Also intercepts process.exit to prevent the test process from exiting.
 */
async function captureOutput(fn: () => Promise<void>): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number | null;
}> {
  let stdout = "";
  let stderr = "";
  let exitCode: number | null = null;

  const stdoutSpy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk: unknown) => {
      stdout += String(chunk);
      return true;
    });

  const stderrSpy = vi
    .spyOn(process.stderr, "write")
    .mockImplementation((chunk: unknown) => {
      stderr += String(chunk);
      return true;
    });

  const exitSpy = vi.spyOn(process, "exit").mockImplementation((code?: number | string) => {
    exitCode = typeof code === "number" ? code : code !== undefined ? parseInt(String(code), 10) : 0;
    throw new ExitError(exitCode);
  });

  try {
    await fn();
  } catch (err) {
    if (!(err instanceof ExitError)) {
      throw err;
    }
  } finally {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    exitSpy.mockRestore();
  }

  return { stdout, stderr, exitCode };
}

/** Sentinel error thrown when process.exit is called in tests. */
class ExitError extends Error {
  constructor(public readonly code: number) {
    super(`process.exit(${code})`);
    this.name = "ExitError";
  }
}

// ---------------------------------------------------------------------------
// 10.2 — start command
// ---------------------------------------------------------------------------

describe("cmdStart", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeTempDir();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("prints 'already running' message when daemon is already running", async () => {
    const pidFilePath = join(dir, "daemon.pid");

    // Write the current process PID — it is definitely alive
    await writeFile(pidFilePath, `${process.pid}\n`, "utf-8");

    const { stdout, exitCode } = await captureOutput(async () => {
      await cmdStart({ pidFilePath, daemonEntryPath: "/nonexistent/daemon-entry.js" });
    });

    expect(stdout).toContain("already running");
    expect(stdout).toContain(String(process.pid));
    expect(exitCode).toBeNull(); // no exit called
  });

  it("starts daemon and writes PID file when no daemon is running", async () => {
    const pidFilePath = join(dir, "daemon.pid");

    // Inject a fake spawn that returns a child with pid=12345 immediately,
    // without actually launching a process. This avoids hanging on Windows.
    const fakeSpawn = () => ({ pid: 12345, unref: () => {} });

    const { stdout } = await captureOutput(async () => {
      await cmdStart({
        pidFilePath,
        daemonEntryPath: "/fake/daemon-entry.js",
        spawnFn: fakeSpawn as never,
      });
    });

    expect(stdout).toContain("Daemon started");
    expect(await fileExists(pidFilePath)).toBe(true);
  });

  it("starts daemon when PID file exists but process is dead", async () => {
    const pidFilePath = join(dir, "daemon.pid");
    // Write a PID that is very unlikely to be alive
    await writeFile(pidFilePath, "999999999\n", "utf-8");

    const fakeSpawn = () => ({ pid: 99001, unref: () => {} });

    const { stdout } = await captureOutput(async () => {
      await cmdStart({
        pidFilePath,
        daemonEntryPath: "/fake/daemon-entry.js",
        spawnFn: fakeSpawn as never,
      });
    });

    expect(stdout).toContain("Daemon started");
  });
});

// ---------------------------------------------------------------------------
// 10.3 — stop command
// ---------------------------------------------------------------------------

describe("cmdStop", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeTempDir();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("exits with non-zero code when no PID file exists", async () => {
    const pidFilePath = join(dir, "daemon.pid");

    const { stderr, exitCode } = await captureOutput(async () => {
      await cmdStop({ pidFilePath });
    });

    expect(stderr).toContain("No daemon is currently running");
    expect(exitCode).toBe(1);
  });

  it("exits with non-zero code when PID file exists but process is dead", async () => {
    const pidFilePath = join(dir, "daemon.pid");
    await writeFile(pidFilePath, "999999999\n", "utf-8");

    const { stderr, exitCode } = await captureOutput(async () => {
      await cmdStop({ pidFilePath });
    });

    expect(stderr).toContain("No daemon is currently running");
    expect(exitCode).toBe(1);
  });

  it("sends SIGTERM and prints success when daemon is running", async () => {
    const pidFilePath = join(dir, "daemon.pid");

    // Write the current process PID — inject a no-op killFn to avoid
    // actually killing ourselves (works on both Unix and Windows).
    await writeFile(pidFilePath, `${process.pid}\n`, "utf-8");

    const { stdout, exitCode } = await captureOutput(async () => {
      await cmdStop({ pidFilePath, killFn: () => { /* no-op */ } });
    });

    expect(stdout).toContain("Daemon stopped");
    expect(stdout).toContain(String(process.pid));
    expect(exitCode).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 10.4 — status command
// ---------------------------------------------------------------------------

describe("cmdStatus", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeTempDir();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("prints 'stopped' when no PID file exists", async () => {
    const pidFilePath = join(dir, "daemon.pid");

    const { stdout } = await captureOutput(async () => {
      await cmdStatus({ pidFilePath });
    });

    expect(stdout).toContain("stopped");
  });

  it("prints 'stopped' when PID file exists but process is dead", async () => {
    const pidFilePath = join(dir, "daemon.pid");
    await writeFile(pidFilePath, "999999999\n", "utf-8");

    const { stdout } = await captureOutput(async () => {
      await cmdStatus({ pidFilePath });
    });

    expect(stdout).toContain("stopped");
  });

  it("prints 'running' with PID when daemon is alive", async () => {
    const pidFilePath = join(dir, "daemon.pid");
    await writeFile(pidFilePath, `${process.pid}\n`, "utf-8");

    const { stdout } = await captureOutput(async () => {
      await cmdStatus({ pidFilePath });
    });

    expect(stdout).toContain("running");
    expect(stdout).toContain(String(process.pid));
  });
});

// ---------------------------------------------------------------------------
// 10.5 — init command (10.12: verify bash and zsh snippets)
// ---------------------------------------------------------------------------

describe("cmdInit", () => {
  it("outputs zsh hook snippet containing required function names", async () => {
    const { stdout } = await captureOutput(async () => {
      cmdInit("zsh");
    });

    // Required zsh hook functions
    expect(stdout).toContain("_tac_preexec");
    expect(stdout).toContain("_tac_zle_widget");
    expect(stdout).toContain("add-zsh-hook");
    expect(stdout).toContain("preexec");
  });

  it("outputs zsh hook snippet with ANSI escape codes for ghost text", async () => {
    const { stdout } = await captureOutput(async () => {
      cmdInit("zsh");
    });

    // ANSI dim escape for ghost text rendering
    expect(stdout).toContain("\\033[2m");
    expect(stdout).toContain("\\033[0m");
  });

  it("outputs zsh hook snippet with Tab binding", async () => {
    const { stdout } = await captureOutput(async () => {
      cmdInit("zsh");
    });

    expect(stdout).toContain("bindkey");
    expect(stdout).toContain("^I");
  });

  it("outputs bash hook snippet containing required function names", async () => {
    const { stdout } = await captureOutput(async () => {
      cmdInit("bash");
    });

    // Required bash hook functions
    expect(stdout).toContain("_tac_preexec");
    expect(stdout).toContain("_tac_precmd");
  });

  it("outputs bash hook snippet with ANSI escape codes for ghost text", async () => {
    const { stdout } = await captureOutput(async () => {
      cmdInit("bash");
    });

    expect(stdout).toContain("\\033[2m");
    expect(stdout).toContain("\\033[0m");
  });

  it("outputs bash hook snippet with PROMPT_COMMAND fallback", async () => {
    const { stdout } = await captureOutput(async () => {
      cmdInit("bash");
    });

    expect(stdout).toContain("PROMPT_COMMAND");
  });

  it("exits with non-zero code for unsupported shell", async () => {
    const { stderr, exitCode } = await captureOutput(async () => {
      cmdInit("fish");
    });

    expect(stderr).toContain("Unsupported shell");
    expect(stderr).toContain("fish");
    expect(exitCode).toBe(1);
  });

  it("zsh snippet contains IPC call for autocorrect", async () => {
    const { stdout } = await captureOutput(async () => {
      cmdInit("zsh");
    });

    expect(stdout).toContain("terminalsense --ipc correct");
  });

  it("bash snippet contains IPC call for autocorrect", async () => {
    const { stdout } = await captureOutput(async () => {
      cmdInit("bash");
    });

    expect(stdout).toContain("terminalsense --ipc correct");
  });

  it("outputs powershell hook snippet containing required elements", async () => {
    const { stdout } = await captureOutput(async () => {
      cmdInit("powershell");
    });

    expect(stdout).toContain("_TacSend");
    expect(stdout).toContain("Set-PSReadLineKeyHandler");
    expect(stdout).toContain("tac --ipc");
    expect(stdout).toContain("PreCommandLookupAction");
  });
});

// ---------------------------------------------------------------------------
// 10.6 — corrections command
// ---------------------------------------------------------------------------

describe("cmdSetup", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeTempDir();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("installs the hook file and updates the shell profile", async () => {
    const homeDir = dir;
    const tacHome = join(dir, ".terminal-autocorrect");
    const profilePath = join(dir, ".zshrc");
    let started = false;

    const { stdout, exitCode } = await captureOutput(async () => {
      await cmdSetup({
        shell: "zsh",
        homeDir,
        tacHome,
        profilePaths: [profilePath],
        hookFilePath: join(tacHome, "tac-hook.zsh"),
        startDaemon: false,
        startFn: async () => {
          started = true;
        },
      });
    });

    expect(stdout).toContain("Installed hook file");
    expect(stdout).toContain("Updated profile files");
    expect(started).toBe(false);
    expect(exitCode).toBeNull();

    const hookContents = await readFile(join(tacHome, "tac-hook.zsh"), "utf-8");
    expect(hookContents).toContain("_tac_preexec");
    expect(hookContents).toContain("terminalsense --ipc correct");

    const profileContents = await readFile(profilePath, "utf-8");
    expect(profileContents).toContain("terminalsense setup");
    expect(profileContents).toContain(`source "${join(tacHome, "tac-hook.zsh")}"`);
  });
});

describe("cmdCorrections", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeTempDir();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("exits with non-zero code when daemon is not running", async () => {
    // Use a socket/pipe path that has no listener — works on all platforms.
    // On Windows, named pipes use \\.\pipe\name format; on Unix, a .sock file path.
    const socketPath = process.platform === "win32"
      ? "\\\\.\\pipe\\tac-test-nonexistent-" + Date.now()
      : join(dir, "daemon.sock");

    const { stderr, exitCode } = await captureOutput(async () => {
      await cmdCorrections({ socketPath });
    });

    expect(stderr).toContain("Could not connect to daemon");
    expect(exitCode).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 10.7 — config set command
// ---------------------------------------------------------------------------

describe("cmdConfigSet", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeTempDir();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("sets a valid integer config key", async () => {
    const configPath = join(dir, "config.json");

    const { stdout, exitCode } = await captureOutput(async () => {
      await cmdConfigSet("maxEditDistance", "3", { configPath });
    });

    expect(stdout).toContain("maxEditDistance");
    expect(stdout).toContain("3");
    expect(exitCode).toBeNull();

    // Verify the value was persisted
    const raw = await readFile(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.maxEditDistance).toBe(3);
  });

  it("sets a valid boolean config key", async () => {
    const configPath = join(dir, "config.json");

    const { stdout } = await captureOutput(async () => {
      await cmdConfigSet("enabled", "false", { configPath });
    });

    expect(stdout).toContain("enabled");
    expect(stdout).toContain("false");

    const raw = await readFile(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.enabled).toBe(false);
  });

  it("sets a valid string config key", async () => {
    const configPath = join(dir, "config.json");

    const { stdout } = await captureOutput(async () => {
      await cmdConfigSet("suggestionColor", "blue", { configPath });
    });

    expect(stdout).toContain("suggestionColor");
    expect(stdout).toContain("blue");
  });

  it("exits with non-zero code for unknown key", async () => {
    const configPath = join(dir, "config.json");

    const { stderr, exitCode } = await captureOutput(async () => {
      await cmdConfigSet("unknownKey", "value", { configPath });
    });

    expect(stderr).toContain("Unknown configuration key");
    expect(stderr).toContain("unknownKey");
    expect(exitCode).toBe(1);
  });

  it("exits with non-zero code for invalid value type (string for integer key)", async () => {
    const configPath = join(dir, "config.json");

    const { stderr, exitCode } = await captureOutput(async () => {
      await cmdConfigSet("maxEditDistance", "notanumber", { configPath });
    });

    expect(stderr).toContain("Invalid value");
    expect(exitCode).toBe(1);
  });

  it("exits with non-zero code for invalid boolean value", async () => {
    const configPath = join(dir, "config.json");

    const { stderr, exitCode } = await captureOutput(async () => {
      await cmdConfigSet("enabled", "yes", { configPath });
    });

    expect(stderr).toContain("Invalid value");
    expect(exitCode).toBe(1);
  });

  it("does not modify config when key is invalid", async () => {
    const configPath = join(dir, "config.json");

    // Create initial config
    await captureOutput(async () => {
      await cmdConfigSet("maxEditDistance", "2", { configPath });
    });

    const before = await readFile(configPath, "utf-8");

    await captureOutput(async () => {
      await cmdConfigSet("badKey", "value", { configPath });
    });

    const after = await readFile(configPath, "utf-8");
    expect(after).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// 10.8 — config get command
// ---------------------------------------------------------------------------

describe("cmdConfigGet", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeTempDir();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("displays the default value for a key when no config file exists", async () => {
    const configPath = join(dir, "config.json");

    const { stdout, exitCode } = await captureOutput(async () => {
      await cmdConfigGet("maxEditDistance", { configPath });
    });

    expect(stdout).toContain("maxEditDistance");
    expect(stdout).toContain("2"); // default value
    expect(exitCode).toBeNull();
  });

  it("displays the updated value after config set", async () => {
    const configPath = join(dir, "config.json");

    await captureOutput(async () => {
      await cmdConfigSet("maxEditDistance", "5", { configPath });
    });

    const { stdout } = await captureOutput(async () => {
      await cmdConfigGet("maxEditDistance", { configPath });
    });

    expect(stdout).toContain("5");
  });

  it("exits with non-zero code for unknown key", async () => {
    const configPath = join(dir, "config.json");

    const { stderr, exitCode } = await captureOutput(async () => {
      await cmdConfigGet("unknownKey", { configPath });
    });

    expect(stderr).toContain("Unknown configuration key");
    expect(exitCode).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 10.9 — config list command
// ---------------------------------------------------------------------------

describe("cmdConfigList", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeTempDir();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("lists all configuration keys", async () => {
    const configPath = join(dir, "config.json");

    const { stdout } = await captureOutput(async () => {
      await cmdConfigList({ configPath });
    });

    // All required keys should appear
    expect(stdout).toContain("maxEditDistance");
    expect(stdout).toContain("maxHistoryEntries");
    expect(stdout).toContain("historyPath");
    expect(stdout).toContain("suggestionColor");
    expect(stdout).toContain("enabled");
    expect(stdout).toContain("autocorrectEnabled");
    expect(stdout).toContain("suggestionsEnabled");
    expect(stdout).toContain("memoryEnabled");
  });

  it("lists default values when no config file exists", async () => {
    const configPath = join(dir, "config.json");

    const { stdout } = await captureOutput(async () => {
      await cmdConfigList({ configPath });
    });

    expect(stdout).toContain("maxEditDistance = 2");
    expect(stdout).toContain("maxHistoryEntries = 10000");
    expect(stdout).toContain("enabled = true");
  });

  it("reflects updated values after config set", async () => {
    const configPath = join(dir, "config.json");

    await captureOutput(async () => {
      await cmdConfigSet("maxEditDistance", "4", { configPath });
    });

    const { stdout } = await captureOutput(async () => {
      await cmdConfigList({ configPath });
    });

    expect(stdout).toContain("maxEditDistance = 4");
  });
});

// ---------------------------------------------------------------------------
// 10.10 — history clear command
// ---------------------------------------------------------------------------

describe("cmdHistoryClear", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeTempDir();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("deletes history file when confirmed with --yes flag", async () => {
    const historyPath = join(dir, "history.json");
    await writeFile(historyPath, JSON.stringify({ entries: [], patterns: [] }), "utf-8");

    const { stdout, exitCode } = await captureOutput(async () => {
      await cmdHistoryClear({ yes: true, historyPath });
    });

    expect(stdout).toContain("History cleared");
    expect(await fileExists(historyPath)).toBe(false);
    expect(exitCode).toBeNull();
  });

  it("deletes history file when skipPrompt is true", async () => {
    const historyPath = join(dir, "history.json");
    await writeFile(historyPath, JSON.stringify({ entries: [], patterns: [] }), "utf-8");

    const { stdout } = await captureOutput(async () => {
      await cmdHistoryClear({ skipPrompt: true, historyPath });
    });

    expect(stdout).toContain("History cleared");
    expect(await fileExists(historyPath)).toBe(false);
  });

  it("prints 'No history file found' when history file does not exist", async () => {
    const historyPath = join(dir, "history.json");

    const { stdout, exitCode } = await captureOutput(async () => {
      await cmdHistoryClear({ yes: true, historyPath });
    });

    expect(stdout).toContain("No history file found");
    expect(exitCode).toBeNull();
  });

  it("cancels when user declines confirmation (skipPrompt=false, yes=false)", async () => {
    const historyPath = join(dir, "history.json");
    await writeFile(historyPath, JSON.stringify({ entries: [], patterns: [] }), "utf-8");

    const { stdout } = await captureOutput(async () => {
      await cmdHistoryClear({
        historyPath,
        confirmFn: async () => "n",
      });
    });

    expect(stdout).toContain("cancelled");
    expect(await fileExists(historyPath)).toBe(true);
  });
});

