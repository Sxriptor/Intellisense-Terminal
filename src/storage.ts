import {
  readFile,
  writeFile,
  unlink,
  rename,
  mkdir,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

// ---------------------------------------------------------------------------
// Atomic file write
// ---------------------------------------------------------------------------

/**
 * Write `content` to `path` atomically by first writing to a sibling temp
 * file and then renaming it into place.  This prevents partial writes from
 * leaving the target file in a corrupt state.
 *
 * The temp file is placed in the same directory as the target so that the
 * rename is guaranteed to be atomic on POSIX systems (same filesystem).
 */
export async function atomicWriteFile(path: string, content: string): Promise<void> {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });

  // Use a random suffix to avoid collisions when multiple writers race.
  const suffix = randomBytes(6).toString("hex");
  const tmpPath = join(dir, `.tmp-${suffix}`);

  try {
    await writeFile(tmpPath, content, "utf-8");
    await rename(tmpPath, path);
  } catch (err) {
    // Best-effort cleanup of the temp file on failure.
    try {
      await unlink(tmpPath);
    } catch {
      // Ignore cleanup errors.
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// JSON read / write
// ---------------------------------------------------------------------------

/**
 * Read and parse a JSON file at `path`.
 *
 * - Returns `null` when the file does not exist (ENOENT).
 * - Throws a `CorruptFileError` when the file exists but cannot be parsed.
 * - Re-throws any other I/O error.
 */
export async function readJSON<T>(path: string): Promise<T | null> {
  let raw: string;

  try {
    raw = await readFile(path, "utf-8");
  } catch (err: unknown) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code === "ENOENT") {
      return null;
    }
    throw err;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new CorruptFileError(path);
  }
}

/**
 * Write `data` as formatted JSON to `path` using an atomic write.
 * Creates the parent directory if it does not exist.
 */
export async function writeJSON<T>(path: string, data: T): Promise<void> {
  const content = JSON.stringify(data, null, 2) + "\n";
  await atomicWriteFile(path, content);
}

/**
 * Error thrown by `readJSON` when a file exists but contains invalid JSON.
 */
export class CorruptFileError extends Error {
  constructor(public readonly filePath: string) {
    super(`File is corrupt or contains invalid JSON: ${filePath}`);
    this.name = "CorruptFileError";
  }
}

// ---------------------------------------------------------------------------
// Debounced writer
// ---------------------------------------------------------------------------

/**
 * Schedules writes with a configurable debounce delay.
 *
 * Calling `schedule()` cancels any pending write and re-schedules it after
 * `delayMs` milliseconds.  Calling `flush()` executes the pending write
 * immediately (cancelling the timer).
 *
 * Typical usage: debounce history writes so that rapid command recording
 * does not hammer the disk.
 *
 * @example
 * const writer = new DebouncedWriter(() => writeJSON(historyPath, history), 500);
 * writer.schedule();   // called after each command record
 * writer.flush();      // called on daemon shutdown
 */
export class DebouncedWriter {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pendingWrite: (() => Promise<void>) | null = null;

  constructor(
    private readonly writeFn: () => Promise<void>,
    private readonly delayMs: number = 500,
  ) {}

  /**
   * Schedule a write.  Any previously scheduled write is cancelled.
   */
  schedule(): void {
    this.pendingWrite = this.writeFn;

    if (this.timer !== null) {
      clearTimeout(this.timer);
    }

    this.timer = setTimeout(() => {
      this.timer = null;
      const fn = this.pendingWrite;
      this.pendingWrite = null;
      if (fn) {
        fn().catch((err: unknown) => {
          process.stderr.write(
            `[terminal-autocorrect] WARNING: debounced write failed: ${String(err)}\n`,
          );
        });
      }
    }, this.delayMs);
  }

  /**
   * Execute any pending write immediately, cancelling the scheduled timer.
   * Returns a promise that resolves when the write completes.
   * If there is no pending write, resolves immediately.
   */
  async flush(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    const fn = this.pendingWrite;
    this.pendingWrite = null;

    if (fn) {
      await fn();
    }
  }

  /**
   * Returns true if a write is currently scheduled (timer is active).
   */
  get isPending(): boolean {
    return this.timer !== null;
  }
}

// ---------------------------------------------------------------------------
// Lock file (PID file) operations
// ---------------------------------------------------------------------------

/**
 * Write `pid` as a decimal integer followed by a newline to `path`.
 * Creates the parent directory if it does not exist.
 */
export async function writePidFile(path: string, pid: number): Promise<void> {
  await atomicWriteFile(path, `${pid}\n`);
}

/**
 * Read the PID from a lock file at `path`.
 *
 * - Returns `null` when the file does not exist.
 * - Returns `null` when the file content cannot be parsed as a valid integer.
 * - Re-throws any other I/O error.
 */
export async function readPidFile(path: string): Promise<number | null> {
  let raw: string;

  try {
    raw = await readFile(path, "utf-8");
  } catch (err: unknown) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code === "ENOENT") {
      return null;
    }
    throw err;
  }

  const pid = parseInt(raw.trim(), 10);
  if (isNaN(pid)) {
    return null;
  }
  return pid;
}

/**
 * Delete the lock file at `path`.
 * Silently ignores the error when the file does not exist.
 */
export async function deletePidFile(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (err: unknown) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code === "ENOENT") {
      return;
    }
    throw err;
  }
}
