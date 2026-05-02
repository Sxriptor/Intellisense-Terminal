# terminal-autocorrect

A lightweight terminal daemon that provides autocorrect, inline ghost-text suggestions, and memory-based next-command prediction — all without a GUI or Electron runtime.

## Features

- **Autocorrect** — detects and fixes mistyped commands before they execute (e.g. `git comit` → `git commit`)
- **Ghost-text suggestions** — inline completions as you type, accepted with Tab
- **Memory predictions** — learns your command sequences and predicts the next command

## Requirements

- Node.js 18 or later
- bash, zsh, or PowerShell 5.1+ / pwsh

## Installation

```sh
npm install -g terminal-autocorrect
```

## Quick Start

### 1. Install

```sh
npm install -g terminal-autocorrect
```

### 2. Start the daemon

```sh
tac start
```

### 3. Add the shell hook

**For PowerShell (Windows):**

```powershell
# Copy the hook to a permanent location
tac init powershell > "$env:USERPROFILE\Documents\WindowsPowerShell\tac-hook.ps1"

# Add this line to your PowerShell profile ($PROFILE)
echo '. "$env:USERPROFILE\Documents\WindowsPowerShell\tac-hook.ps1"' >> $PROFILE

# Reload your profile
. $PROFILE
```

**For zsh (macOS/Linux):**

```zsh
# Add to ~/.zshrc
echo 'eval "$(tac init zsh)"' >> ~/.zshrc

# Reload
source ~/.zshrc
```

**For bash (Linux):**

```bash
# Add to ~/.bashrc
echo 'eval "$(tac init bash)"' >> ~/.bashrc

# Reload  
source ~/.bashrc
```

### 4. Test it

Try typing a command with a typo:

```sh
git statsu    # Press Enter → autocorrects to "git status"
npm isntall   # Press Enter → autocorrects to "npm install"
docker ps -a  # Works with any command
```

### 5. Monitor with Terminal UI

```sh
tac tui        # or tac -t
```

This opens a real-time dashboard showing:
- Daemon status and PID
- Recent autocorrections with timestamps  
- Top corrected commands
- Current configuration
- Live statistics

Press `r` to refresh, `q` to quit.

## Windows Notes

The tool is fully supported on Windows with the following platform-specific behaviour:

- **IPC**: Uses Windows named pipes (`\\.\pipe\terminal-autocorrect`) instead of Unix domain sockets.
- **Shell hook**: Use `tac init powershell` for Windows Terminal / PowerShell. The hook integrates with PSReadLine for Tab completion and `PreCommandLookupAction` for autocorrect.
- **Stop command**: Uses `taskkill /F` to terminate the daemon instead of SIGTERM.
- **PATH scanning**: Detects executables by extension (`.exe`, `.cmd`, `.bat`, `.ps1`, `.com`) and strips the extension so `git.exe` is registered as `git`.
- **bash/zsh hooks**: Still work inside Git Bash or WSL on Windows.

## Commands

| Command | Description |
|---|---|
| `tac start` | Launch the daemon as a background process |
| `tac stop` | Stop the running daemon |
| `tac status` | Check whether the daemon is running |
| `tac tui` or `tac -t` | Open terminal user interface dashboard |
| `tac init <shell>` | Output the shell hook snippet for `bash`, `zsh`, or `powershell` |
| `tac corrections` | List all autocorrections applied in the current session |
| `tac config set <key> <value>` | Set a configuration value |
| `tac config get <key>` | Get a configuration value |
| `tac config list` | List all configuration keys and their current values |
| `tac history clear` | Delete all stored command history and patterns |

The `terminal-autocorrect` binary is an alias for `tac` and accepts the same commands.

## Configuration Reference

Configuration is stored at `~/.terminal-autocorrect/config.json`. Use `tac config set` to update values.

| Key | Type | Default | Description |
|---|---|---|---|
| `maxEditDistance` | integer | `2` | Maximum edit distance for autocorrect to fire. Higher values correct more aggressively. |
| `maxHistoryEntries` | integer | `10000` | Maximum number of history entries to retain. Oldest entries are removed when the cap is exceeded. |
| `historyPath` | string | `~/.terminal-autocorrect/history.json` | Path to the command history file. |
| `suggestionColor` | string | `dim` | ANSI color name used to render ghost-text suggestions. |
| `enabled` | boolean | `true` | Master switch. When `false`, all autocorrect and suggestion features are disabled. |
| `autocorrectEnabled` | boolean | `true` | Enable or disable the autocorrect engine independently. |
| `suggestionsEnabled` | boolean | `true` | Enable or disable inline ghost-text suggestions independently. |
| `memoryEnabled` | boolean | `true` | Enable or disable memory-based next-command prediction independently. |

### Examples

```sh
# Increase autocorrect aggressiveness
tac config set maxEditDistance 3

# Disable autocorrect but keep suggestions
tac config set autocorrectEnabled false

# Change the history file location
tac config set historyPath /tmp/tac-history.json

# View all current settings
tac config list
```

## Data Files

All data is stored in `~/.terminal-autocorrect/`:

| File | Description |
|---|---|
| `config.json` | User configuration |
| `history.json` | Command history and learned patterns |
| `daemon.pid` | Daemon process ID (lock file) |
| `daemon.sock` | Unix domain socket for IPC |

## Uninstalling

```sh
tac stop
npm uninstall -g terminal-autocorrect
rm -rf ~/.terminal-autocorrect
```

## License

MIT
