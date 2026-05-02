# Tasks

## Task List

- [x] 1. Project scaffolding and tooling setup
  - [x] 1.1 Initialize npm package with TypeScript, ESM, and Vitest configuration
  - [x] 1.2 Set up directory structure: `src/engines/`, `src/__tests__/unit/`, `src/__tests__/property/`, `src/__tests__/integration/`
  - [x] 1.3 Add dependencies: `fastest-levenshtein`, `fast-check`, `commander` (CLI), `vitest`
  - [x] 1.4 Configure `tsconfig.json` for Node.js ESM output targeting Node 18+
  - [x] 1.5 Add npm scripts: `build`, `test`, `test:unit`, `test:property`, `test:integration`, `dev`
  - [x] 1.6 Create `~/.terminal-autocorrect/` directory structure constants in `src/paths.ts`

- [x] 2. Config Manager (`src/config.ts`)
  - [x] 2.1 Define `Config` interface with all 8 configurable keys and their types/defaults
  - [x] 2.2 Implement `ConfigManager` class with `load()`, `save()`, `get()`, `set()`, `list()` methods
  - [x] 2.3 Implement default value application when config file is missing
  - [x] 2.4 Implement corrupt config file recovery (apply defaults, overwrite, log warning)
  - [x] 2.5 Implement config key validation — reject unknown keys with descriptive error
  - [x] 2.6 Implement value type validation for each config key
  - [x] 2.7 Write unit tests for ConfigManager (missing file, corrupt file, valid set/get, invalid key, invalid type)
  - [x] 2.8 Write property test for Property 8: Config round-trip — for any valid config object, write then read produces deeply equal result
  - [x] 2.9 Write property test for Property 9: Config rejects invalid keys — for any string not in valid key set, config set returns error without modifying stored config

- [x] 3. Known Commands Corpus (`src/corpus.ts`)
  - [x] 3.1 Implement `PrefixTrie` data structure with `insert(command)` and `lookup(prefix)` methods
  - [x] 3.2 Implement `KnownCommandsCorpus` class that reads `$PATH` executables at startup
  - [x] 3.3 Bundle a static list of common commands and their subcommands (git, npm, docker, kubectl, cd, ls, etc.)
  - [x] 3.4 Build the trie from both `$PATH` executables and the bundled static list
  - [x] 3.5 Expose `subcommands: Map<string, Set<string>>` for per-command subcommand lookup
  - [x] 3.6 Write unit tests for PrefixTrie (insert, lookup, empty prefix, no match)
  - [x] 3.7 Write unit tests for corpus building (static list loaded, PATH executables included)

- [x] 4. Autocorrect Engine (`src/engines/autocorrect.ts`)
  - [x] 4.1 Implement `FuzzyMatcher` using `fastest-levenshtein` to find closest corpus entries
  - [x] 4.2 Implement `AutocorrectEngine.correct(input)` — tokenize input, check first token against corpus
  - [x] 4.3 Implement edit distance threshold check: correct only when distance ≤ `maxEditDistance` and no tie
  - [x] 4.4 Implement ambiguity detection: return `{status: "ambiguous", candidates}` when two entries tie
  - [x] 4.5 Implement subcommand fuzzy matching: when first token is known, apply fuzzy match to subcommand token
  - [x] 4.6 Implement built-in git correction rules map (meg→merge, chekout→checkout, comit→commit, statsu→status, etc.)
  - [x] 4.7 Apply built-in rules before fuzzy matching for performance
  - [x] 4.8 Preserve all non-corrected tokens (arguments, flags) in the corrected output
  - [x] 4.9 Write unit tests for specific git correction examples (each built-in rule)
  - [x] 4.10 Write unit tests for edge cases: empty input, single token, distance exactly at threshold, distance one above threshold
  - [x] 4.11 Write property test for Property 1: Autocorrect fires iff within threshold — for any token and maxEditDistance, correction happens iff closest match distance ≤ threshold with no tie
  - [x] 4.12 Write property test for Property 2: Ambiguity produces no correction — for any token equidistant from multiple corpus entries, result is "ambiguous"
  - [x] 4.13 Write property test for Property 3: Corrected command preserves non-corrected tokens — for any command with one mistyped token, all other tokens are unchanged in output

- [x] 5. Suggestion Engine (`src/engines/suggestion.ts`)
  - [x] 5.1 Implement `SuggestionProvider` interface with `suggest(buffer, history)` returning `SuggestionResult`
  - [x] 5.2 Implement default rule-based provider using `PrefixTrie.lookup()` for prefix matching
  - [x] 5.3 Implement frequency-based ranking: sort candidates by count in `CommandHistory`, return highest-frequency as ghost text
  - [x] 5.4 Implement ghost text computation: `ghost = fullSuggestion.slice(buffer.length)`
  - [x] 5.5 Return empty ghost text when buffer matches no known prefix
  - [x] 5.6 Delegate to `MemoryEngine.predict()` when buffer is empty
  - [x] 5.7 Dismiss prediction ghost text when typed prefix does not match predicted command
  - [x] 5.8 Write unit tests for specific suggestion examples (git a → git add ., npm i → npm install)
  - [x] 5.9 Write unit tests for empty buffer prediction delegation, Escape dismissal, Tab acceptance
  - [x] 5.10 Write property test for Property 4: Ghost text is always a valid completion — for any buffer with a suggestion, buffer + ghost starts with buffer and full suggestion is in corpus/history
  - [x] 5.11 Write property test for Property 5: Ranking respects history frequency — for any buffer matching multiple completions, returned ghost text is the highest-frequency completion

- [x] 6. Memory Engine (`src/engines/memory.ts`)
  - [x] 6.1 Implement `MemoryPredictor` interface with `predict(recentCommands)` and `record(command, sessionId)` methods
  - [x] 6.2 Implement `HistoryEntry` and `Pattern` data structures as defined in design
  - [x] 6.3 Implement command recording: append to in-memory history and schedule disk write within 500ms
  - [x] 6.4 Implement pattern extraction: after each command, check if (prev, current) pair forms a pattern; increment count
  - [x] 6.5 Implement prediction: return next command prediction only when pattern count ≥ 2
  - [x] 6.6 Implement branch variable extraction: detect `git checkout <branch>` and store pattern with `{branch}` slot
  - [x] 6.7 Implement branch variable substitution in predictions: replace `{branch}` with actual branch from most recent checkout
  - [x] 6.8 Implement history cap: when entries exceed `maxHistoryEntries`, remove oldest entries
  - [x] 6.9 Implement `load()` from disk and `save()` to disk using JSON format
  - [x] 6.10 Implement corrupt history file recovery: rename to `.bak`, create empty file, log warning
  - [x] 6.11 Write unit tests for pattern recording, prediction threshold, corrupt file recovery, history clear
  - [x] 6.12 Write property test for Property 6: History persistence round-trip — for any sequence of recorded commands, serialize then deserialize produces structurally equivalent history
  - [x] 6.13 Write property test for Property 7: History cap enforcement — for any history at max capacity, adding one entry keeps count at max with oldest removed
  - [x] 6.14 Write property test for Property 10: Memory pattern threshold — for any command pair, prediction generated iff pattern count ≥ 2
  - [x] 6.15 Write property test for Property 11: Branch variable substitution — for any branch name in git checkout, pattern uses {branch} slot and prediction substitutes actual branch name

- [x] 7. Persistent Storage and File I/O (`src/storage.ts`)
  - [x] 7.1 Implement atomic file write using temp file + rename to prevent partial writes
  - [x] 7.2 Implement `readJSON<T>(path)` with error handling for missing and corrupt files
  - [x] 7.3 Implement `writeJSON<T>(path, data)` with 500ms debounce for history writes
  - [x] 7.4 Implement lock file read/write/delete operations
  - [x] 7.5 Write unit tests for missing file, corrupt JSON, successful read/write, atomic write behavior

- [x] 8. IPC Layer (`src/ipc.ts`)
  - [x] 8.1 Implement Unix domain socket server in daemon: listen on `~/.terminal-autocorrect/daemon.sock`
  - [x] 8.2 Implement newline-delimited JSON message framing for IPC protocol
  - [x] 8.3 Implement `IPCRequest` and `IPCResponse` types as defined in design
  - [x] 8.4 Implement request routing: dispatch `correct`, `suggest`, `record`, `corrections`, `status` requests to appropriate engines
  - [x] 8.5 Implement IPC client for CLI commands: connect to socket, send request, await response with 100ms timeout
  - [x] 8.6 Implement graceful handling when daemon socket is unavailable (silent pass-through)
  - [x] 8.7 Write unit tests for message framing, request routing, timeout behavior, socket unavailable

- [x] 9. Daemon Process (`src/daemon.ts`)
  - [x] 9.1 Implement daemon startup: load config, build corpus, load history, start IPC server, write PID lock file
  - [x] 9.2 Implement signal handlers for SIGTERM and SIGINT: flush history, remove lock file and socket file, exit 0
  - [x] 9.3 Implement session ID generation (random UUID per daemon start)
  - [x] 9.4 Implement corrections log: maintain in-memory list of `CorrectionRecord` entries for the current session
  - [x] 9.5 Implement provider loading: load external suggestion/memory provider from configured path if set
  - [x] 9.6 Write unit tests for signal handler behavior (lock file removed, socket file removed)

- [x] 10. CLI Entry Point (`src/cli.ts`)
  - [x] 10.1 Set up `commander`-based CLI with `terminal-autocorrect` binary name and `tac` alias
  - [x] 10.2 Implement `start` command: check for existing PID, spawn daemon as detached child, write PID
  - [x] 10.3 Implement `stop` command: read PID from lock file, send SIGTERM; error with non-zero exit if no daemon
  - [x] 10.4 Implement `status` command: check lock file + process liveness, print running/stopped
  - [x] 10.5 Implement `init <shell>` command: output shell hook snippet for bash or zsh
  - [x] 10.6 Implement `corrections` command: query daemon via IPC for session corrections log
  - [x] 10.7 Implement `config set <key> <value>` with key and type validation
  - [x] 10.8 Implement `config get <key>` with key validation
  - [x] 10.9 Implement `config list` displaying all keys and current values
  - [x] 10.10 Implement `history clear` with confirmation prompt before deleting history
  - [x] 10.11 Write unit tests for each CLI command: correct output, error messages, exit codes
  - [x] 10.12 Write unit tests for `init` command: verify bash and zsh snippets contain required hook functions

- [x] 11. Shell Hook Generation (`src/shell-hook.ts`)
  - [x] 11.1 Implement zsh hook snippet: `_tac_preexec` using `add-zsh-hook`, ZLE widget for Tab, ANSI ghost text rendering
  - [x] 11.2 Implement bash hook snippet: `bash-preexec` compatible `preexec` and `precmd` functions
  - [x] 11.3 Implement IPC call within hook: pipe buffer to `terminal-autocorrect --ipc <type>` with 100ms timeout
  - [x] 11.4 Implement ghost text rendering in hook: ANSI dim escape sequence, cleared on next keystroke
  - [x] 11.5 Write unit tests for hook snippet generation: verify required function names and ANSI codes are present

- [x] 12. Provider Interface and Extensibility (`src/providers/`)
  - [x] 12.1 Define and export `SuggestionProvider` interface in `src/providers/types.ts`
  - [x] 12.2 Define and export `MemoryPredictor` interface in `src/providers/types.ts`
  - [x] 12.3 Implement built-in rule-based suggestion provider as a class implementing `SuggestionProvider`
  - [x] 12.4 Implement built-in rule-based memory predictor as a class implementing `MemoryPredictor`
  - [x] 12.5 Implement dynamic provider loading: `require(path)` or `import(path)` for external providers
  - [x] 12.6 Write property test for Property 12: Provider interface conformance — for any input, built-in provider returns SuggestionResult with confidence in [0,1] and valid source enum value

- [x] 13. Integration tests
  - [x] 13.1 Write integration test for daemon lifecycle: start → status (running) → stop → status (stopped)
  - [x] 13.2 Write integration test for IPC round-trip: start daemon, send correct request, verify response
  - [x] 13.3 Write integration test for history persistence across daemon restarts: record commands, stop daemon, start daemon, verify history loaded
  - [x] 13.4 Write integration test for config persistence: set config value, stop daemon, start daemon, verify value persisted
  - [x] 13.5 Write integration test for corrupt history recovery: write corrupt history file, start daemon, verify .bak file created and daemon starts cleanly

- [x] 14. Package and distribution
  - [x] 14.1 Configure `package.json` `bin` field for `terminal-autocorrect` and `tac` executables
  - [x] 14.2 Add `files` field to `package.json` to include only `dist/` and `README.md`
  - [x] 14.3 Write `README.md` with installation instructions, `tac init` setup, and configuration reference
  - [x] 14.4 Add `.npmignore` to exclude test files, source maps, and spec documents from published package
  - [x] 14.5 Verify `npm pack` output contains correct files and binary is executable
