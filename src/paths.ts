import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Root directory for all terminal-autocorrect data files.
 * Defaults to ~/.terminal-autocorrect/ but can be overridden via the
 * TAC_HOME environment variable for testing or custom installations.
 */
export const TAC_HOME: string =
  process.env["TAC_HOME"] ?? join(homedir(), ".terminal-autocorrect");

/**
 * Path to the JSON configuration file.
 * Stores all user-configurable settings (maxEditDistance, historyPath, etc.).
 */
export const CONFIG_PATH: string = join(TAC_HOME, "config.json");

/**
 * Default path to the JSON command history and patterns file.
 * The actual path may be overridden by the `historyPath` config key.
 */
export const HISTORY_PATH: string = join(TAC_HOME, "history.json");

/**
 * Path to the PID lock file written when the daemon starts.
 * Used by the CLI to detect whether a daemon instance is already running.
 */
export const PID_FILE_PATH: string = join(TAC_HOME, "daemon.pid");

/**
 * Whether the current platform is Windows.
 */
export const IS_WINDOWS: boolean = process.platform === "win32";

/**
 * IPC socket path.
 *
 * On Windows, Node.js `net` uses named pipes. The conventional path format
 * is `\\.\pipe\<name>`. We derive the name from TAC_HOME to allow multiple
 * isolated instances (e.g. in tests via TAC_HOME override).
 *
 * On Unix, we use a `.sock` file inside TAC_HOME.
 */
export const SOCKET_PATH: string = IS_WINDOWS
  ? `\\\\.\\pipe\\terminal-autocorrect-${_pipeId()}`
  : join(TAC_HOME, "daemon.sock");

/**
 * Derive a short, filesystem-safe identifier from TAC_HOME for use in the
 * Windows named pipe name. Replaces path separators and colons with dashes.
 */
function _pipeId(): string {
  // Use a fixed name when TAC_HOME is the default, otherwise derive from the
  // custom path so tests with different TAC_HOME values get different pipes.
  const custom = process.env["TAC_HOME"];
  if (custom === undefined) {
    return "default";
  }
  return custom.replace(/[:\\/]/g, "-").replace(/^-+/, "");
}
