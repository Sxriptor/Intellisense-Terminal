import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  atomicWriteFile,
  readJSON,
  writeJSON,
  writePidFile,
  readPidFile,
  deletePidFile,
  DebouncedWriter,
  CorruptFileError,
} from "../../storage.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "tac-storage-test-"));
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
// atomicWriteFile
// ---------------------------------------------------------------------------

describe("atomicWriteFile", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeTempDir();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writes content to the target file", async () => {
    const path = join(dir, "output.txt");
    await atomicWriteFile(path, "hello world");
    const content = await readFile(path, "utf-8");
    expect(content).toBe("hello world");
  });

  it("overwrites an existing file", async () => {
    const path = join(dir, "output.txt");
    await atomicWriteFile(path, "first");
    await atomicWriteFile(path, "second");
    const content = await readFile(path, "utf-8");
    expect(content).toBe("second");
  });

  it("creates parent directories if they do not exist", async () => {
    const path = join(dir, "nested", "deep", "output.txt");
    await atomicWriteFile(path, "nested content");
    const content = await readFile(path, "utf-8");
    expect(content).toBe("nested content");
  });

  it("does not leave a temp file behind after a successful write", async () => {
    const path = join(dir, "output.txt");
    await atomicWriteFile(path, "data");

    // List directory — there should be exactly one file (the target)
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(dir);
    expect(files).toEqual(["output.txt"]);
  });

  it("writes empty string correctly", async () => {
    const path = join(dir, "empty.txt");
    await atomicWriteFile(path, "");
    const content = await readFile(path, "utf-8");
    expect(content).toBe("");
  });
});

// ---------------------------------------------------------------------------
// readJSON
// ---------------------------------------------------------------------------

describe("readJSON", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeTempDir();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns null when the file does not exist", async () => {
    const path = join(dir, "nonexistent.json");
    const result = await readJSON(path);
    expect(result).toBeNull();
  });

  it("parses and returns valid JSON", async () => {
    const path = join(dir, "data.json");
    const data = { key: "value", count: 42, flag: true };
    await writeFile(path, JSON.stringify(data), "utf-8");
    const result = await readJSON<typeof data>(path);
    expect(result).toEqual(data);
  });

  it("throws CorruptFileError for invalid JSON", async () => {
    const path = join(dir, "corrupt.json");
    await writeFile(path, "{ this is not valid json }", "utf-8");
    await expect(readJSON(path)).rejects.toThrow(CorruptFileError);
  });

  it("CorruptFileError includes the file path", async () => {
    const path = join(dir, "corrupt.json");
    await writeFile(path, "CORRUPT", "utf-8");
    try {
      await readJSON(path);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CorruptFileError);
      expect((err as CorruptFileError).filePath).toBe(path);
    }
  });

  it("throws CorruptFileError for a file containing only whitespace", async () => {
    const path = join(dir, "whitespace.json");
    await writeFile(path, "   \n  ", "utf-8");
    await expect(readJSON(path)).rejects.toThrow(CorruptFileError);
  });

  it("parses JSON arrays", async () => {
    const path = join(dir, "array.json");
    await writeFile(path, JSON.stringify([1, 2, 3]), "utf-8");
    const result = await readJSON<number[]>(path);
    expect(result).toEqual([1, 2, 3]);
  });

  it("parses nested JSON objects", async () => {
    const path = join(dir, "nested.json");
    const data = { a: { b: { c: 99 } } };
    await writeFile(path, JSON.stringify(data), "utf-8");
    const result = await readJSON<typeof data>(path);
    expect(result).toEqual(data);
  });
});

// ---------------------------------------------------------------------------
// writeJSON
// ---------------------------------------------------------------------------

describe("writeJSON", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeTempDir();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writes data as formatted JSON", async () => {
    const path = join(dir, "data.json");
    const data = { name: "test", value: 123 };
    await writeJSON(path, data);
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed).toEqual(data);
  });

  it("round-trips: writeJSON then readJSON returns the original data", async () => {
    const path = join(dir, "roundtrip.json");
    const data = {
      version: 1,
      entries: [{ command: "git status", timestamp: "2024-01-01T00:00:00.000Z" }],
      patterns: [],
    };
    await writeJSON(path, data);
    const result = await readJSON<typeof data>(path);
    expect(result).toEqual(data);
  });

  it("creates parent directories if they do not exist", async () => {
    const path = join(dir, "sub", "dir", "data.json");
    await writeJSON(path, { ok: true });
    const result = await readJSON<{ ok: boolean }>(path);
    expect(result).toEqual({ ok: true });
  });

  it("overwrites existing file", async () => {
    const path = join(dir, "data.json");
    await writeJSON(path, { v: 1 });
    await writeJSON(path, { v: 2 });
    const result = await readJSON<{ v: number }>(path);
    expect(result?.v).toBe(2);
  });

  it("output ends with a newline", async () => {
    const path = join(dir, "data.json");
    await writeJSON(path, { x: 1 });
    const raw = await readFile(path, "utf-8");
    expect(raw.endsWith("\n")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// writePidFile / readPidFile / deletePidFile
// ---------------------------------------------------------------------------

describe("PID file operations", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeTempDir();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe("writePidFile", () => {
    it("writes the PID as a decimal integer followed by a newline", async () => {
      const path = join(dir, "daemon.pid");
      await writePidFile(path, 12345);
      const raw = await readFile(path, "utf-8");
      expect(raw).toBe("12345\n");
    });

    it("creates parent directories if they do not exist", async () => {
      const path = join(dir, "sub", "daemon.pid");
      await writePidFile(path, 99);
      const raw = await readFile(path, "utf-8");
      expect(raw.trim()).toBe("99");
    });
  });

  describe("readPidFile", () => {
    it("returns null when the file does not exist", async () => {
      const path = join(dir, "nonexistent.pid");
      const result = await readPidFile(path);
      expect(result).toBeNull();
    });

    it("returns the PID as a number when the file exists", async () => {
      const path = join(dir, "daemon.pid");
      await writeFile(path, "42\n", "utf-8");
      const result = await readPidFile(path);
      expect(result).toBe(42);
    });

    it("round-trips with writePidFile", async () => {
      const path = join(dir, "daemon.pid");
      await writePidFile(path, 9876);
      const result = await readPidFile(path);
      expect(result).toBe(9876);
    });

    it("returns null when the file contains non-numeric content", async () => {
      const path = join(dir, "daemon.pid");
      await writeFile(path, "not-a-pid\n", "utf-8");
      const result = await readPidFile(path);
      expect(result).toBeNull();
    });

    it("handles PID with surrounding whitespace", async () => {
      const path = join(dir, "daemon.pid");
      await writeFile(path, "  1234  \n", "utf-8");
      const result = await readPidFile(path);
      expect(result).toBe(1234);
    });
  });

  describe("deletePidFile", () => {
    it("deletes an existing PID file", async () => {
      const path = join(dir, "daemon.pid");
      await writeFile(path, "1\n", "utf-8");
      await deletePidFile(path);
      expect(await fileExists(path)).toBe(false);
    });

    it("does not throw when the file does not exist", async () => {
      const path = join(dir, "nonexistent.pid");
      await expect(deletePidFile(path)).resolves.toBeUndefined();
    });

    it("is idempotent — calling twice does not throw", async () => {
      const path = join(dir, "daemon.pid");
      await writeFile(path, "1\n", "utf-8");
      await deletePidFile(path);
      await expect(deletePidFile(path)).resolves.toBeUndefined();
    });
  });
});

// ---------------------------------------------------------------------------
// DebouncedWriter
// ---------------------------------------------------------------------------

describe("DebouncedWriter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not call writeFn immediately on schedule()", () => {
    const writeFn = vi.fn().mockResolvedValue(undefined);
    const writer = new DebouncedWriter(writeFn, 500);
    writer.schedule();
    expect(writeFn).not.toHaveBeenCalled();
  });

  it("calls writeFn after the delay elapses", async () => {
    const writeFn = vi.fn().mockResolvedValue(undefined);
    const writer = new DebouncedWriter(writeFn, 500);
    writer.schedule();
    await vi.advanceTimersByTimeAsync(500);
    expect(writeFn).toHaveBeenCalledTimes(1);
  });

  it("cancels a pending write when schedule() is called again", async () => {
    const writeFn = vi.fn().mockResolvedValue(undefined);
    const writer = new DebouncedWriter(writeFn, 500);
    writer.schedule();
    await vi.advanceTimersByTimeAsync(300);
    writer.schedule(); // reset the timer
    await vi.advanceTimersByTimeAsync(300); // only 300ms since last schedule
    expect(writeFn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200); // now 500ms since last schedule
    expect(writeFn).toHaveBeenCalledTimes(1);
  });

  it("flush() executes the pending write immediately", async () => {
    const writeFn = vi.fn().mockResolvedValue(undefined);
    const writer = new DebouncedWriter(writeFn, 500);
    writer.schedule();
    await writer.flush();
    expect(writeFn).toHaveBeenCalledTimes(1);
  });

  it("flush() cancels the scheduled timer", async () => {
    const writeFn = vi.fn().mockResolvedValue(undefined);
    const writer = new DebouncedWriter(writeFn, 500);
    writer.schedule();
    await writer.flush();
    // Advance past the original delay — writeFn should NOT be called again
    await vi.advanceTimersByTimeAsync(500);
    expect(writeFn).toHaveBeenCalledTimes(1);
  });

  it("flush() resolves immediately when there is no pending write", async () => {
    const writeFn = vi.fn().mockResolvedValue(undefined);
    const writer = new DebouncedWriter(writeFn, 500);
    await expect(writer.flush()).resolves.toBeUndefined();
    expect(writeFn).not.toHaveBeenCalled();
  });

  it("isPending returns true when a write is scheduled", () => {
    const writeFn = vi.fn().mockResolvedValue(undefined);
    const writer = new DebouncedWriter(writeFn, 500);
    expect(writer.isPending).toBe(false);
    writer.schedule();
    expect(writer.isPending).toBe(true);
  });

  it("isPending returns false after flush()", async () => {
    const writeFn = vi.fn().mockResolvedValue(undefined);
    const writer = new DebouncedWriter(writeFn, 500);
    writer.schedule();
    await writer.flush();
    expect(writer.isPending).toBe(false);
  });

  it("isPending returns false after the timer fires", async () => {
    const writeFn = vi.fn().mockResolvedValue(undefined);
    const writer = new DebouncedWriter(writeFn, 500);
    writer.schedule();
    await vi.advanceTimersByTimeAsync(500);
    expect(writer.isPending).toBe(false);
  });

  it("multiple schedule() calls result in exactly one write", async () => {
    const writeFn = vi.fn().mockResolvedValue(undefined);
    const writer = new DebouncedWriter(writeFn, 500);
    writer.schedule();
    writer.schedule();
    writer.schedule();
    await vi.advanceTimersByTimeAsync(500);
    expect(writeFn).toHaveBeenCalledTimes(1);
  });
});
