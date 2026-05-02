import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir, platform } from "node:os";
import { randomUUID } from "node:crypto";
import {
  encodeMessage,
  decodeMessages,
  IPCServer,
  IPCClient,
  type IPCRequest,
  type IPCResponse,
  type DaemonResponse,
  type RequestHandler,
} from "../../ipc.js";

// Unix domain sockets with file paths are not supported on Windows.
// Tests that require a live socket are skipped on win32.
const isWindows = platform() === "win32";
const itSocket = isWindows ? it.skip : it;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "tac-ipc-test-"));
}

function makeRequest(
  type: IPCRequest["type"] = "status",
  overrides: Partial<IPCRequest> = {}
): IPCRequest {
  return {
    type,
    sessionId: "test-session",
    requestId: randomUUID(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Message framing — encodeMessage / decodeMessages (8.2)
// ---------------------------------------------------------------------------

describe("encodeMessage", () => {
  it("serializes a message as JSON followed by a newline", () => {
    const msg = { requestId: "abc", ok: true };
    const encoded = encodeMessage(msg);
    expect(encoded).toBe(JSON.stringify(msg) + "\n");
  });

  it("encodes an IPCRequest correctly", () => {
    const req: IPCRequest = {
      type: "correct",
      buffer: "git meg e",
      sessionId: "s1",
      requestId: "r1",
    };
    const encoded = encodeMessage(req);
    expect(encoded.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(encoded.trim());
    expect(parsed).toEqual(req);
  });

  it("encodes an IPCResponse correctly", () => {
    const res: IPCResponse = {
      requestId: "r1",
      ok: true,
      data: { corrected: "git merge" },
    };
    const encoded = encodeMessage(res);
    const parsed = JSON.parse(encoded.trim());
    expect(parsed).toEqual(res);
  });
});

describe("decodeMessages", () => {
  it("returns empty messages and empty remainder for empty string", () => {
    const result = decodeMessages<IPCRequest>("");
    expect(result.messages).toEqual([]);
    expect(result.remainder).toBe("");
  });

  it("parses a single complete message", () => {
    const msg = { requestId: "r1", ok: true };
    const raw = JSON.stringify(msg) + "\n";
    const result = decodeMessages<typeof msg>(raw);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toEqual(msg);
    expect(result.remainder).toBe("");
  });

  it("parses multiple complete messages", () => {
    const m1 = { requestId: "r1", ok: true };
    const m2 = { requestId: "r2", ok: false };
    const raw = JSON.stringify(m1) + "\n" + JSON.stringify(m2) + "\n";
    const result = decodeMessages<typeof m1>(raw);
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]).toEqual(m1);
    expect(result.messages[1]).toEqual(m2);
    expect(result.remainder).toBe("");
  });

  it("preserves a partial (unterminated) message as remainder", () => {
    const complete = { requestId: "r1", ok: true };
    const partial = '{"requestId":"r2"';
    const raw = JSON.stringify(complete) + "\n" + partial;
    const result = decodeMessages<typeof complete>(raw);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toEqual(complete);
    expect(result.remainder).toBe(partial);
  });

  it("skips malformed JSON lines silently", () => {
    const valid = { requestId: "r1", ok: true };
    const raw = "NOT_JSON\n" + JSON.stringify(valid) + "\n";
    const result = decodeMessages<typeof valid>(raw);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toEqual(valid);
  });

  it("skips blank lines", () => {
    const msg = { requestId: "r1", ok: true };
    const raw = "\n" + JSON.stringify(msg) + "\n\n";
    const result = decodeMessages<typeof msg>(raw);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toEqual(msg);
  });

  it("round-trips with encodeMessage", () => {
    const req: IPCRequest = {
      type: "suggest",
      buffer: "git a",
      sessionId: "s1",
      requestId: "r1",
    };
    const encoded = encodeMessage(req);
    const { messages, remainder } = decodeMessages<IPCRequest>(encoded);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual(req);
    expect(remainder).toBe("");
  });
});

// ---------------------------------------------------------------------------
// IPCServer + IPCClient — request routing (8.4) and round-trip (8.5)
// ---------------------------------------------------------------------------

describe("IPCServer and IPCClient", () => {
  let dir: string;
  let socketPath: string;
  let server: IPCServer;
  const client = new IPCClient();

  beforeEach(async () => {
    dir = await makeTempDir();
    socketPath = join(dir, "daemon.sock");
  });

  afterEach(async () => {
    await server?.stop();
    await rm(dir, { recursive: true, force: true });
  });

  itSocket("responds to a status request", async () => {
    const handler: RequestHandler = async (req) => {
      expect(req.type).toBe("status");
      return {};
    };
    server = new IPCServer(handler);
    await server.start(socketPath);

    const req = makeRequest("status");
    const res = await client.send(socketPath, req, 1000);

    expect(res).not.toBeNull();
    expect(res!.ok).toBe(true);
    expect(res!.requestId).toBe(req.requestId);
  });

  itSocket("routes a correct request and returns corrected command", async () => {
    const handler: RequestHandler = async (req) => {
      if (req.type === "correct") {
        return { corrected: "git merge" };
      }
      return {};
    };
    server = new IPCServer(handler);
    await server.start(socketPath);

    const req = makeRequest("correct", { buffer: "git meg e" });
    const res = await client.send(socketPath, req, 1000);

    expect(res).not.toBeNull();
    expect(res!.ok).toBe(true);
    expect(res!.data?.corrected).toBe("git merge");
  });

  itSocket("routes a suggest request and returns ghost text", async () => {
    const handler: RequestHandler = async (req) => {
      if (req.type === "suggest") {
        return { ghost: " add ." };
      }
      return {};
    };
    server = new IPCServer(handler);
    await server.start(socketPath);

    const req = makeRequest("suggest", { buffer: "git a" });
    const res = await client.send(socketPath, req, 1000);

    expect(res).not.toBeNull();
    expect(res!.ok).toBe(true);
    expect(res!.data?.ghost).toBe(" add .");
  });

  itSocket("routes a record request", async () => {
    let recorded = false;
    const handler: RequestHandler = async (req) => {
      if (req.type === "record") {
        recorded = true;
      }
      return {};
    };
    server = new IPCServer(handler);
    await server.start(socketPath);

    const req = makeRequest("record", { buffer: "git status" });
    const res = await client.send(socketPath, req, 1000);

    expect(res).not.toBeNull();
    expect(res!.ok).toBe(true);
    expect(recorded).toBe(true);
  });

  itSocket("routes a corrections request and returns correction records", async () => {
    const corrections = [
      { original: "git meg e", corrected: "git merge", timestamp: "2024-01-01T00:00:00.000Z" },
    ];
    const handler: RequestHandler = async (req) => {
      if (req.type === "corrections") {
        return { corrections };
      }
      return {};
    };
    server = new IPCServer(handler);
    await server.start(socketPath);

    const req = makeRequest("corrections");
    const res = await client.send(socketPath, req, 1000);

    expect(res).not.toBeNull();
    expect(res!.ok).toBe(true);
    expect(res!.data?.corrections).toEqual(corrections);
  });

  itSocket("returns ok:false when the handler throws", async () => {
    const handler: RequestHandler = async () => {
      throw new Error("engine failure");
    };
    server = new IPCServer(handler);
    await server.start(socketPath);

    const req = makeRequest("status");
    const res = await client.send(socketPath, req, 1000);

    expect(res).not.toBeNull();
    expect(res!.ok).toBe(false);
    expect(res!.error).toContain("engine failure");
    expect(res!.requestId).toBe(req.requestId);
  });

  itSocket("matches response to request by requestId", async () => {
    const handler: RequestHandler = async (req) => {
      return { corrected: `echo-${req.requestId}` };
    };
    server = new IPCServer(handler);
    await server.start(socketPath);

    const req = makeRequest("correct", { requestId: "unique-id-42" });
    const res = await client.send(socketPath, req, 1000);

    expect(res).not.toBeNull();
    expect(res!.requestId).toBe("unique-id-42");
    expect(res!.data?.corrected).toBe("echo-unique-id-42");
  });

  itSocket("can handle multiple sequential requests on separate connections", async () => {
    let callCount = 0;
    const handler: RequestHandler = async () => {
      callCount++;
      return {};
    };
    server = new IPCServer(handler);
    await server.start(socketPath);

    await client.send(socketPath, makeRequest("status"), 1000);
    await client.send(socketPath, makeRequest("status"), 1000);
    await client.send(socketPath, makeRequest("status"), 1000);

    expect(callCount).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Timeout behavior (8.5)
// ---------------------------------------------------------------------------

describe("IPCClient timeout", () => {
  let dir: string;
  let socketPath: string;
  let server: IPCServer;
  const client = new IPCClient();

  beforeEach(async () => {
    dir = await makeTempDir();
    socketPath = join(dir, "daemon.sock");
  });

  afterEach(async () => {
    await server?.stop();
    await rm(dir, { recursive: true, force: true });
  });

  itSocket("returns null when the handler never responds within the timeout", async () => {
    // Handler that never resolves
    const handler: RequestHandler = () => new Promise(() => {});
    server = new IPCServer(handler);
    await server.start(socketPath);

    const req = makeRequest("status");
    const start = Date.now();
    const res = await client.send(socketPath, req, 50);
    const elapsed = Date.now() - start;

    expect(res).toBeNull();
    // Should have timed out around 50ms (allow generous margin for CI)
    expect(elapsed).toBeGreaterThanOrEqual(40);
    expect(elapsed).toBeLessThan(500);
  });

  itSocket("uses 100ms as the default timeout", async () => {
    // Handler that never resolves
    const handler: RequestHandler = () => new Promise(() => {});
    server = new IPCServer(handler);
    await server.start(socketPath);

    const req = makeRequest("status");
    const start = Date.now();
    const res = await client.send(socketPath, req); // no explicit timeout
    const elapsed = Date.now() - start;

    expect(res).toBeNull();
    expect(elapsed).toBeGreaterThanOrEqual(90);
    expect(elapsed).toBeLessThan(500);
  });
});

// ---------------------------------------------------------------------------
// Socket unavailable — graceful pass-through (8.6)
// ---------------------------------------------------------------------------

describe("IPCClient socket unavailable", () => {
  let dir: string;
  const client = new IPCClient();

  beforeEach(async () => {
    dir = await makeTempDir();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns null when the socket file does not exist", async () => {
    const socketPath = join(dir, "nonexistent.sock");
    const req = makeRequest("status");
    const res = await client.send(socketPath, req, 200);
    expect(res).toBeNull();
  });

  it("returns null when the daemon is not listening on the socket", async () => {
    // Create a path that doesn't have a server listening
    const socketPath = join(dir, "no-server.sock");
    const req = makeRequest("correct", { buffer: "git meg e" });
    const res = await client.send(socketPath, req, 200);
    expect(res).toBeNull();
  });

  it("does not throw when the socket is unavailable", async () => {
    const socketPath = join(dir, "gone.sock");
    const req = makeRequest("suggest", { buffer: "git a" });
    await expect(client.send(socketPath, req, 200)).resolves.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// IPCServer — start / stop lifecycle
// ---------------------------------------------------------------------------

describe("IPCServer lifecycle", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeTempDir();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  itSocket("can start and stop cleanly", async () => {
    const socketPath = join(dir, "daemon.sock");
    const server = new IPCServer(async () => ({}));
    await server.start(socketPath);
    await expect(server.stop()).resolves.toBeUndefined();
  });

  itSocket("stop() is idempotent — calling twice does not throw", async () => {
    const socketPath = join(dir, "daemon.sock");
    const server = new IPCServer(async () => ({}));
    await server.start(socketPath);
    await server.stop();
    await expect(server.stop()).resolves.toBeUndefined();
  });

  itSocket("removes a stale socket file on start", async () => {
    const socketPath = join(dir, "daemon.sock");

    // Start and stop a first server to leave a socket file behind
    const server1 = new IPCServer(async () => ({}));
    await server1.start(socketPath);
    await server1.stop();

    // A second server should be able to bind to the same path
    const server2 = new IPCServer(async () => ({}));
    await expect(server2.start(socketPath)).resolves.toBeUndefined();
    await server2.stop();
  });
});
