import { createServer, createConnection } from "node:net";
import type { Server, Socket } from "node:net";
import { unlink } from "node:fs/promises";
import { IS_WINDOWS } from "./paths.js";

// ---------------------------------------------------------------------------
// Types (8.3)
// ---------------------------------------------------------------------------

/**
 * Request sent from the shell hook (or CLI) to the daemon over the Unix
 * domain socket.
 */
export interface IPCRequest {
  type: "correct" | "suggest" | "record" | "corrections" | "status" | "learn";
  buffer?: string;
  prefix?: string;
  completion?: string;
  sessionId: string;
  requestId: string; // for matching responses
}

/**
 * Response sent from the daemon back to the caller.
 */
export interface IPCResponse {
  requestId: string;
  ok: boolean;
  data?: DaemonResponse;
  error?: string;
}

/**
 * Payload carried inside a successful IPCResponse.
 */
export interface DaemonResponse {
  corrected?: string;              // for "correct" requests
  ghost?: string;                  // for "suggest" requests
  candidates?: string[];           // ambiguous corrections
  corrections?: CorrectionRecord[]; // for "corrections" requests
}

/**
 * A single autocorrection record stored in the session log.
 */
export interface CorrectionRecord {
  original: string;
  corrected: string;
  timestamp: string; // ISO 8601 UTC
}

// ---------------------------------------------------------------------------
// Message framing helpers (8.2)
// ---------------------------------------------------------------------------

/**
 * Encode a single IPC message as a newline-terminated JSON string.
 */
export function encodeMessage<T>(message: T): string {
  return JSON.stringify(message) + "\n";
}

/**
 * Split a raw buffer string into complete JSON messages.
 *
 * Returns an object with:
 *  - `messages`: array of parsed message objects
 *  - `remainder`: any trailing bytes that do not yet form a complete message
 *
 * Malformed JSON lines are silently skipped (the line is consumed but not
 * returned as a message).
 */
export function decodeMessages<T>(raw: string): { messages: T[]; remainder: string } {
  const lines = raw.split("\n");
  // The last element is either an empty string (if raw ends with \n) or a
  // partial line that has not yet been terminated.
  const remainder = lines.pop() ?? "";

  const messages: T[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    try {
      messages.push(JSON.parse(trimmed) as T);
    } catch {
      // Malformed line — skip silently
    }
  }

  return { messages, remainder };
}

// ---------------------------------------------------------------------------
// IPCServer (8.1, 8.4)
// ---------------------------------------------------------------------------

/**
 * Handler function type: receives a request and returns a DaemonResponse.
 */
export type RequestHandler = (request: IPCRequest) => Promise<DaemonResponse>;

/**
 * Unix domain socket server.
 *
 * Accepts connections, reads newline-delimited JSON requests, dispatches
 * them to the provided handler, and writes newline-delimited JSON responses.
 *
 * Usage:
 * ```ts
 * const server = new IPCServer(async (req) => {
 *   if (req.type === "status") return {};
 *   return { corrected: "git merge" };
 * });
 * await server.start(SOCKET_PATH);
 * // ...
 * await server.stop();
 * ```
 */
export class IPCServer {
  private readonly handler: RequestHandler;
  private server: Server | null = null;
  private socketPath: string | null = null;

  constructor(handler: RequestHandler) {
    this.handler = handler;
  }

  /**
   * Start listening on `socketPath`.
   *
   * Removes any stale socket file before binding so that a crashed daemon
   * does not prevent a clean restart.
   */
  async start(socketPath: string): Promise<void> {
    this.socketPath = socketPath;

    // Remove stale socket file if it exists (Unix only — named pipes on
    // Windows are managed by the OS and do not leave files on disk).
    if (!IS_WINDOWS) {
      try {
        await unlink(socketPath);
      } catch {
        // Ignore — file may not exist
      }
    }

    return new Promise((resolve, reject) => {
      const server = createServer((socket: Socket) => {
        this._handleConnection(socket);
      });

      server.on("error", (err) => {
        reject(err);
      });

      server.listen(socketPath, () => {
        this.server = server;
        resolve();
      });
    });
  }

  /**
   * Stop the server and remove the socket file.
   */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server === null) {
        resolve();
        return;
      }

      this.server.close(() => {
        this.server = null;
        // Best-effort socket file removal (Unix only)
        if (this.socketPath !== null && !IS_WINDOWS) {
          const path = this.socketPath;
          this.socketPath = null;
          unlink(path).catch(() => {
            // Ignore — file may already be gone
          });
        } else {
          this.socketPath = null;
        }
        resolve();
      });
    });
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Handle a single client connection.
   *
   * Accumulates incoming data into a buffer, splits on newlines, parses each
   * complete line as an IPCRequest, dispatches to the handler, and writes
   * the IPCResponse back.
   */
  private _handleConnection(socket: Socket): void {
    let buffer = "";

    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf-8");
      const { messages, remainder } = decodeMessages<IPCRequest>(buffer);
      buffer = remainder;

      for (const request of messages) {
        this._dispatchRequest(socket, request);
      }
    });

    socket.on("error", () => {
      // Ignore per-connection errors (client disconnected, etc.)
    });
  }

  /**
   * Dispatch a single request to the handler and write the response.
   */
  private _dispatchRequest(socket: Socket, request: IPCRequest): void {
    const requestId = request.requestId ?? "";

    this.handler(request)
      .then((data) => {
        const response: IPCResponse = {
          requestId,
          ok: true,
          data,
        };
        socket.write(encodeMessage(response));
      })
      .catch((err: unknown) => {
        const response: IPCResponse = {
          requestId,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
        socket.write(encodeMessage(response));
      });
  }
}

// ---------------------------------------------------------------------------
// IPCClient (8.5, 8.6)
// ---------------------------------------------------------------------------

/**
 * Unix domain socket client.
 *
 * Connects to the daemon socket, sends a single request, and awaits the
 * matching response.  Returns `null` on timeout or connection failure so
 * that the shell hook can silently pass through the original command.
 *
 * Usage:
 * ```ts
 * const client = new IPCClient();
 * const response = await client.send(SOCKET_PATH, request, 100);
 * if (response === null) {
 *   // daemon unavailable — pass through
 * }
 * ```
 */
export class IPCClient {
  /**
   * Send `request` to the daemon at `socketPath` and await the response.
   *
   * @param socketPath  - Path to the Unix domain socket
   * @param request     - The request to send
   * @param timeoutMs   - Milliseconds to wait before giving up (default: 100)
   * @returns The IPCResponse, or `null` if the daemon is unavailable or
   *          the call times out.
   */
  async send(
    socketPath: string,
    request: IPCRequest,
    timeoutMs: number = 100
  ): Promise<IPCResponse | null> {
    return new Promise((resolve) => {
      let settled = false;
      let buffer = "";

      const settle = (value: IPCResponse | null): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          socket.destroy();
        } catch {
          // Ignore
        }
        resolve(value);
      };

      // Timeout: resolve with null if daemon doesn't respond in time (8.5)
      const timer = setTimeout(() => {
        settle(null);
      }, timeoutMs);

      // Attempt connection (8.6 — connection failure → null)
      const socket = createConnection({ path: socketPath }, () => {
        // Connected — send the request
        socket.write(encodeMessage(request));
      });

      socket.on("data", (chunk: Buffer) => {
        buffer += chunk.toString("utf-8");
        const { messages, remainder } = decodeMessages<IPCResponse>(buffer);
        buffer = remainder;

        // Find the response matching our requestId
        for (const msg of messages) {
          if (msg.requestId === request.requestId) {
            settle(msg);
            return;
          }
        }
      });

      socket.on("error", () => {
        // Connection refused, socket not found, etc. — silent pass-through (8.6)
        settle(null);
      });

      socket.on("close", () => {
        // Server closed the connection before we got a response
        settle(null);
      });
    });
  }
}
