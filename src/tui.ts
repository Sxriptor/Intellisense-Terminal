/**
 * Terminal User Interface for terminal-autocorrect
 * 
 * Provides a real-time dashboard showing:
 * - Daemon status
 * - Recent corrections
 * - Statistics
 * - Configuration
 */

import { createInterface } from "node:readline";
import { IPCClient } from "./ipc.js";
import type { IPCRequest, CorrectionRecord } from "./ipc.js";
import { SOCKET_PATH, PID_FILE_PATH } from "./paths.js";
import { readPidFile } from "./storage.js";
import { ConfigManager } from "./config.js";
import { randomUUID } from "node:crypto";

interface TUIState {
  corrections: CorrectionRecord[];
  daemonStatus: "running" | "stopped" | "unknown";
  daemonPid: number | null;
  config: Record<string, any>;
  stats: {
    totalCorrections: number;
    sessionsCorrections: number;
    topCommands: Array<{ command: string; count: number }>;
  };
}

/**
 * Check if daemon is running
 */
async function checkDaemonStatus(): Promise<{ status: "running" | "stopped" | "unknown"; pid: number | null }> {
  try {
    const pid = await readPidFile(PID_FILE_PATH);
    if (pid === null) {
      return { status: "stopped", pid: null };
    }
    
    // Check if process is alive
    try {
      process.kill(pid, 0);
      return { status: "running", pid };
    } catch {
      return { status: "stopped", pid: null };
    }
  } catch {
    return { status: "unknown", pid: null };
  }
}

/**
 * Get corrections from daemon
 */
async function getCorrections(): Promise<CorrectionRecord[]> {
  const client = new IPCClient();
  const request: IPCRequest = {
    type: "corrections",
    sessionId: randomUUID(),
    requestId: randomUUID(),
  };

  const response = await client.send(SOCKET_PATH, request, 2000);
  if (response?.ok && response.data?.corrections) {
    return response.data.corrections;
  }
  return [];
}

/**
 * Calculate statistics from corrections
 */
function calculateStats(corrections: CorrectionRecord[]) {
  const commandCounts = new Map<string, number>();
  
  corrections.forEach(correction => {
    const cmd = correction.corrected.split(' ')[0];
    commandCounts.set(cmd, (commandCounts.get(cmd) || 0) + 1);
  });

  const topCommands = Array.from(commandCounts.entries())
    .map(([command, count]) => ({ command, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return {
    totalCorrections: corrections.length,
    sessionsCorrections: corrections.length,
    topCommands,
  };
}

/**
 * Render the TUI screen
 */
function renderScreen(state: TUIState): string {
  const width = process.stdout.columns || 80;
  const separator = "─".repeat(width);
  
  let output = "";
  
  // Clear screen and move cursor to top
  output += "\x1b[2J\x1b[H";
  
  // Header
  output += `\x1b[1m\x1b[36m${"Terminal Autocorrect Dashboard".padEnd(width)}\x1b[0m\n`;
  output += `${separator}\n`;
  
  // Status section
  const statusColor = state.daemonStatus === "running" ? "\x1b[32m" : "\x1b[31m";
  const statusText = state.daemonStatus === "running" 
    ? `Running (PID ${state.daemonPid})` 
    : "Stopped";
  
  output += `\x1b[1mDaemon Status:\x1b[0m ${statusColor}${statusText}\x1b[0m\n`;
  output += `\x1b[1mTotal Corrections:\x1b[0m ${state.stats.totalCorrections}\n`;
  output += `\x1b[1mSession Corrections:\x1b[0m ${state.stats.sessionsCorrections}\n`;
  output += `${separator}\n`;
  
  // Recent corrections
  output += `\x1b[1mRecent Corrections (last 10):\x1b[0m\n`;
  if (state.corrections.length === 0) {
    output += `  \x1b[90mNo corrections yet\x1b[0m\n`;
  } else {
    const recent = state.corrections.slice(-10).reverse();
    recent.forEach(correction => {
      const time = new Date(correction.timestamp).toLocaleTimeString();
      const original = correction.original.length > 30 
        ? correction.original.substring(0, 27) + "..." 
        : correction.original;
      const corrected = correction.corrected.length > 30 
        ? correction.corrected.substring(0, 27) + "..." 
        : correction.corrected;
      
      output += `  \x1b[90m${time}\x1b[0m \x1b[31m${original}\x1b[0m → \x1b[32m${corrected}\x1b[0m\n`;
    });
  }
  output += `${separator}\n`;
  
  // Top commands
  output += `\x1b[1mTop Corrected Commands:\x1b[0m\n`;
  if (state.stats.topCommands.length === 0) {
    output += `  \x1b[90mNo data yet\x1b[0m\n`;
  } else {
    state.stats.topCommands.forEach(({ command, count }) => {
      output += `  \x1b[33m${command.padEnd(15)}\x1b[0m ${count} corrections\n`;
    });
  }
  output += `${separator}\n`;
  
  // Configuration
  output += `\x1b[1mConfiguration:\x1b[0m\n`;
  const configEntries = Object.entries(state.config).slice(0, 5);
  configEntries.forEach(([key, value]) => {
    const displayValue = typeof value === 'string' && value.length > 30 
      ? value.substring(0, 27) + "..." 
      : String(value);
    output += `  \x1b[36m${key.padEnd(20)}\x1b[0m ${displayValue}\n`;
  });
  output += `${separator}\n`;
  
  // Controls
  output += `\x1b[1mControls:\x1b[0m \x1b[33mr\x1b[0m=refresh \x1b[33mq\x1b[0m=quit \x1b[33mc\x1b[0m=clear corrections\n`;
  
  return output;
}

/**
 * Update TUI state
 */
async function updateState(): Promise<TUIState> {
  const [daemonInfo, corrections, configManager] = await Promise.all([
    checkDaemonStatus(),
    getCorrections(),
    (async () => {
      const cm = new ConfigManager();
      await cm.load();
      return cm;
    })(),
  ]);

  const stats = calculateStats(corrections);
  
  return {
    corrections,
    daemonStatus: daemonInfo.status,
    daemonPid: daemonInfo.pid,
    config: configManager.list(),
    stats,
  };
}

/**
 * Clear corrections history
 */
async function clearCorrections(): Promise<boolean> {
  // This would need to be implemented in the daemon
  // For now, just return false to indicate it's not implemented
  return false;
}

/**
 * Start the Terminal User Interface
 */
export async function startTUI(): Promise<void> {
  console.log("Starting Terminal Autocorrect Dashboard...");
  console.log("Loading...");
  
  // Setup readline for key input
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  
  // Set raw mode to capture individual keystrokes
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  
  let running = true;
  let state = await updateState();
  
  // Initial render
  process.stdout.write(renderScreen(state));
  
  // Auto-refresh every 5 seconds
  const refreshInterval = setInterval(async () => {
    if (running) {
      state = await updateState();
      process.stdout.write(renderScreen(state));
    }
  }, 5000);
  
  // Handle key input
  process.stdin.on('data', async (key) => {
    const keyStr = key.toString();
    
    switch (keyStr.toLowerCase()) {
      case 'q':
      case '\u0003': // Ctrl+C
        running = false;
        clearInterval(refreshInterval);
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(false);
        }
        rl.close();
        console.log('\n\nGoodbye!');
        process.exit(0);
        break;
        
      case 'r':
        // Refresh
        state = await updateState();
        process.stdout.write(renderScreen(state));
        break;
        
      case 'c':
        // Clear corrections (not implemented yet)
        process.stdout.write('\n\nClear corrections not implemented yet. Press any key to continue...');
        break;
        
      default:
        // Ignore other keys
        break;
    }
  });
  
  // Handle process termination
  process.on('SIGINT', () => {
    running = false;
    clearInterval(refreshInterval);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    console.log('\n\nGoodbye!');
    process.exit(0);
  });
}