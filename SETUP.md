# terminalsense - Setup Guide

## Quick Setup (5 minutes)

### 1. Install
```bash
npm install -g terminalsense
```

### 2. Set up your shell
```bash
tac setup
```

This writes the hook file under `~/.terminal-autocorrect/`, updates the relevant shell profile, and starts the daemon. Restart your shell or open a new terminal tab/window after running it.

### 3. Test it!
Try typing commands with typos:
```bash
git statsu     # → git status
npm isntall    # → npm install  
docker ps -a   # → works with any command
```

### 4. Verify
```bash
tac status        # Should show "running"
tac corrections   # Shows recent autocorrections
```

## Commands

| Command | Description |
|---------|-------------|
| `tac start` | Start the daemon |
| `tac stop` | Stop the daemon |
| `tac status` | Check if running |
| `tac corrections` | Show recent corrections |
| `tac config list` | Show all settings |

## Troubleshooting

**PowerShell loads slowly?**
- The hook is optimized for speed, but if you have other slow profile scripts, consider moving them to load asynchronously

**Autocorrect not working?**
- Check `tac status` - daemon must be running
- Try `tac --ipc correct --buffer "git statsu"` to test directly
- Restart your shell after setup

**Want to uninstall?**
```bash
tac stop
npm uninstall -g terminalsense
# Remove the line from your shell profile
```

## How it works

1. **Daemon**: Runs in background, learns from your commands
2. **Shell hook**: Intercepts commands before execution  
3. **Autocorrect**: Fixes typos using edit distance + learned patterns
4. **Fast**: Uses IPC for sub-100ms response times

The tool learns your command patterns and gets better over time!


