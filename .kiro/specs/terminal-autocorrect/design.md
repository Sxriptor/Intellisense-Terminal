# Design Document

## Terminal Autocorrect

### Overview

Terminal Autocorrect is a lightweight Node.js background daemon that integrates with the user's shell (bash/zsh) via shell hooks to provide three layers of intelligence:

1. **Autocorrect** — detects and corrects mistyped commands before execution using fuzzy edit-distance matching
2. **Inline ghost-text suggestions** — displays completions as the user types, accepted with Tab
3. **Memory-based next-command prediction** — learns from the user's own command sequences to predict the next likely command

The system is distributed as an npm package with a CLI entry point (`terminal-autocorrect` or `tac`). No GUI, Electron, or browser runtime is required. The daemon communicates with the shell hook via a Unix domain socket (IPC), keeping latency below the perceptible threshold.

**Key design decisions:**

- **Shell hooks over PTY interception**: Rather than intercepting raw PTY input (which requires native binaries and root access), the daemon integrates via `preexec`/`precmd` hooks in zsh and `PROMPT_COMMAND`/`bash-preexec` in bash. This is the same approach used by tools like `direnv`, `starship`, and `atuin`. It is portable, safe, and requires no elevated permissions.
- **Unix domain socket IPC**: The shell hook sends the current command buffer to the daemon over a Unix socket. The daemon responds with corrections or suggestions. This keeps the shell hook itself minimal (a few lines of shell script) while all logic lives in Node.js.
- **Rule-based engine with pluggable provider interface**: The initial implementation uses Levenshtein edit distance and trie-based prefix matching. The provider interface is designed so an AI/ML backend can be swapped in via configuration without changing the shell hook or daemon lifecycle code.
- **`fastest-levenshtein`** for edit-distance computation — the fastest JS/TS implementation, with 554+ dependents and active maintenance.
- **`fast-check`** for property-based testing — the standard PBT library for TypeScript.

---

### Architecture

The system has three runtime layers:

```
┌─────────────────────────────────────────────────────────────┐
│  Shell Session (bash / zsh)                                  │
│                                                              │
│  User types: git meg e origin main                           │
│  preexec hook fires → sends buffer to daemon via IPC         │
│  Daemon responds: { corrected: "git merge origin main" }     │
│  Shell hook replaces buffer and executes corrected command   │
│                                                              │
│  ZLE widget (zsh) / readline binding (bash) fires on each   │
│  keystroke → sends partial buffer → daemon responds with     │
│  ghost-text suggestion → hook renders it via ANSI escape     │
└─────────────────────────────────────────────────────────────┘
                          │  Unix Domain Socket
                          │  (~/.terminal-autocorrect/daemon.sock)
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  Daemon Process (Node.js)                                    │
│                                                              │
│  ┌──────────────────┐  ┌──────────────────┐                 │
│  │  Autocorrect     │  │  Suggestion      │                 │
│  │  Engine          │  │  Engine          │                 │
│  │  (FuzzyMatcher)  │  │  (PrefixTrie +   │                 │
│  └──────────────────┘  │   HistoryRanker) │                 │
│                         └──────────────────┘                 │
│  ┌──────────────────┐  ┌──────────────────┐                 │
│  │  Memory Engine   │  │  Config Manager  │                 │
│  │  (PatternStore)  │  │  (JSON file)     │                 │
│  └──────────────────┘  └──────────────────┘                 │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  Persistent Storage (~/.terminal-autocorrect/)               │
│  ├── config.json       (user settings)                       │
│  ├── history.json      (command history + patterns)          │
│  ├── daemon.pid        (lock file)                           │
│  └── daemon.sock       (Unix domain socket)                  │
└─────────────────────────────────────────────────────────────┘
```

**Data flow for autocorrect (on Enter):**

```
preexec(cmd) → IPC request {type:"correct", buffer:cmd}
             → AutocorrectEngine.correct(cmd)
             → FuzzyMatcher.findClosest(token, knownCommands)
             → if distance ≤ maxEditDistance → return corrected cmd
             → IPC response {corrected:"git merge origin main"}
             → shell hook: print "✓ autocorrected: git merge origin main"
             → execute corrected command
```

**Data flow for ghost-text (on each keystroke):**

```
ZLE widget fires → IPC request {type:"suggest", buffer:"git a"}
                → SuggestionEngine.suggest("git a")
                → MemoryEngine.predict(recentCommands) if buffer empty
                → PrefixTrie.lookup("git a") → ["git add", "git archive"]
                → rank by history frequency → "git add ."
                → IPC response {ghost:" add ."}
                → ZLE widget renders ghost text in dim ANSI color
```

---

### Components and Interfaces

#### 1. CLI Entry Point (`src/cli.ts`)

The CLI is the user-facing binary. It delegates to the daemon for runtime operations and to the config manager for settings.

```typescript
interface CLI {
  start(): Promise<void>;       // launch daemon as detached child process
  stop(): Promise<void>;        // send SIGTERM to PID from lock file
  status(): Promise<void>;      // check lock file + process liveness
  init(shell: "bash" | "zsh"): Promise<void>; // print shell hook snippet
  corrections(): Promise<void>; // query daemon for session corrections log
  configSet(key: string, value: string): Promise<void>;
  configGet(key: string): Promise<void>;
  configList(): Promise<void>;
  historyClear(): Promise<void>;
}
```

#### 2. Daemon (`src/daemon.ts`)

The daemon is a long-running Node.js process that listens on a Unix domain socket and coordinates all engines.

```typescript
interface DaemonRequest {
  type: "correct" | "suggest" | "record" | "corrections";
  buffer: string;
  sessionId: string;
}

interface DaemonResponse {
  corrected?: string;           // for "correct" requests
  ghost?: string;               // for "suggest" requests
  candidates?: string[];        // ambiguous corrections
  corrections?: CorrectionRecord[]; // for "corrections" requests
}

interface CorrectionRecord {
  original: string;
  corrected: string;
  timestamp: string;
}
```

#### 3. Autocorrect Engine (`src/engines/autocorrect.ts`)

```typescript
interface AutocorrectEngine {
  correct(input: string): AutocorrectResult;
}

interface AutocorrectResult {
  status: "corrected" | "ambiguous" | "unchanged" | "unknown";
  corrected?: string;           // the corrected command string
  candidates?: string[];        // when status === "ambiguous"
  original: string;
}

interface FuzzyMatcher {
  findClosest(token: string, corpus: string[]): MatchResult[];
}

interface MatchResult {
  token: string;
  distance: number;
}
```

The engine tokenizes the input, checks the first token against `KnownCommands`, then checks subsequent tokens against the known subcommands for that command. It uses `fastest-levenshtein` for distance computation.

**Built-in git correction rules** are stored as a static map and checked before fuzzy matching for performance:

```typescript
const GIT_CORRECTIONS: Record<string, string> = {
  "meg": "merge",
  "mege": "merge",
  "chekout": "checkout",
  "chekcout": "checkout",
  "comit": "commit",
  "statsu": "status",
  "stauts": "status",
  // ...
};
```

#### 4. Suggestion Engine (`src/engines/suggestion.ts`)

```typescript
interface SuggestionProvider {
  suggest(buffer: string, history: CommandHistory): SuggestionResult;
}

interface SuggestionResult {
  ghost: string;                // text to append after cursor
  confidence: number;           // 0.0–1.0
  source: "prefix" | "memory" | "none";
}
```

The default implementation uses a `PrefixTrie` built from `KnownCommands` and history. Candidates are ranked by frequency in `CommandHistory`. When the buffer is empty, it delegates to `MemoryEngine.predict()`.

```typescript
interface PrefixTrie {
  insert(command: string): void;
  lookup(prefix: string): string[]; // returns all completions for prefix
}
```

#### 5. Memory Engine (`src/engines/memory.ts`)

```typescript
interface MemoryPredictor {
  predict(recentCommands: string[]): PredictionResult[];
  record(command: string, sessionId: string): void;
}

interface PredictionResult {
  command: string;
  confidence: number;
}

// Stored pattern structure
interface Pattern {
  trigger: string;              // command_A (normalized)
  prediction: string;           // command_B (normalized, with variable slots)
  count: number;                // how many times this pair was observed
}

// Variable slot example: "git checkout {branch}" → "git pull origin {branch}"
interface CommandHistory {
  entries: HistoryEntry[];
  patterns: Pattern[];
}

interface HistoryEntry {
  command: string;
  timestamp: string;            // ISO 8601 UTC
  sessionId: string;
}
```

Branch-aware patterns use `{branch}` as a named variable slot. When `git checkout main` is recorded, the pattern stores `git checkout {branch}` → `git pull origin {branch}`, and the prediction substitutes the actual branch name.

#### 6. Config Manager (`src/config.ts`)

```typescript
interface Config {
  maxEditDistance: number;       // default: 2
  maxHistoryEntries: number;     // default: 10000
  historyPath: string;           // default: ~/.terminal-autocorrect/history.json
  suggestionColor: string;       // default: "dim" (ANSI)
  enabled: boolean;              // default: true
  autocorrectEnabled: boolean;   // default: true
  suggestionsEnabled: boolean;   // default: true
  memoryEnabled: boolean;        // default: true
  suggestionProvider?: string;   // path to external provider module
  memoryProvider?: string;       // path to external predictor module
}

interface ConfigManager {
  get<K extends keyof Config>(key: K): Config[K];
  set<K extends keyof Config>(key: K, value: Config[K]): void;
  list(): Config;
  load(): Promise<void>;
  save(): Promise<void>;
}
```

#### 7. Known Commands Corpus (`src/corpus.ts`)

The corpus is built at daemon startup by:
1. Reading `$PATH` directories and listing executable files
2. Merging with a bundled static list of common commands and their subcommands (git, npm, docker, kubectl, etc.)
3. Storing in a `PrefixTrie` for O(k) prefix lookups (k = prefix length)

```typescript
interface KnownCommandsCorpus {
  commands: Set<string>;
  subcommands: Map<string, Set<string>>; // command → set of subcommands
  trie: PrefixTrie;
  build(): Promise<void>;
}
```

#### 8. Shell Hook (`src/shell-hook.ts`)

The `init` command outputs a shell snippet. For zsh:

```zsh
# terminal-autocorrect zsh hook
_tac_preexec() {
  local result
  result=$(echo "$1" | terminal-autocorrect --ipc correct 2>/dev/null)
  if [[ -n "$result" ]]; then
    print -n "\r\033[K✓ autocorrected: $result\n"
    # re-execute corrected command
    eval "$result"
    return 1  # prevent original command from running
  fi
}

_tac_zle_widget() {
  local ghost
  ghost=$(echo "$BUFFER" | terminal-autocorrect --ipc suggest 2>/dev/null)
  if [[ -n "$ghost" ]]; then
    # render ghost text using ANSI dim
    print -Pn "\033[2m${ghost}\033[0m"
  fi
}

autoload -Uz add-zsh-hook
add-zsh-hook preexec _tac_preexec
zle -N _tac_zle_widget
bindkey '^I' _tac_zle_widget  # Tab
```

For bash, the hook uses `bash-preexec` (a widely-used compatibility shim) to provide equivalent `preexec` and `precmd` functions.

---

### Data Models

#### History File (`~/.terminal-autocorrect/history.json`)

```json
{
  "version": 1,
  "entries": [
    {
      "command": "git fetch",
      "timestamp": "2024-01-15T10:23:45.000Z",
      "sessionId": "abc123"
    },
    {
      "command": "git checkout main",
      "timestamp": "2024-01-15T10:23:50.000Z",
      "sessionId": "abc123"
    }
  ],
  "patterns": [
    {
      "trigger": "git checkout {branch}",
      "prediction": "git pull origin {branch}",
      "count": 7
    },
    {
      "trigger": "git fetch",
      "prediction": "git checkout {branch}",
      "count": 3
    }
  ]
}
```

#### Config File (`~/.terminal-autocorrect/config.json`)

```json
{
  "maxEditDistance": 2,
  "maxHistoryEntries": 10000,
  "historyPath": "~/.terminal-autocorrect/history.json",
  "suggestionColor": "dim",
  "enabled": true,
  "autocorrectEnabled": true,
  "suggestionsEnabled": true,
  "memoryEnabled": true
}
```

#### IPC Message Protocol

Messages are newline-delimited JSON over the Unix domain socket:

```typescript
// Request (shell → daemon)
interface IPCRequest {
  type: "correct" | "suggest" | "record" | "corrections" | "status";
  buffer?: string;
  sessionId: string;
  requestId: string;  // for matching responses
}

// Response (daemon → shell)
interface IPCResponse {
  requestId: string;
  ok: boolean;
  data?: DaemonResponse;
  error?: string;
}
```

#### Lock File (`~/.terminal-autocorrect/daemon.pid`)

Plain text file containing the daemon's PID as a decimal integer followed by a newline.

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Autocorrect fires if and only if within edit distance threshold

*For any* input token and any configured `maxEditDistance` value, the autocorrect engine SHALL correct the token if and only if the closest known command has an edit distance ≤ `maxEditDistance` and there is exactly one closest match. When the distance exceeds the threshold, the original token SHALL be returned unchanged.

**Validates: Requirements 3.1, 3.2, 3.5**

### Property 2: Autocorrect is unambiguous — ties produce no correction

*For any* input token where two or more known commands share the same minimum edit distance, the autocorrect engine SHALL return an "ambiguous" result and SHALL NOT replace the token with any candidate.

**Validates: Requirements 3.6**

### Property 3: Corrected command preserves all non-corrected tokens

*For any* input command string where only one token is mistyped (first token or a subcommand token), the autocorrect engine SHALL replace only that token and preserve all remaining tokens (arguments, flags, other subcommands) in their original order and form.

**Validates: Requirements 3.2, 3.3, 3.4**

### Property 4: Suggestion ghost text is always a valid completion of the buffer

*For any* non-empty input buffer for which the suggestion engine returns a non-empty ghost text, the concatenation of `buffer + ghost` SHALL be a string that starts with `buffer` (i.e., `(buffer + ghost).startsWith(buffer)` is always true), and the full suggestion SHALL exist in the known commands corpus or command history.

**Validates: Requirements 4.2, 4.5**

### Property 5: Suggestion ranking respects history frequency

*For any* input buffer that matches multiple known command prefixes, the ghost text returned by the suggestion engine SHALL correspond to the completion with the highest frequency count in Command_History among all matching completions.

**Validates: Requirements 4.7**

### Property 6: History persistence round-trip

*For any* sequence of commands recorded by the memory engine, serializing the history to JSON and deserializing it SHALL produce a history object that is structurally equivalent to the original — same number of entries, same command strings, same timestamps, same patterns, and same pattern counts.

**Validates: Requirements 5.8, 6.1, 6.2, 6.3**

### Property 7: History cap enforcement

*For any* history that has reached the configured `maxHistoryEntries` limit, recording one additional command SHALL result in a history whose entry count equals exactly `maxHistoryEntries`, with the oldest entry removed and the new entry appended.

**Validates: Requirements 6.7**

### Property 8: Config round-trip

*For any* valid configuration object containing any combination of valid key-value pairs, writing it to disk and reading it back SHALL produce a configuration object that is deeply equal to the original, with no values lost or type-coerced.

**Validates: Requirements 7.1, 7.2, 7.7**

### Property 9: Config rejects invalid keys without side effects

*For any* string that is not a member of the valid configuration key set, calling `config set` with that key SHALL return an error response and SHALL NOT modify the stored configuration file in any way.

**Validates: Requirements 7.4, 7.5**

### Property 10: Memory pattern threshold

*For any* pair of consecutive commands (A, B), the memory engine SHALL generate a prediction of B after observing A if and only if the pattern (A → B) has been recorded at least 2 times in history. Patterns observed fewer than 2 times SHALL NOT produce predictions.

**Validates: Requirements 5.2**

### Property 11: Branch variable substitution in patterns

*For any* branch name used in a `git checkout <branch>` command, when the memory engine records this command and a subsequent `git pull origin <branch>` pattern exists in history, the prediction SHALL substitute the actual branch name from the most recent checkout — not a hardcoded branch name.

**Validates: Requirements 5.7**

### Property 12: Provider interface conformance

*For any* input buffer and command history, both the built-in rule-based suggestion provider and any external provider SHALL return a `SuggestionResult` with a `confidence` value in the range [0.0, 1.0] and a `source` field set to one of the valid enum values. The built-in predictor SHALL similarly return `PredictionResult` entries with confidence in [0.0, 1.0].

**Validates: Requirements 8.1, 8.2, 8.5**

---

## Error Handling

### Daemon Not Running

When the shell hook attempts an IPC call and the daemon is not running (socket file absent or connection refused), the hook SHALL silently pass the original command to the shell unchanged. The user experience degrades gracefully — the tool simply does nothing rather than blocking the shell.

### Corrupt History File

When the history file cannot be parsed as valid JSON, the daemon SHALL:
1. Rename the corrupt file to `history.json.bak` (overwriting any previous backup)
2. Create a new empty history file
3. Log a warning to stderr: `[terminal-autocorrect] WARNING: history file was corrupt, reset to empty`
4. Continue startup normally

### Corrupt Config File

When the config file cannot be parsed, the daemon SHALL apply all defaults and attempt to overwrite the corrupt file with the defaults. A warning is logged to stderr.

### IPC Timeout

Shell hook IPC calls have a 100ms timeout. If the daemon does not respond within 100ms, the hook proceeds with the original input. This prevents the daemon from ever blocking the user's shell.

### Ambiguous Autocorrect

When two or more known commands share the minimum edit distance, the engine returns the list of candidates. The shell hook displays them to the user but does NOT execute any command automatically.

### Edit Distance Exceeds Threshold

When no known command is within `maxEditDistance`, the original input is passed to the shell unchanged. No message is displayed (silent pass-through).

### Signal Handling

The daemon registers handlers for `SIGTERM` and `SIGINT` that:
1. Remove the PID lock file
2. Remove the Unix socket file
3. Flush any pending history writes to disk
4. Exit with code 0

---

## Testing Strategy

### Dual Testing Approach

The testing strategy combines unit/example-based tests for specific behaviors with property-based tests for universal correctness guarantees.

**Unit tests** cover:
- Specific autocorrect examples (e.g., `git meg e` → `git merge`)
- CLI command parsing and output formatting
- Config validation error messages
- Shell hook snippet generation
- IPC message serialization/deserialization
- Edge cases: empty input, single-character commands, very long inputs

**Property-based tests** cover the 10 correctness properties defined above, using `fast-check` with a minimum of 100 iterations per property.

### Property-Based Testing Setup

**Library**: [`fast-check`](https://github.com/dubzzz/fast-check) — the standard PBT library for TypeScript/JavaScript.

**Configuration**: Each property test runs a minimum of 100 iterations (`numRuns: 100`).

**Tag format**: Each property test is tagged with a comment:
```
// Feature: terminal-autocorrect, Property N: <property_text>
```

**Example property test structure:**

```typescript
import fc from "fast-check";
import { distance } from "fastest-levenshtein";

// Feature: terminal-autocorrect, Property 1: Autocorrect only fires within edit distance threshold
test("autocorrect only fires within edit distance threshold", () => {
  fc.assert(
    fc.property(
      fc.string({ minLength: 1, maxLength: 20 }),
      fc.integer({ min: 1, max: 5 }),
      (token, maxDist) => {
        const result = autocorrectEngine.correct(token, { maxEditDistance: maxDist });
        if (result.status === "corrected") {
          expect(distance(token, result.corrected!.split(" ")[0])).toBeLessThanOrEqual(maxDist);
        }
      }
    ),
    { numRuns: 100 }
  );
});
```

### Test Organization

```
src/
  __tests__/
    unit/
      autocorrect.test.ts      # unit tests for AutocorrectEngine
      suggestion.test.ts       # unit tests for SuggestionEngine
      memory.test.ts           # unit tests for MemoryEngine
      config.test.ts           # unit tests for ConfigManager
      corpus.test.ts           # unit tests for KnownCommandsCorpus
      cli.test.ts              # unit tests for CLI commands
    property/
      autocorrect.property.ts  # PBT for Properties 1, 2, 3
      suggestion.property.ts   # PBT for Property 4
      history.property.ts      # PBT for Properties 5, 6
      config.property.ts       # PBT for Properties 7, 8
      memory.property.ts       # PBT for Properties 9, 10
    integration/
      daemon.integration.ts    # daemon lifecycle, IPC round-trip
      shell-hook.integration.ts # shell hook snippet correctness
```

### Test Runner

**Vitest** — fast, TypeScript-native, compatible with the Node.js ecosystem. Run with `vitest --run` for single-pass CI execution.

### Coverage Targets

- Unit + property tests: ≥ 80% line coverage on engine modules
- Integration tests: daemon start/stop/status lifecycle, IPC request/response round-trip
