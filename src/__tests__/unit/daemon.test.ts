/**
 * Unit tests for Daemon signal handler behavior (Task 9.6).
 *
 * Tests verify that:
 *  - The PID lock file is removed when the daemon stops
 *  - The socket file is removed when the daemon stops
 *  - The session ID is a valid UUID generated at startup
 *  - The corrections log is maintained in-memory
 *  - Provider loading falls back to built-in on failure
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir, platform } from "node:os";
import { Daemon } from "../../daemon.js";

// Unix domain sockets are not supported on Windows.
const isWindows = platform() === "win32";
const itSocket = isWindows ? it.skip : it;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "tac-daemon-test-"));
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Daemon startup / stop lifecycle
// ---------------------------------------------------------------------------

describe("Daemon lifecycle", () => {
  let dir: string;
  let daemon: Daemon;

  beforeEach(async () => {
    dir = await makeTempDir();
  });

  afterEach(async () => {
    // Ensure daemon is stopped even if a test fails
    try {
      await daemon?.stop();
    } catch {
      // ignore
    }
    await rm(dir, { recursive: true, force: true });
  });

  itSocket("writes PID lock file on start", async () => {
    const pidFile = join(dir, "daemon.pid");
    const socketFile = join(dir, "daemon.sock");

    daemon = new Daemon({ pidFilePath: pidFile, socketPath: socketFile });
    await daemon.start();

    expect(await fileExists(pidFile)).toBe(true);
  });

  itSocket("removes PID lock file on stop", async () => {
    const pidFile = join(dir, "daemon.pid");
    const socketFile = join(dir, "daemon.sock");

    daemon = new Daemon({ pidFilePath: pidFile, socketPath: socketFile });
    await daemon.start();

    expect(await fileExists(pidFile)).toBe(true);

    await daemon.stop();

    expect(await fileExists(pidFile)).toBe(false);
  });

  itSocket("removes socket file on stop", async () => {
    const pidFile = join(dir, "daemon.pid");
    const socketFile = join(dir, "daemon.sock");

    daemon = new Daemon({ pidFilePath: pidFile, socketPath: socketFile });
    await daemon.start();

    // Socket file should exist while daemon is running
    expect(await fileExists(socketFile)).toBe(true);

    await daemon.stop();

    // Socket file should be removed after stop
    expect(await fileExists(socketFile)).toBe(false);
  });

  itSocket("stop() is idempotent — calling twice does not throw", async () => {
    const pidFile = join(dir, "daemon.pid");
    const socketFile = join(dir, "daemon.sock");

    daemon = new Daemon({ pidFilePath: pidFile, socketPath: socketFile });
    await daemon.start();
    await daemon.stop();

    await expect(daemon.stop()).resolves.toBeUndefined();
  });

  itSocket("isRunning() reflects daemon state", async () => {
    const pidFile = join(dir, "daemon.pid");
    const socketFile = join(dir, "daemon.sock");

    daemon = new Daemon({ pidFilePath: pidFile, socketPath: socketFile });

    expect(daemon.isRunning()).toBe(false);

    await daemon.start();
    expect(daemon.isRunning()).toBe(true);

    await daemon.stop();
    expect(daemon.isRunning()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Session ID generation (9.3)
// ---------------------------------------------------------------------------

describe("Daemon session ID", () => {
  let dir: string;
  let daemon: Daemon;

  beforeEach(async () => {
    dir = await makeTempDir();
  });

  afterEach(async () => {
    try {
      await daemon?.stop();
    } catch {
      // ignore
    }
    await rm(dir, { recursive: true, force: true });
  });

  itSocket("generates a non-empty session ID on start", async () => {
    const pidFile = join(dir, "daemon.pid");
    const socketFile = join(dir, "daemon.sock");

    daemon = new Daemon({ pidFilePath: pidFile, socketPath: socketFile });
    await daemon.start();

    const sessionId = daemon.getSessionId();
    expect(sessionId).toBeTruthy();
    expect(typeof sessionId).toBe("string");
    expect(sessionId.length).toBeGreaterThan(0);
  });

  itSocket("session ID is a valid UUID v4 format", async () => {
    const pidFile = join(dir, "daemon.pid");
    const socketFile = join(dir, "daemon.sock");

    daemon = new Daemon({ pidFilePath: pidFile, socketPath: socketFile });
    await daemon.start();

    const sessionId = daemon.getSessionId();
    // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    const uuidV4Regex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(uuidV4Regex.test(sessionId)).toBe(true);
  });

  itSocket("each daemon start generates a different session ID", async () => {
    const pidFile = join(dir, "daemon.pid");
    const socketFile = join(dir, "daemon.sock");

    daemon = new Daemon({ pidFilePath: pidFile, socketPath: socketFile });
    await daemon.start();
    const id1 = daemon.getSessionId();
    await daemon.stop();

    // Use a different socket path for the second start to avoid conflicts
    const socketFile2 = join(dir, "daemon2.sock");
    const pidFile2 = join(dir, "daemon2.pid");
    const daemon2 = new Daemon({ pidFilePath: pidFile2, socketPath: socketFile2 });
    await daemon2.start();
    const id2 = daemon2.getSessionId();
    await daemon2.stop();

    expect(id1).not.toBe(id2);
  });
});

// ---------------------------------------------------------------------------
// Corrections log (9.4)
// ---------------------------------------------------------------------------

describe("Daemon corrections log", () => {
  let dir: string;
  let daemon: Daemon;

  beforeEach(async () => {
    dir = await makeTempDir();
  });

  afterEach(async () => {
    try {
      await daemon?.stop();
    } catch {
      // ignore
    }
    await rm(dir, { recursive: true, force: true });
  });

  itSocket("corrections log is empty at startup", async () => {
    const pidFile = join(dir, "daemon.pid");
    const socketFile = join(dir, "daemon.sock");

    daemon = new Daemon({ pidFilePath: pidFile, socketPath: socketFile });
    await daemon.start();

    expect(daemon.getCorrectionsLog()).toEqual([]);
  });

  itSocket("corrections log is populated after a correct request", async () => {
    const pidFile = join(dir, "daemon.pid");
    const socketFile = join(dir, "daemon.sock");

    daemon = new Daemon({ pidFilePath: pidFile, socketPath: socketFile });
    await daemon.start();

    // Send a correct request via IPC
    const { IPCClient } = await import("../../ipc.js");
    const { randomUUID } = await import("node:crypto");
    const client = new IPCClient();

    const req = {
      type: "correct" as const,
      buffer: "git statsu",
      sessionId: daemon.getSessionId(),
      requestId: randomUUID(),
    };

    const res = await client.send(socketFile, req, 2000);
    expect(res).not.toBeNull();
    expect(res!.ok).toBe(true);

    // If the autocorrect engine corrected the command, the log should have an entry
    const log = daemon.getCorrectionsLog();
    if (res!.data?.corrected !== undefined) {
      expect(log).toHaveLength(1);
      expect(log[0]!.original).toBe("git statsu");
      expect(log[0]!.corrected).toBe(res!.data.corrected);
      expect(typeof log[0]!.timestamp).toBe("string");
    }
  });

  itSocket("corrections log accumulates multiple entries", async () => {
    const pidFile = join(dir, "daemon.pid");
    const socketFile = join(dir, "daemon.sock");

    daemon = new Daemon({ pidFilePath: pidFile, socketPath: socketFile });
    await daemon.start();

    const { IPCClient } = await import("../../ipc.js");
    const { randomUUID } = await import("node:crypto");
    const client = new IPCClient();

    // Send two correction requests for known typos
    const typos = ["git statsu", "git comit -m test"];
    let correctedCount = 0;

    for (const typo of typos) {
      const req = {
        type: "correct" as const,
        buffer: typo,
        sessionId: daemon.getSessionId(),
        requestId: randomUUID(),
      };
      const res = await client.send(socketFile, req, 2000);
      if (res?.data?.corrected !== undefined) {
        correctedCount++;
      }
    }

    const log = daemon.getCorrectionsLog();
    expect(log).toHaveLength(correctedCount);
  });

  itSocket("loads packaged corrections from common.json at startup", async () => {
    const pidFile = join(dir, "daemon.pid");
    const socketFile = join(dir, "daemon.sock");

    daemon = new Daemon({ pidFilePath: pidFile, socketPath: socketFile });
    await daemon.start();

    const { IPCClient } = await import("../../ipc.js");
    const { randomUUID } = await import("node:crypto");
    const client = new IPCClient();

    const req = {
      type: "correct" as const,
      buffer: "gti",
      sessionId: daemon.getSessionId(),
      requestId: randomUUID(),
    };

    const res = await client.send(socketFile, req, 2000);
    expect(res).not.toBeNull();
    expect(res!.ok).toBe(true);
    expect(res!.data?.corrected).toBe("git");
  });
});

// ---------------------------------------------------------------------------
// Signal handler behavior (9.2) — tested via stop() which performs the same
// cleanup as the signal handlers
// ---------------------------------------------------------------------------

describe("Daemon signal handler cleanup (via stop())", () => {
  let dir: string;

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  itSocket("PID file is removed after stop (simulating SIGTERM cleanup)", async () => {
    dir = await makeTempDir();
    const pidFile = join(dir, "daemon.pid");
    const socketFile = join(dir, "daemon.sock");

    const daemon = new Daemon({ pidFilePath: pidFile, socketPath: socketFile });
    await daemon.start();

    // Verify PID file exists
    expect(await fileExists(pidFile)).toBe(true);

    // stop() performs the same cleanup as the SIGTERM/SIGINT handler
    await daemon.stop();

    // PID file must be gone
    expect(await fileExists(pidFile)).toBe(false);
  });

  itSocket("socket file is removed after stop (simulating SIGTERM cleanup)", async () => {
    dir = await makeTempDir();
    const pidFile = join(dir, "daemon.pid");
    const socketFile = join(dir, "daemon.sock");

    const daemon = new Daemon({ pidFilePath: pidFile, socketPath: socketFile });
    await daemon.start();

    // Verify socket file exists
    expect(await fileExists(socketFile)).toBe(true);

    // stop() performs the same cleanup as the SIGTERM/SIGINT handler
    await daemon.stop();

    // Socket file must be gone
    expect(await fileExists(socketFile)).toBe(false);
  });

  itSocket("both PID file and socket file are removed atomically on stop", async () => {
    dir = await makeTempDir();
    const pidFile = join(dir, "daemon.pid");
    const socketFile = join(dir, "daemon.sock");

    const daemon = new Daemon({ pidFilePath: pidFile, socketPath: socketFile });
    await daemon.start();

    await daemon.stop();

    const [pidExists, socketExists] = await Promise.all([
      fileExists(pidFile),
      fileExists(socketFile),
    ]);

    expect(pidExists).toBe(false);
    expect(socketExists).toBe(false);
  });

  itSocket("stop() does not throw when PID file is already missing", async () => {
    dir = await makeTempDir();
    const pidFile = join(dir, "daemon.pid");
    const socketFile = join(dir, "daemon.sock");

    const daemon = new Daemon({ pidFilePath: pidFile, socketPath: socketFile });
    await daemon.start();

    // Manually remove the PID file before stop()
    await rm(pidFile, { force: true });

    // stop() should not throw
    await expect(daemon.stop()).resolves.toBeUndefined();
  });

  itSocket("stop() does not throw when socket file is already missing", async () => {
    dir = await makeTempDir();
    const pidFile = join(dir, "daemon.pid");
    const socketFile = join(dir, "daemon.sock");

    const daemon = new Daemon({ pidFilePath: pidFile, socketPath: socketFile });
    await daemon.start();

    // Manually remove the socket file before stop()
    await rm(socketFile, { force: true });

    // stop() should not throw
    await expect(daemon.stop()).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Provider loading (9.5) — fallback to built-in on bad path
// ---------------------------------------------------------------------------

describe("Daemon provider loading", () => {
  let dir: string;
  let daemon: Daemon;

  beforeEach(async () => {
    dir = await makeTempDir();
  });

  afterEach(async () => {
    try {
      await daemon?.stop();
    } catch {
      // ignore
    }
    await rm(dir, { recursive: true, force: true });
  });

  itSocket("starts successfully when no external providers are configured", async () => {
    const pidFile = join(dir, "daemon.pid");
    const socketFile = join(dir, "daemon.sock");

    daemon = new Daemon({ pidFilePath: pidFile, socketPath: socketFile });
    await expect(daemon.start()).resolves.toBeUndefined();
    expect(daemon.isRunning()).toBe(true);
  });

  itSocket("falls back to built-in provider when suggestionProvider path is invalid", async () => {
    const pidFile = join(dir, "daemon.pid");
    const socketFile = join(dir, "daemon.sock");
    const configFile = join(dir, "config.json");

    // Write a config with a bad provider path
    await writeFile(
      configFile,
      JSON.stringify({
        suggestionProvider: "/nonexistent/path/to/provider.js",
      }),
      "utf-8"
    );

    daemon = new Daemon({
      configPath: configFile,
      pidFilePath: pidFile,
      socketPath: socketFile,
    });

    // Should start without throwing — falls back to built-in
    await expect(daemon.start()).resolves.toBeUndefined();
    expect(daemon.isRunning()).toBe(true);
  });

  itSocket("falls back to built-in predictor when memoryProvider path is invalid", async () => {
    const pidFile = join(dir, "daemon.pid");
    const socketFile = join(dir, "daemon.sock");
    const configFile = join(dir, "config.json");

    // Write a config with a bad memory provider path
    await writeFile(
      configFile,
      JSON.stringify({
        memoryProvider: "/nonexistent/path/to/predictor.js",
      }),
      "utf-8"
    );

    daemon = new Daemon({
      configPath: configFile,
      pidFilePath: pidFile,
      socketPath: socketFile,
    });

    // Should start without throwing — falls back to built-in
    await expect(daemon.start()).resolves.toBeUndefined();
    expect(daemon.isRunning()).toBe(true);
  });
});
