import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { ConfigManager } from "./config.js";
import { KnownCommandsCorpus } from "./corpus.js";
import { AutocorrectEngine } from "./engines/autocorrect.js";
import { MemoryEngine } from "./engines/memory.js";
import type { MemoryPredictor } from "./engines/memory.js";
import {
  DefaultSuggestionProvider,
  SuggestionEngine,
} from "./engines/suggestion.js";
import type { SuggestionProvider } from "./engines/suggestion.js";
import { IPCServer } from "./ipc.js";
import type { IPCRequest, DaemonResponse, CorrectionRecord } from "./ipc.js";
import { PID_FILE_PATH, SOCKET_PATH, IS_WINDOWS } from "./paths.js";
import { writePidFile, deletePidFile } from "./storage.js";
import { initializeCorrectionsDictionary } from "./corrections-dictionary.js";
import { initializeSuggestionsDictionary, getDefaultSuggestionsDictionary } from "./suggestions-dictionary.js";
import type { SuggestionsDictionaryManager } from "./suggestions-dictionary.js";
import { initializeLearnedCorrections, getDefaultLearnedCorrections } from "./learned-corrections.js";
import type { LearnedCorrectionsManager } from "./learned-corrections.js";

// ---------------------------------------------------------------------------
// Daemon
// ---------------------------------------------------------------------------

/**
 * The long-running daemon process.
 *
 * Responsibilities:
 *  - Load config, build corpus, load history (9.1)
 *  - Start the IPC server (9.1)
 *  - Write PID lock file (9.1)
 *  - Handle SIGTERM / SIGINT: flush history, remove lock + socket, exit 0 (9.2)
 *  - Generate a random session ID per daemon start (9.3)
 *  - Maintain an in-memory corrections log for the current session (9.4)
 *  - Load external suggestion / memory providers from config if set (9.5)
 */
export class Daemon {
  // -------------------------------------------------------------------------
  // Configuration
  // -------------------------------------------------------------------------
  private readonly configPath: string | undefined;
  private readonly pidFilePath: string;
  private readonly socketPath: string;

  // -------------------------------------------------------------------------
  // Runtime state
  // -------------------------------------------------------------------------
  private configManager: ConfigManager | null = null;
  private corpus: KnownCommandsCorpus | null = null;
  private memoryEngine: MemoryEngine | null = null;
  private autocorrectEngine: AutocorrectEngine | null = null;
  private suggestionEngine: SuggestionEngine | null = null;
  private suggestionsDict: SuggestionsDictionaryManager | null = null;
  private learnedCorrections: LearnedCorrectionsManager | null = null;
  private ipcServer: IPCServer | null = null;

  /** Random UUID generated once per daemon start (9.3). */
  private sessionId: string = "";

  /** In-memory corrections log for the current session (9.4). */
  private correctionsLog: CorrectionRecord[] = [];

  /** Whether the daemon is currently running. */
  private running: boolean = false;

  constructor(options: {
    configPath?: string;
    pidFilePath?: string;
    socketPath?: string;
  } = {}) {
    this.configPath = options.configPath;
    this.pidFilePath = options.pidFilePath ?? PID_FILE_PATH;
    this.socketPath = options.socketPath ?? SOCKET_PATH;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Start the daemon:
   *  1. Generate session ID (9.3)
   *  2. Load config (9.1)
   *  3. Build corpus (9.1)
   *  4. Load history (9.1)
   *  5. Load external providers if configured (9.5)
   *  6. Start IPC server (9.1)
   *  7. Write PID lock file (9.1)
   *  8. Register signal handlers (9.2)
   */
  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    // 9.3 — generate session ID
    this.sessionId = randomUUID();

    // Reset corrections log for this session (9.4)
    this.correctionsLog = [];

    // 9.1 — load config
    this.configManager = new ConfigManager(this.configPath);
    await this.configManager.load();

    // 9.1 — build corpus
    this.corpus = new KnownCommandsCorpus();
    await this.corpus.build();

    // 9.1 — load history
    const historyPath = this.configManager.get("historyPath");
    const maxHistoryEntries = this.configManager.get("maxHistoryEntries");
    this.memoryEngine = new MemoryEngine(historyPath, { maxHistoryEntries });
    await this.memoryEngine.load();

    // 9.5 — load external providers (or fall back to built-in)
    const { suggestionProvider, memoryProvider } = await this._loadProviders();

    // Initialize packaged corrections and suggestions dictionaries.
    const correctionsDictionary = await initializeCorrectionsDictionary();
    this.suggestionsDict = await initializeSuggestionsDictionary();

    // Initialize learned corrections
    this.learnedCorrections = await initializeLearnedCorrections();

    // Build engines
    const maxEditDistance = this.configManager.get("maxEditDistance");
    this.autocorrectEngine = new AutocorrectEngine(this.corpus, { 
      maxEditDistance,
      correctionsDictionary,
      learnedCorrections: this.learnedCorrections 
    });

    this.suggestionEngine = new SuggestionEngine(suggestionProvider);

    // Override the memory engine if an external predictor was loaded
    if (memoryProvider !== null) {
      // Wrap the external predictor: we still use the built-in MemoryEngine for
      // persistence, but delegate predict() calls to the external provider.
      this._wrapMemoryPredictor(memoryProvider);
    }

    // 9.1 — start IPC server
    this.ipcServer = new IPCServer(this._handleRequest.bind(this));
    await this.ipcServer.start(this.socketPath);

    // 9.1 — write PID lock file
    await writePidFile(this.pidFilePath, process.pid);

    // 9.2 — register signal handlers
    this._registerSignalHandlers();

    this.running = true;
  }

  /**
   * Stop the daemon:
   *  1. Flush history to disk
   *  2. Remove PID lock file
   *  3. Remove socket file
   *  4. Stop IPC server
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }
    this.running = false;

    // Flush history
    if (this.memoryEngine !== null) {
      try {
        await this.memoryEngine.flush();
      } catch (err) {
        process.stderr.write(
          `[terminal-autocorrect] WARNING: failed to flush history on stop: ${String(err)}\n`
        );
      }
    }

    // Remove PID lock file
    try {
      await deletePidFile(this.pidFilePath);
    } catch (err) {
      process.stderr.write(
        `[terminal-autocorrect] WARNING: failed to remove PID file: ${String(err)}\n`
      );
    }

    // Remove socket file (Unix only — named pipes on Windows are OS-managed)
    if (!IS_WINDOWS) {
      try {
        await unlink(this.socketPath);
      } catch {
        // Ignore — file may already be gone
      }
    }

    // Stop IPC server
    if (this.ipcServer !== null) {
      try {
        await this.ipcServer.stop();
      } catch (err) {
        process.stderr.write(
          `[terminal-autocorrect] WARNING: failed to stop IPC server: ${String(err)}\n`
        );
      }
      this.ipcServer = null;
    }
  }

  // -------------------------------------------------------------------------
  // Accessors (for testing and CLI)
  // -------------------------------------------------------------------------

  /** The session ID generated at startup (9.3). */
  getSessionId(): string {
    return this.sessionId;
  }

  /** The in-memory corrections log for the current session (9.4). */
  getCorrectionsLog(): CorrectionRecord[] {
    return [...this.correctionsLog];
  }

  /** Whether the daemon is currently running. */
  isRunning(): boolean {
    return this.running;
  }

  // -------------------------------------------------------------------------
  // IPC request handler
  // -------------------------------------------------------------------------

  /**
   * Route an IPC request to the appropriate engine and return a response.
   */
  private async _handleRequest(request: IPCRequest): Promise<DaemonResponse> {
    switch (request.type) {
      case "correct":
        return this._handleCorrect(request);

      case "suggest":
        return this._handleSuggest(request);

      case "record":
        return this._handleRecord(request);

      case "corrections":
        return { corrections: [...this.correctionsLog] };

      case "learn":
        return this._handleLearn(request);

      case "status":
        return {};

      default: {
        // Exhaustiveness guard — unknown request type
        const _exhaustive: never = request.type;
        void _exhaustive;
        return {};
      }
    }
  }

  private _handleCorrect(request: IPCRequest): DaemonResponse {
    if (this.autocorrectEngine === null) {
      return {};
    }

    const buffer = request.buffer ?? "";
    const result = this.autocorrectEngine.correct(buffer);

    if (result.status === "corrected" && result.corrected !== undefined) {
      // Record to corrections log (9.4)
      const record: CorrectionRecord = {
        original: result.original,
        corrected: result.corrected,
        timestamp: new Date().toISOString(),
      };
      this.correctionsLog.push(record);

      return { corrected: result.corrected };
    }

    if (result.status === "ambiguous" && result.candidates !== undefined) {
      return { candidates: result.candidates };
    }

    return {};
  }

  private _handleSuggest(request: IPCRequest): DaemonResponse {
    if (this.suggestionEngine === null || this.memoryEngine === null || this.suggestionsDict === null) {
      return {};
    }

    const buffer = request.buffer ?? "";
    
    // First try the suggestions dictionary for fast prefix matching
    const dictSuggestion = this.suggestionsDict.getSuggestion(buffer);
    if (dictSuggestion && dictSuggestion !== buffer) {
      return { ghost: dictSuggestion };
    }

    // Fall back to the original suggestion engine (memory-based)
    const history = this.memoryEngine.getHistory();
    const result = this.suggestionEngine.suggest(buffer, history);

    if (result.ghost !== "") {
      return { ghost: result.ghost };
    }

    return {};
  }

  private _handleRecord(request: IPCRequest): DaemonResponse {
    if (this.memoryEngine === null) {
      return {};
    }

    const command = request.buffer ?? "";
    if (command.trim() !== "") {
      this.memoryEngine.record(command, request.sessionId ?? this.sessionId);
      
      // Learn suggestions from executed commands
      if (this.suggestionsDict && command.includes(' ')) {
        const tokens = command.split(' ');
        if (tokens.length >= 2) {
          // Learn prefix patterns: "git st" -> "git status"
          for (let i = 1; i < tokens.length; i++) {
            const prefix = tokens.slice(0, i + 1).join(' ');
            if (prefix.length >= 3 && prefix !== command) {
              this.suggestionsDict.learnSuggestion(prefix, command, tokens[0]);
            }
          }
        }
      }
    }

    return {};
  }

  private _handleLearn(request: IPCRequest): DaemonResponse {
    if (this.suggestionsDict === null) {
      return {};
    }

    const prefix = request.prefix ?? "";
    const completion = request.completion ?? "";
    
    if (prefix && completion && prefix !== completion) {
      // Learn this pattern
      this.suggestionsDict.learnSuggestion(prefix, completion);
    }

    return {};
  }

  // -------------------------------------------------------------------------
  // Signal handlers (9.2)
  // -------------------------------------------------------------------------

  /**
   * Register signal handlers that flush history, remove the lock file and
   * socket file, and exit with code 0.
   *
   * On Unix: SIGTERM and SIGINT.
   * On Windows: SIGINT is supported. SIGTERM is registered but may not be
   * delivered by external processes — the daemon also listens for a
   * 'shutdown' IPC message as the primary stop mechanism on Windows.
   */
  private _registerSignalHandlers(): void {
    const shutdown = (): void => {
      this.stop()
        .catch((err) => {
          process.stderr.write(
            `[terminal-autocorrect] WARNING: error during shutdown: ${String(err)}\n`
          );
        })
        .finally(() => {
          process.exit(0);
        });
    };

    process.on("SIGINT", shutdown);
    // SIGTERM works on Unix; on Windows it is registered but may not fire
    // from external kill — the CLI uses taskkill on Windows instead.
    process.on("SIGTERM", shutdown);
  }

  // -------------------------------------------------------------------------
  // Provider loading (9.5)
  // -------------------------------------------------------------------------

  /**
   * Load external suggestion and memory providers from the configured paths.
   *
   * Falls back to built-in providers if:
   *  - No path is configured
   *  - The module fails to load
   *  - The module does not export a valid default
   */
  private async _loadProviders(): Promise<{
    suggestionProvider: SuggestionProvider;
    memoryProvider: MemoryPredictor | null;
  }> {
    const config = this.configManager!;
    const corpus = this.corpus!;
    const memoryEngine = this.memoryEngine!;

    // --- Suggestion provider ---
    let suggestionProvider: SuggestionProvider;
    const suggestionProviderPath = config.get("suggestionProvider");

    if (suggestionProviderPath !== undefined && suggestionProviderPath !== "") {
      const loaded = await this._loadModule<SuggestionProvider>(
        suggestionProviderPath,
        "suggestion provider"
      );
      if (loaded !== null) {
        suggestionProvider = loaded;
      } else {
        // Fall back to built-in
        suggestionProvider = new DefaultSuggestionProvider(corpus, memoryEngine);
      }
    } else {
      suggestionProvider = new DefaultSuggestionProvider(corpus, memoryEngine);
    }

    // --- Memory predictor ---
    let memoryProvider: MemoryPredictor | null = null;
    const memoryProviderPath = config.get("memoryProvider");

    if (memoryProviderPath !== undefined && memoryProviderPath !== "") {
      const loaded = await this._loadModule<MemoryPredictor>(
        memoryProviderPath,
        "memory provider"
      );
      if (loaded !== null) {
        memoryProvider = loaded;
      }
      // If loading failed, memoryProvider stays null → built-in MemoryEngine used
    }

    return { suggestionProvider, memoryProvider };
  }

  /**
   * Dynamically import a module at `modulePath` and return its default export.
   *
   * Returns `null` and logs a warning if the module cannot be loaded or does
   * not export a default.
   */
  private async _loadModule<T>(modulePath: string, label: string): Promise<T | null> {
    try {
      // Dynamic import — works for both ESM and CJS modules
      const mod = await import(modulePath) as { default?: T };
      if (mod.default === undefined || mod.default === null) {
        process.stderr.write(
          `[terminal-autocorrect] WARNING: ${label} at "${modulePath}" has no default export, using built-in\n`
        );
        return null;
      }
      return mod.default;
    } catch (err) {
      process.stderr.write(
        `[terminal-autocorrect] WARNING: failed to load ${label} from "${modulePath}": ${String(err)}, using built-in\n`
      );
      return null;
    }
  }

  /**
   * Wrap the built-in MemoryEngine's predict() with the external predictor.
   *
   * We keep the MemoryEngine for persistence (record/load/save) but delegate
   * predict() calls to the external provider.
   */
  private _wrapMemoryPredictor(externalPredictor: MemoryPredictor): void {
    if (this.memoryEngine === null) return;

    // Monkey-patch predict on the existing MemoryEngine instance so that
    // the SuggestionEngine (which holds a reference to it) picks up the change.
    const engine = this.memoryEngine;
    engine.predict = (recentCommands: string[]) =>
      externalPredictor.predict(recentCommands);
  }
}
