#!/usr/bin/env node
/**
 * CLI entry point for terminalsense.
 *
 * Binary names: `terminalsense` and `tac` (alias).
 *
 * Commands:
 *   setup [shell]      Install the shell hook and start the daemon
 *   start              Launch the daemon as a detached background process
 *   stop               Send SIGTERM to the running daemon
 *   status             Print whether the daemon is running or stopped
 *   init <shell>       Output the shell hook snippet for bash or zsh
 *   corrections        Query the daemon for the session corrections log
 *   config set <k> <v> Set a configuration key
 *   config get <k>     Get a configuration key
 *   config list        List all configuration keys and values
 *   history clear      Delete all history after confirmation
 */

import { spawn, execSync } from "node:child_process";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { unlink } from "node:fs/promises";

import { Command } from "commander";

import { ConfigManager, VALID_CONFIG_KEYS, DEFAULT_CONFIG } from "./config.js";
import { IPCClient } from "./ipc.js";
import type { IPCRequest } from "./ipc.js";
import { PID_FILE_PATH, SOCKET_PATH, HISTORY_PATH, IS_WINDOWS } from "./paths.js";
import { readPidFile, writePidFile } from "./storage.js";
import { getShellHook } from "./shell-hook.js";
import { installShellSetup, resolveShell } from "./setup.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Check whether a process with the given PID is alive.
 * Uses `process.kill(pid, 0)` which throws if the process does not exist.
 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Parse a string value into the appropriate type for a config key.
 * Returns the typed value or throws an error with a descriptive message.
 */
function parseConfigValue(key: string, rawValue: string): string | number | boolean {
  const numberKeys: ReadonlyArray<string> = ["maxEditDistance", "maxHistoryEntries"];
  const booleanKeys: ReadonlyArray<string> = [
    "enabled",
    "autocorrectEnabled",
    "suggestionsEnabled",
    "memoryEnabled",
  ];

  if (numberKeys.includes(key)) {
    const n = Number(rawValue);
    if (!Number.isInteger(n) || isNaN(n)) {
      throw new Error(`Invalid value for "${key}": expected an integer, got "${rawValue}"`);
    }
    return n;
  }

  if (booleanKeys.includes(key)) {
    if (rawValue === "true") return true;
    if (rawValue === "false") return false;
    throw new Error(
      `Invalid value for "${key}": expected "true" or "false", got "${rawValue}"`
    );
  }

  // String keys: historyPath, suggestionColor, suggestionProvider, memoryProvider
  return rawValue;
}

/**
 * Prompt the user for a yes/no confirmation.
 * Resolves to `true` if the user types "y" or "yes" (case-insensitive).
 *
 * The optional `promptFn` parameter allows tests to inject a custom prompt
 * implementation without needing to mock the readline module.
 */
async function confirm(
  question: string,
  promptFn?: (q: string) => Promise<string>
): Promise<boolean> {
  if (promptFn !== undefined) {
    const answer = await promptFn(question);
    return answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes";
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes");
    });
  });
}

// ---------------------------------------------------------------------------
// CLI command implementations
// ---------------------------------------------------------------------------

/**
 * 10.2 — `start` command
 *
 * Checks for an existing PID lock file. If a daemon is already running,
 * prints a message and exits without launching a second instance.
 * Otherwise, spawns `node dist/daemon-entry.js` as a detached child process
 * and writes the PID to the lock file.
 */
export async function cmdStart(options: {
  pidFilePath?: string;
  daemonEntryPath?: string;
  /** Injectable spawn function for testing — defaults to node:child_process spawn */
  spawnFn?: typeof spawn;
} = {}): Promise<void> {
  const pidFilePath = options.pidFilePath ?? PID_FILE_PATH;
  const spawnFn = options.spawnFn ?? spawn;

  // Check for existing daemon
  const existingPid = await readPidFile(pidFilePath);
  if (existingPid !== null && isProcessAlive(existingPid)) {
    process.stdout.write(`Daemon is already running (PID ${existingPid}).\n`);
    return;
  }

  // Resolve the daemon entry point
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const daemonEntry =
    options.daemonEntryPath ?? join(__dirname, "daemon-entry.js");

  // Spawn the daemon as a detached child process
  const child = spawnFn(process.execPath, [daemonEntry], {
    detached: true,
    stdio: "ignore",
  });

  child.unref();

  const pid = child.pid;
  if (pid === undefined) {
    process.stderr.write("Failed to start daemon: could not get child PID.\n");
    process.exit(1);
  }

  // Write PID to lock file
  await writePidFile(pidFilePath, pid);

  process.stdout.write(`Daemon started (PID ${pid}).\n`);
}

/**
 * 10.3 — `stop` command
 *
 * Reads the PID from the lock file and terminates the daemon.
 *
 * On Unix: sends SIGTERM.
 * On Windows: uses `taskkill /PID <pid> /F` because SIGTERM is not reliably
 * delivered to Node.js processes by external callers on Windows.
 */
export async function cmdStop(options: {
  pidFilePath?: string;
  /** Injectable kill function for testing — defaults to platform-appropriate kill */
  killFn?: (pid: number) => void;
} = {}): Promise<void> {
  const pidFilePath = options.pidFilePath ?? PID_FILE_PATH;

  const pid = await readPidFile(pidFilePath);

  if (pid === null || !isProcessAlive(pid)) {
    process.stderr.write("No daemon is currently running.\n");
    process.exit(1);
  }

  const killFn = options.killFn ?? ((p: number) => {
    if (IS_WINDOWS) {
      // taskkill sends WM_CLOSE then forcefully terminates (/F) if needed.
      execSync(`taskkill /PID ${p} /F`, { stdio: "ignore" });
    } else {
      process.kill(p, "SIGTERM");
    }
  });

  try {
    killFn(pid);
    process.stdout.write(`Daemon stopped (PID ${pid}).\n`);
  } catch (err) {
    process.stderr.write(`Failed to stop daemon: ${String(err)}\n`);
    process.exit(1);
  }
}

/**
 * 10.4 — `status` command
 *
 * Checks the lock file and process liveness, then prints "running" or
 * "stopped".
 */
export async function cmdStatus(options: { pidFilePath?: string } = {}): Promise<void> {
  const pidFilePath = options.pidFilePath ?? PID_FILE_PATH;

  const pid = await readPidFile(pidFilePath);

  if (pid !== null && isProcessAlive(pid)) {
    process.stdout.write(`running (PID ${pid})\n`);
  } else {
    process.stdout.write("stopped\n");
  }
}

/**
 * 10.5 — `init <shell>` command
 *
 * Outputs the shell hook snippet for the given shell.
 * Supported: bash, zsh, powershell (Windows PowerShell / pwsh)
 */
export function cmdInit(shell: string): void {
  if (shell !== "bash" && shell !== "zsh" && shell !== "powershell") {
    process.stderr.write(
      `Unsupported shell: "${shell}". Supported shells: bash, zsh, powershell\n`
    );
    process.exit(1);
  }

  const snippet = getShellHook(shell as "bash" | "zsh" | "powershell");

  // Close stdin immediately so the npm wrapper's pipeline detection
  // doesn't cause Node.js to hang waiting for input to end.
  // Then write the snippet and exit explicitly.
  try {
    process.stdin.destroy();
  } catch {
    // ignore — stdin may already be closed
  }

  process.stdout.write(snippet, () => {
    process.exit(0);
  });
}

/**
 * 10.6 — `corrections` command
 *
 * Queries the daemon via IPC for the session corrections log.
 */
/**
 * 10.6 - `setup [shell]` command
 *
 * Installs the shell hook into the user's profile and starts the daemon.
 */
export async function cmdSetup(options: {
  shell?: string;
  homeDir?: string;
  tacHome?: string;
  profilePaths?: string[];
  hookFilePath?: string;
  startDaemon?: boolean;
  startFn?: () => Promise<void>;
} = {}): Promise<void> {
  let shell: "bash" | "zsh" | "powershell";
  try {
    shell = resolveShell(options.shell);
  } catch (err) {
    process.stderr.write(`${String(err)}\n`);
    process.exit(1);
    return;
  }

  const result = await installShellSetup({
    shell,
    homeDir: options.homeDir,
    tacHome: options.tacHome,
    profilePaths: options.profilePaths,
    hookFilePath: options.hookFilePath,
  });

  process.stdout.write(`Installed hook file: ${result.hookFilePath}\n`);

  if (result.updatedProfiles.length > 0) {
    process.stdout.write("Updated profile files:\n");
    for (const profilePath of result.updatedProfiles) {
      process.stdout.write(`  ${profilePath}\n`);
    }
  } else {
    process.stdout.write("Shell profile already contained the setup line.\n");
  }

  if (options.startDaemon === false) {
    return;
  }

  if (options.startFn !== undefined) {
    await options.startFn();
  } else {
    await cmdStart();
  }

  process.stdout.write(
    "Setup complete. Reload your shell or open a new terminal session to activate it.\n"
  );
}

export async function cmdCorrections(options: { socketPath?: string } = {}): Promise<void> {
  const socketPath = options.socketPath ?? SOCKET_PATH;

  const client = new IPCClient();
  const request: IPCRequest = {
    type: "corrections",
    sessionId: randomUUID(),
    requestId: randomUUID(),
  };

  const response = await client.send(socketPath, request, 2000);

  if (response === null) {
    process.stderr.write(
      "Could not connect to daemon. Is it running? Try: terminalsense start\n"
    );
    process.exit(1);
  }

  if (!response.ok) {
    process.stderr.write(`Daemon error: ${response.error ?? "unknown error"}\n`);
    process.exit(1);
  }

  const corrections = response.data?.corrections ?? [];

  if (corrections.length === 0) {
    process.stdout.write("No corrections in this session.\n");
    return;
  }

  for (const record of corrections) {
    process.stdout.write(
      `[${record.timestamp}] ${record.original} → ${record.corrected}\n`
    );
  }
}

/**
 * 10.7 — `config set <key> <value>` command
 *
 * Validates the key and type, then updates the config file.
 */
export async function cmdConfigSet(
  key: string,
  rawValue: string,
  options: { configPath?: string } = {}
): Promise<void> {
  // Validate key
  if (!VALID_CONFIG_KEYS.includes(key as keyof typeof DEFAULT_CONFIG)) {
    process.stderr.write(
      `Unknown configuration key: "${key}". Valid keys are: ${VALID_CONFIG_KEYS.join(", ")}\n`
    );
    process.exit(1);
  }

  // Parse and validate value
  let typedValue: string | number | boolean;
  try {
    typedValue = parseConfigValue(key, rawValue);
  } catch (err) {
    process.stderr.write(`${String(err)}\n`);
    process.exit(1);
  }

  // Load, update, and save config
  const manager = new ConfigManager(options.configPath);
  await manager.load();

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    manager.set(key as any, typedValue as any);
  } catch (err) {
    process.stderr.write(`${String(err)}\n`);
    process.exit(1);
  }

  await manager.save();
  process.stdout.write(`Set ${key} = ${String(typedValue)}\n`);
}

/**
 * 10.8 — `config get <key>` command
 *
 * Validates the key and displays the current value.
 */
export async function cmdConfigGet(
  key: string,
  options: { configPath?: string } = {}
): Promise<void> {
  // Validate key
  if (!VALID_CONFIG_KEYS.includes(key as keyof typeof DEFAULT_CONFIG)) {
    process.stderr.write(
      `Unknown configuration key: "${key}". Valid keys are: ${VALID_CONFIG_KEYS.join(", ")}\n`
    );
    process.exit(1);
  }

  const manager = new ConfigManager(options.configPath);
  await manager.load();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const value = manager.get(key as any);
  process.stdout.write(`${key} = ${String(value)}\n`);
}

/**
 * 10.9 — `config list` command
 *
 * Displays all configuration keys and their current values.
 */
export async function cmdConfigList(options: { configPath?: string } = {}): Promise<void> {
  const manager = new ConfigManager(options.configPath);
  await manager.load();

  const config = manager.list();

  for (const key of VALID_CONFIG_KEYS) {
    const value = config[key];
    if (value !== undefined) {
      process.stdout.write(`${key} = ${String(value)}\n`);
    }
  }
}

/**
 * 10.10 — `history clear` command
 *
 * Prompts for confirmation, then deletes the history file.
 * Accepts --yes flag to skip the prompt.
 */
export async function cmdHistoryClear(options: {
  yes?: boolean;
  historyPath?: string;
  skipPrompt?: boolean;
  /** Optional prompt function override for testing. */
  confirmFn?: (q: string) => Promise<string>;
} = {}): Promise<void> {
  const historyPath = options.historyPath ?? HISTORY_PATH;

  // Skip prompt if --yes flag is set or skipPrompt is true (for testing)
  const shouldProceed =
    options.yes === true ||
    options.skipPrompt === true ||
    (await confirm("Are you sure you want to clear all history? [y/N] ", options.confirmFn));

  if (!shouldProceed) {
    process.stdout.write("History clear cancelled.\n");
    return;
  }

  try {
    await unlink(historyPath);
    process.stdout.write("History cleared.\n");
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code === "ENOENT") {
      process.stdout.write("No history file found.\n");
    } else {
      process.stderr.write(`Failed to clear history: ${String(err)}\n`);
      process.exit(1);
    }
  }
}

// ---------------------------------------------------------------------------
// Commander program setup (10.1)
// ---------------------------------------------------------------------------

/**
 * Build and return the Commander program.
 * Exported for testing.
 */
export function buildProgram(): Command {
  const program = new Command();

  program
    .name("terminalsense")
    .description(
      "A lightweight terminal daemon providing autocorrect, ghost-text suggestions, and memory-based predictions."
    )
    .version("0.1.0");

  // --- setup ---
  program
    .command("setup [shell]")
    .description("Install the shell hook, update the profile, and start the daemon")
    .option("--no-start", "Install the hook without starting the daemon")
    .action(async (shell: string | undefined, options: { start?: boolean }) => {
      await cmdSetup({
        shell,
        startDaemon: options.start !== false,
      });
    });

  // --- start ---
  program
    .command("start")
    .description("Launch the daemon as a detached background process")
    .action(async () => {
      await cmdStart();
    });

  // --- stop ---
  program
    .command("stop")
    .description("Stop the running daemon")
    .action(async () => {
      await cmdStop();
    });

  // --- status ---
  program
    .command("status")
    .description("Check whether the daemon is running")
    .action(async () => {
      await cmdStatus();
    });

  // --- init <shell> ---
  program
    .command("init <shell>")
    .description("Output the shell hook snippet for bash, zsh, or powershell")
    .action((shell: string) => {
      cmdInit(shell);
    });

  // --- tui ---
  program
    .command("tui")
    .alias("t")
    .description("Open terminal user interface dashboard")
    .action(async () => {
      const { startTUI } = await import("./tui.js");
      await startTUI();
    });
  program
    .command("corrections")
    .description("List all autocorrections applied in the current session")
    .action(async () => {
      await cmdCorrections();
    });

  // --- dictionary ---
  const dictionaryCmd = program
    .command("dictionary")
    .description("Manage corrections dictionary");

  dictionaryCmd
    .command("stats")
    .description("Show corrections dictionary statistics")
    .action(async () => {
      await cmdDictionaryStats();
    });

  dictionaryCmd
    .command("suggestions")
    .description("Show suggestions dictionary statistics")
    .action(async () => {
      await cmdSuggestionsStats();
    });

  // --- config ---
  const configCmd = program
    .command("config")
    .description("Manage configuration settings");

  configCmd
    .command("set <key> <value>")
    .description("Set a configuration key")
    .action(async (key: string, value: string) => {
      await cmdConfigSet(key, value);
    });

  configCmd
    .command("get <key>")
    .description("Get a configuration key")
    .action(async (key: string) => {
      await cmdConfigGet(key);
    });

  configCmd
    .command("list")
    .description("List all configuration keys and values")
    .action(async () => {
      await cmdConfigList();
    });

  // --- history ---
  const historyCmd = program
    .command("history")
    .description("Manage command history");

  historyCmd
    .command("clear")
    .description("Delete all stored command history and patterns")
    .option("-y, --yes", "Skip confirmation prompt")
    .action(async (opts: { yes?: boolean }) => {
      await cmdHistoryClear({ yes: opts.yes });
    });

  return program;
}

/**
 * Suggestions stats command - show suggestions dictionary statistics
 */
export async function cmdSuggestionsStats(): Promise<void> {
  const { getDefaultSuggestionsDictionary } = await import("./suggestions-dictionary.js");
  
  const dictionary = getDefaultSuggestionsDictionary();
  const stats = dictionary.getStats();
  
  process.stdout.write(`Suggestions Dictionary Statistics:\n`);
  process.stdout.write(`  Total suggestions: ${stats.totalSuggestions}\n`);
  process.stdout.write(`  Built-in suggestions: ${stats.builtinSuggestions}\n`);
  process.stdout.write(`  Learned suggestions: ${stats.learnedSuggestions}\n`);
  process.stdout.write(`  Supported commands: ${stats.commands.join(', ')}\n`);
  
  process.stdout.write(`\n  Top suggestions by frequency:\n`);
  for (const suggestion of stats.topSuggestions.slice(0, 5)) {
    process.stdout.write(`    "${suggestion.prefix}" → "${suggestion.completion}" (${suggestion.frequency} uses)\n`);
  }
}

/**
 * Dictionary stats command - show corrections dictionary statistics
 */
export async function cmdDictionaryStats(): Promise<void> {
  const { initializeCorrectionsDictionary } = await import("./corrections-dictionary.js");
  
  const dictionary = await initializeCorrectionsDictionary();
  const stats = dictionary.getStats();
  
  process.stdout.write(`Corrections Dictionary Statistics:\n`);
  process.stdout.write(`  Total corrections: ${stats.totalCorrections}\n`);
  process.stdout.write(`  Command-specific: ${stats.commandSpecific}\n`);
  process.stdout.write(`  Global corrections: ${stats.global}\n`);
  process.stdout.write(`  Supported commands: ${stats.commands.join(', ')}\n`);
  
  // Show some examples for each command
  for (const command of stats.commands.slice(0, 3)) {
    const corrections = dictionary.getCommandCorrections(command);
    const examples = Array.from(corrections.entries()).slice(0, 3);
    if (examples.length > 0) {
      process.stdout.write(`\n  ${command} examples:\n`);
      for (const [incorrect, correct] of examples) {
        process.stdout.write(`    ${incorrect} → ${correct}\n`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

// Only run when executed directly (not when imported in tests)
const isMain =
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith("cli.js") || process.argv[1].endsWith("cli.ts"));

if (isMain) {
  // Handle --ipc mode FIRST, before Commander tries to parse it
  // Used by the PowerShell hook to avoid stdin piping issues.
  const ipcIndex = process.argv.indexOf("--ipc");
  if (ipcIndex !== -1) {
    const ipcType = process.argv[ipcIndex + 1] as IPCRequest["type"] | undefined;
    const bufferIndex = process.argv.indexOf("--buffer");
    const ipcBuffer = bufferIndex !== -1 ? (process.argv[bufferIndex + 1] ?? "") : "";
    
    // Handle learn command specially
    if (ipcType === "learn") {
      const prefixIndex = process.argv.indexOf("--prefix");
      const completionIndex = process.argv.indexOf("--completion");
      const prefix = prefixIndex !== -1 ? (process.argv[prefixIndex + 1] ?? "") : "";
      const completion = completionIndex !== -1 ? (process.argv[completionIndex + 1] ?? "") : "";
      
      if (prefix && completion) {
        // Close stdin immediately to prevent hanging
        try { process.stdin.destroy(); } catch { /* ignore */ }

        const client = new IPCClient();
        const request: IPCRequest = {
          type: "learn",
          prefix,
          completion,
          sessionId: randomUUID(),
          requestId: randomUUID(),
        };

        client.send(SOCKET_PATH, request, 2000).then(() => {
          process.exit(0);
        }).catch(() => process.exit(0));
      } else {
        process.exit(1);
      }
    } else if (ipcType) {
      // Close stdin immediately to prevent hanging
      try { process.stdin.destroy(); } catch { /* ignore */ }

      const client = new IPCClient();
      const request: IPCRequest = {
        type: ipcType,
        buffer: ipcBuffer,
        sessionId: randomUUID(),
        requestId: randomUUID(),
      };

      client.send(SOCKET_PATH, request, 2000).then((response) => {
        if (response?.ok && response.data) {
          const d = response.data;
          if (d.corrected) process.stdout.write(d.corrected);
          else if (d.ghost) process.stdout.write(d.ghost);
        }
        process.exit(0);
      }).catch(() => process.exit(0));
    } else {
      process.exit(1);
    }
  } else {
    // Check for -t/--tui flag before Commander parsing
    const tuiIndex = process.argv.indexOf("-t");
    const tuiLongIndex = process.argv.indexOf("--tui");
    
    if (tuiIndex !== -1 || tuiLongIndex !== -1) {
      // Dynamic import and start TUI
      import("./tui.js").then(({ startTUI }) => {
        startTUI().catch((err: unknown) => {
          process.stderr.write(`TUI Error: ${String(err)}\n`);
          process.exit(1);
        });
      }).catch((err: unknown) => {
        process.stderr.write(`Failed to load TUI: ${String(err)}\n`);
        process.exit(1);
      });
    } else {
      // Normal Commander-based CLI
      const program = buildProgram();
      program.parseAsync(process.argv).catch((err: unknown) => {
        process.stderr.write(`Error: ${String(err)}\n`);
        process.exit(1);
      });
    }
  }
}
