# Requirements Document

## Introduction

Terminal Autocorrect is a lightweight background process (daemon) that monitors terminal keystrokes in real time. It provides three layers of intelligence: autocorrect for mistyped commands, inline ghost-text suggestions as the user types, and memory-based next-command predictions derived from the user's own command history. The tool is distributed as an npm package with a CLI interface for configuration and control. No GUI or Electron runtime is required.

## Glossary

- **Daemon**: The background process that intercepts and monitors terminal input.
- **Autocorrect_Engine**: The component responsible for detecting and correcting mistyped commands before execution.
- **Suggestion_Engine**: The component responsible for generating and displaying inline ghost-text completions as the user types.
- **Memory_Engine**: The component responsible for recording command sequences and predicting the next likely command based on historical patterns.
- **Command_History**: The persistent log of commands executed by the user, stored on disk.
- **Pattern**: A recorded sequence of two or more consecutive commands used by the Memory_Engine to generate predictions.
- **Ghost_Text**: Inline, visually distinct text appended to the current input line showing a suggestion that has not yet been accepted.
- **Fuzzy_Matcher**: The sub-component of the Autocorrect_Engine that computes edit-distance similarity between typed tokens and known command tokens.
- **CLI**: The command-line interface used to configure, start, stop, and inspect the Daemon.
- **Known_Commands**: The set of valid shell commands and subcommands available on the user's system, used as the correction and suggestion corpus.

---

## Requirements

### Requirement 1: Daemon Lifecycle Management

**User Story:** As a developer, I want to start and stop the autocorrect daemon from the terminal, so that I can enable or disable the tool without modifying my shell configuration manually.

#### Acceptance Criteria

1. THE CLI SHALL provide a `start` command that launches the Daemon as a background process.
2. THE CLI SHALL provide a `stop` command that terminates the running Daemon.
3. THE CLI SHALL provide a `status` command that reports whether the Daemon is currently running.
4. WHEN the `start` command is issued and a Daemon instance is already running, THE CLI SHALL display a message indicating the Daemon is already active and exit without launching a second instance.
5. WHEN the Daemon starts, THE Daemon SHALL write its process ID to a lock file in a configurable directory (defaulting to `~/.terminal-autocorrect/`).
6. WHEN the `stop` command is issued and no Daemon is running, THE CLI SHALL display a message indicating no active Daemon was found and exit with a non-zero status code.
7. IF the Daemon process exits unexpectedly, THEN THE Daemon SHALL remove the lock file on exit via a registered signal handler for SIGTERM and SIGINT.

---

### Requirement 2: Keystroke Monitoring

**User Story:** As a developer, I want the daemon to observe my keystrokes in the terminal, so that it can act on my input before I press Enter.

#### Acceptance Criteria

1. WHILE the Daemon is running, THE Daemon SHALL intercept raw keystroke input from the active terminal session without requiring a custom shell replacement.
2. WHILE the Daemon is running, THE Daemon SHALL buffer the current line of input as the user types, updating the buffer on each keystroke.
3. WHEN the user presses Enter, THE Daemon SHALL treat the buffered line as a candidate for autocorrect processing before the shell executes it.
4. WHEN the user presses Backspace or Delete, THE Daemon SHALL update the input buffer to reflect the deletion.
5. THE Daemon SHALL support integration via shell hooks (e.g., `zsh` precmd/preexec, `bash` PROMPT_COMMAND) as the primary keystroke interception mechanism.
6. THE CLI SHALL provide an `init` command that outputs the shell hook snippet required to integrate the Daemon with the user's shell, supporting `bash` and `zsh`.

---

### Requirement 3: Autocorrect for Mistyped Commands

**User Story:** As a developer, I want the tool to automatically correct mistyped commands before they execute, so that I don't have to retype commands with small typos.

#### Acceptance Criteria

1. WHEN the user presses Enter and the first token of the buffered input does not match any entry in Known_Commands, THE Autocorrect_Engine SHALL compute the edit distance between the typed token and each entry in Known_Commands.
2. WHEN a single Known_Commands entry has an edit distance of 2 or fewer characters from the mistyped token and no other entry has an equal or lower edit distance, THE Autocorrect_Engine SHALL replace the mistyped token with the matched entry and execute the corrected command.
3. WHEN the Autocorrect_Engine replaces a token, THE Daemon SHALL display the corrected command to the user before execution using a visually distinct prefix (e.g., `✓ autocorrected:`).
4. WHEN the first token of the input is a known command but a subsequent subcommand token does not match any known subcommand for that command, THE Autocorrect_Engine SHALL apply fuzzy matching to the subcommand token against the known subcommands for that command.
5. WHEN the edit distance between the mistyped token and the closest Known_Commands entry exceeds 2, THE Autocorrect_Engine SHALL not autocorrect and SHALL pass the original input to the shell unchanged.
6. WHEN two or more Known_Commands entries share the same minimum edit distance from the mistyped token, THE Autocorrect_Engine SHALL not autocorrect and SHALL display the ambiguous candidates to the user.
7. THE Autocorrect_Engine SHALL include built-in correction rules for common `git` subcommand typos (e.g., `meg e` → `merge`, `chekout` → `checkout`, `comit` → `commit`).
8. THE CLI SHALL provide a `corrections` subcommand that lists all autocorrections applied in the current session.

---

### Requirement 4: Inline Ghost-Text Suggestions

**User Story:** As a developer, I want to see inline suggestions as I type, so that I can quickly complete commands without memorizing every flag or subcommand.

#### Acceptance Criteria

1. WHILE the Daemon is running and the user is typing, THE Suggestion_Engine SHALL evaluate the current input buffer after each keystroke.
2. WHEN the current input buffer matches the prefix of one or more known commands or subcommands, THE Suggestion_Engine SHALL display the highest-confidence completion as Ghost_Text appended to the current cursor position.
3. WHEN Ghost_Text is displayed and the user presses Tab, THE Suggestion_Engine SHALL replace the current input buffer with the full suggested command.
4. WHEN Ghost_Text is displayed and the user continues typing any character other than Tab, THE Suggestion_Engine SHALL update or dismiss the Ghost_Text based on the new buffer content.
5. WHEN the current input buffer does not match any known command prefix, THE Suggestion_Engine SHALL display no Ghost_Text.
6. THE Suggestion_Engine SHALL render Ghost_Text in a visually distinct style (e.g., dimmed or grey ANSI color) that differs from the user's active input text.
7. WHEN multiple completions match the current buffer prefix, THE Suggestion_Engine SHALL rank candidates by frequency of use from Command_History, displaying the most frequently used completion as Ghost_Text.
8. WHEN the user presses Escape, THE Suggestion_Engine SHALL dismiss the current Ghost_Text without modifying the input buffer.

---

### Requirement 5: Memory-Based Next-Command Prediction

**User Story:** As a developer, I want the tool to suggest the next command based on what I usually do after a given command, so that I can move through repetitive workflows faster.

#### Acceptance Criteria

1. WHEN the user executes a command, THE Memory_Engine SHALL record the command and its position in the current session's command sequence to Command_History.
2. WHEN the user executes a command and the two most recent commands form a Pattern that appears in Command_History at least 2 times, THE Memory_Engine SHALL generate a next-command prediction.
3. WHEN a next-command prediction is available and the input buffer is empty, THE Suggestion_Engine SHALL display the predicted command as Ghost_Text.
4. WHEN the user presses Tab and Ghost_Text from a next-command prediction is displayed, THE Suggestion_Engine SHALL populate the input buffer with the predicted command.
5. WHEN the user begins typing and the typed prefix does not match the predicted command, THE Suggestion_Engine SHALL dismiss the prediction Ghost_Text and switch to prefix-based inline suggestions.
6. THE Memory_Engine SHALL store Patterns as ordered pairs of the form `(command_A, command_B)` where `command_B` is the command that followed `command_A`.
7. WHEN a `git checkout <branch>` command is executed, THE Memory_Engine SHALL record the branch name as a variable component of the Pattern, so that a subsequent `git pull origin <branch>` prediction uses the same branch name.
8. THE Memory_Engine SHALL persist Command_History and Patterns to disk in a file located at `~/.terminal-autocorrect/history.json` (path configurable via CLI settings).

---

### Requirement 6: Persistent Storage and Command History

**User Story:** As a developer, I want my command history and learned patterns to persist across sessions, so that the tool improves over time without losing context.

#### Acceptance Criteria

1. THE Memory_Engine SHALL load Command_History and Patterns from disk on Daemon startup.
2. WHEN a new command is executed, THE Memory_Engine SHALL append the command to the in-memory Command_History and write the updated history to disk within 500ms.
3. THE Memory_Engine SHALL store Command_History in a structured JSON format that includes the command string, a UTC timestamp, and the session identifier.
4. WHEN the history file does not exist on startup, THE Memory_Engine SHALL create an empty history file and proceed without error.
5. IF the history file is corrupt or unparseable, THEN THE Memory_Engine SHALL rename the corrupt file with a `.bak` suffix, create a new empty history file, and log a warning to stderr.
6. THE CLI SHALL provide a `history clear` command that deletes all stored Command_History and Patterns after prompting the user for confirmation.
7. THE Memory_Engine SHALL cap Command_History at a configurable maximum number of entries (default: 10,000), removing the oldest entries when the cap is exceeded.

---

### Requirement 7: CLI Settings Interface

**User Story:** As a developer, I want a CLI interface to configure the tool's behavior, so that I can tune autocorrect aggressiveness, suggestion display, and history limits to my preferences.

#### Acceptance Criteria

1. THE CLI SHALL provide a `config set <key> <value>` command that updates a named configuration value and persists it to `~/.terminal-autocorrect/config.json`.
2. THE CLI SHALL provide a `config get <key>` command that reads and displays a named configuration value.
3. THE CLI SHALL provide a `config list` command that displays all current configuration keys and their values.
4. WHEN an unrecognized key is passed to `config set`, THE CLI SHALL display an error listing the valid configuration keys and exit with a non-zero status code.
5. WHEN an invalid value type is passed to `config set`, THE CLI SHALL display a descriptive error message and exit with a non-zero status code.
6. THE CLI SHALL support the following configurable keys: `maxEditDistance` (integer, default 2), `maxHistoryEntries` (integer, default 10000), `historyPath` (string), `suggestionColor` (string, ANSI color name), `enabled` (boolean), `autocorrectEnabled` (boolean), `suggestionsEnabled` (boolean), `memoryEnabled` (boolean).
7. WHEN the Daemon starts, THE Daemon SHALL load configuration from `~/.terminal-autocorrect/config.json` and apply all settings before beginning keystroke monitoring.
8. IF the configuration file is missing, THEN THE Daemon SHALL apply all default values and create the configuration file with those defaults.

---

### Requirement 8: Extensibility for AI/ML Enhancement

**User Story:** As a developer, I want the suggestion and memory engines to be designed with a pluggable architecture, so that rule-based logic can be replaced or augmented with an AI/ML model in the future without rewriting the tool.

#### Acceptance Criteria

1. THE Suggestion_Engine SHALL expose a provider interface that accepts the current input buffer and Command_History and returns an ordered list of candidate completions with confidence scores.
2. THE Memory_Engine SHALL expose a predictor interface that accepts the recent command sequence and returns an ordered list of next-command predictions with confidence scores.
3. THE Daemon SHALL select the active suggestion provider and memory predictor via configuration, defaulting to the built-in rule-based implementations.
4. WHERE an external AI provider is configured, THE Daemon SHALL load the provider module by the path specified in the configuration and delegate suggestion and prediction calls to it.
5. THE built-in rule-based provider SHALL implement the same provider interface as any external AI provider, ensuring behavioral consistency and testability.
