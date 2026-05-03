/**
 * Corrections Dictionary System
 * 
 * Loads and manages preloaded corrections from JSON files.
 * Supports both built-in corrections and user-provided corrections.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CorrectionEntry {
  /** The incorrect command/subcommand */
  incorrect: string;
  /** The correct command/subcommand */
  correct: string;
  /** Optional: specific command this applies to (e.g., "git", "npm") */
  command?: string;
  /** Optional: confidence score (0-1, higher = more confident) */
  confidence?: number;
  /** Optional: category for organization */
  category?: string;
}

export interface CorrectionsDictionary {
  /** Version of the corrections format */
  version: string;
  /** Description of this corrections set */
  description?: string;
  /** Array of correction entries */
  corrections: CorrectionEntry[];
}

// ---------------------------------------------------------------------------
// Built-in corrections (expanded from existing git corrections)
// ---------------------------------------------------------------------------

const BUILTIN_CORRECTIONS: CorrectionEntry[] = [
  // Git corrections (expanded)
  { incorrect: "comit", correct: "commit", command: "git", category: "git-basic" },
  { incorrect: "comitt", correct: "commit", command: "git", category: "git-basic" },
  { incorrect: "commti", correct: "commit", command: "git", category: "git-basic" },
  { incorrect: "comiit", correct: "commit", command: "git", category: "git-basic" },
  { incorrect: "statsu", correct: "status", command: "git", category: "git-basic" },
  { incorrect: "stauts", correct: "status", command: "git", category: "git-basic" },
  { incorrect: "staus", correct: "status", command: "git", category: "git-basic" },
  { incorrect: "sttaus", correct: "status", command: "git", category: "git-basic" },
  { incorrect: "stsatu", correct: "status", command: "git", category: "git-basic" },
  { incorrect: "psuh", correct: "push", command: "git", category: "git-basic" },
  { incorrect: "pus", correct: "push", command: "git", category: "git-basic" },
  { incorrect: "pul", correct: "pull", command: "git", category: "git-basic" },
  { incorrect: "plul", correct: "pull", command: "git", category: "git-basic" },
  { incorrect: "barnch", correct: "branch", command: "git", category: "git-basic" },
  { incorrect: "branh", correct: "branch", command: "git", category: "git-basic" },
  { incorrect: "brach", correct: "branch", command: "git", category: "git-basic" },
  { incorrect: "ranch", correct: "branch", command: "git", category: "git-basic" },
  { incorrect: "tranch", correct: "branch", command: "git", category: "git-basic" },
  { incorrect: "chekout", correct: "checkout", command: "git", category: "git-basic" },
  { incorrect: "chekcout", correct: "checkout", command: "git", category: "git-basic" },
  { incorrect: "chekotu", correct: "checkout", command: "git", category: "git-basic" },
  { incorrect: "ckeckout", correct: "checkout", command: "git", category: "git-basic" },
  { incorrect: "aad", correct: "add", command: "git", category: "git-basic" },
  { incorrect: "ad", correct: "add", command: "git", category: "git-basic" },
  { incorrect: "clon", correct: "clone", command: "git", category: "git-basic" },
  { incorrect: "cloen", correct: "clone", command: "git", category: "git-basic" },
  { incorrect: "ftch", correct: "fetch", command: "git", category: "git-basic" },
  { incorrect: "fecth", correct: "fetch", command: "git", category: "git-basic" },
  { incorrect: "reabse", correct: "rebase", command: "git", category: "git-basic" },
  { incorrect: "rebas", correct: "rebase", command: "git", category: "git-basic" },
  { incorrect: "stsh", correct: "stash", command: "git", category: "git-basic" },
  { incorrect: "stas", correct: "stash", command: "git", category: "git-basic" },
  { incorrect: "dif", correct: "diff", command: "git", category: "git-basic" },
  { incorrect: "dff", correct: "diff", command: "git", category: "git-basic" },
  { incorrect: "lgo", correct: "log", command: "git", category: "git-basic" },
  { incorrect: "remtoe", correct: "remote", command: "git", category: "git-basic" },
  { incorrect: "reomte", correct: "remote", command: "git", category: "git-basic" },
  
  // NPM corrections
  { incorrect: "isntall", correct: "install", command: "npm", category: "npm-basic" },
  { incorrect: "intall", correct: "install", command: "npm", category: "npm-basic" },
  { incorrect: "instal", correct: "install", command: "npm", category: "npm-basic" },
  { incorrect: "instll", correct: "install", command: "npm", category: "npm-basic" },
  { incorrect: "statr", correct: "start", command: "npm", category: "npm-basic" },
  { incorrect: "strat", correct: "start", command: "npm", category: "npm-basic" },
  { incorrect: "sart", correct: "start", command: "npm", category: "npm-basic" },
  { incorrect: "tset", correct: "test", command: "npm", category: "npm-basic" },
  { incorrect: "tes", correct: "test", command: "npm", category: "npm-basic" },
  { incorrect: "buidl", correct: "build", command: "npm", category: "npm-basic" },
  { incorrect: "buil", correct: "build", command: "npm", category: "npm-basic" },
  { incorrect: "biuld", correct: "build", command: "npm", category: "npm-basic" },
  { incorrect: "updat", correct: "update", command: "npm", category: "npm-basic" },
  { incorrect: "udpate", correct: "update", command: "npm", category: "npm-basic" },
  { incorrect: "unisntall", correct: "uninstall", command: "npm", category: "npm-basic" },
  { incorrect: "unintsall", correct: "uninstall", command: "npm", category: "npm-basic" },
  
  // Docker corrections
  { incorrect: "rnu", correct: "run", command: "docker", category: "docker-basic" },
  { incorrect: "biuld", correct: "build", command: "docker", category: "docker-basic" },
  { incorrect: "buidl", correct: "build", command: "docker", category: "docker-basic" },
  { incorrect: "pul", correct: "pull", command: "docker", category: "docker-basic" },
  { incorrect: "psuh", correct: "push", command: "docker", category: "docker-basic" },
  { incorrect: "iamges", correct: "images", command: "docker", category: "docker-basic" },
  { incorrect: "imags", correct: "images", command: "docker", category: "docker-basic" },
  { incorrect: "contaienrs", correct: "containers", command: "docker", category: "docker-basic" },
  { incorrect: "containres", correct: "containers", command: "docker", category: "docker-basic" },
  
  // Common command corrections (top-level commands)
  { incorrect: "cd..", correct: "cd ..", category: "shell-basic" },
  { incorrect: "cd.", correct: "cd .", category: "shell-basic" },
  { incorrect: "sl", correct: "ls", category: "shell-basic" },
  { incorrect: "lss", correct: "ls", category: "shell-basic" },
  { incorrect: "cta", correct: "cat", category: "shell-basic" },
  { incorrect: "tac", correct: "cat", category: "shell-basic" }, // Note: conflicts with our tool name
  { incorrect: "ehco", correct: "echo", category: "shell-basic" },
  { incorrect: "ecoh", correct: "echo", category: "shell-basic" },
  { incorrect: "grpe", correct: "grep", category: "shell-basic" },
  { incorrect: "gerp", correct: "grep", category: "shell-basic" },
  { incorrect: "mkdri", correct: "mkdir", category: "shell-basic" },
  { incorrect: "mkidr", correct: "mkdir", category: "shell-basic" },
  { incorrect: "rmdir", correct: "rm -rf", category: "shell-basic" },
  { incorrect: "chmdo", correct: "chmod", category: "shell-basic" },
  { incorrect: "chmo", correct: "chmod", category: "shell-basic" },
  { incorrect: "sudp", correct: "sudo", category: "shell-basic" },
  { incorrect: "suod", correct: "sudo", category: "shell-basic" },
];

// ---------------------------------------------------------------------------
// CorrectionsDictionaryManager
// ---------------------------------------------------------------------------

export class CorrectionsDictionaryManager {
  private corrections = new Map<string, Map<string, string>>();
  private globalCorrections = new Map<string, string>();
  
  constructor() {
    this.loadBuiltinCorrections();
  }
  
  /**
   * Load built-in corrections into the manager
   */
  private loadBuiltinCorrections(): void {
    for (const entry of BUILTIN_CORRECTIONS) {
      if (entry.command) {
        // Command-specific correction
        if (!this.corrections.has(entry.command)) {
          this.corrections.set(entry.command, new Map());
        }
        this.corrections.get(entry.command)!.set(entry.incorrect, entry.correct);
      } else {
        // Global correction
        this.globalCorrections.set(entry.incorrect, entry.correct);
      }
    }
  }
  
  /**
   * Load corrections from a JSON file
   */
  async loadFromFile(filePath: string): Promise<void> {
    try {
      const content = await readFile(filePath, 'utf-8');
      const dictionary: CorrectionsDictionary = JSON.parse(content);
      
      for (const entry of dictionary.corrections) {
        if (entry.command) {
          // Command-specific correction
          if (!this.corrections.has(entry.command)) {
            this.corrections.set(entry.command, new Map());
          }
          this.corrections.get(entry.command)!.set(entry.incorrect, entry.correct);
        } else {
          // Global correction
          this.globalCorrections.set(entry.incorrect, entry.correct);
        }
      }
    } catch (error) {
      // Silently ignore file loading errors - corrections are optional
      console.warn(`Could not load corrections from ${filePath}:`, error);
    }
  }
  
  /**
   * Load corrections from multiple sources
   */
  async loadFromSources(sources: string[]): Promise<void> {
    await Promise.all(sources.map(source => this.loadFromFile(source)));
  }
  
  /**
   * Get correction for a command/subcommand combination
   */
  getCorrection(command: string, subcommand: string): string | undefined {
    // Check command-specific corrections first
    const commandCorrections = this.corrections.get(command);
    if (commandCorrections?.has(subcommand)) {
      return commandCorrections.get(subcommand);
    }
    
    // Fall back to global corrections
    return this.globalCorrections.get(subcommand);
  }
  
  /**
   * Get correction for a top-level command
   */
  getCommandCorrection(command: string): string | undefined {
    return this.globalCorrections.get(command);
  }
  
  /**
   * Get all corrections for a specific command
   */
  getCommandCorrections(command: string): Map<string, string> {
    return this.corrections.get(command) || new Map();
  }
  
  /**
   * Get statistics about loaded corrections
   */
  getStats(): { totalCorrections: number; commandSpecific: number; global: number; commands: string[] } {
    let commandSpecific = 0;
    for (const corrections of this.corrections.values()) {
      commandSpecific += corrections.size;
    }
    
    return {
      totalCorrections: commandSpecific + this.globalCorrections.size,
      commandSpecific,
      global: this.globalCorrections.size,
      commands: Array.from(this.corrections.keys()),
    };
  }
  
  /**
   * Export corrections to the legacy format for backward compatibility
   */
  exportLegacyFormat(command: string): Record<string, string> {
    const corrections = this.corrections.get(command);
    if (!corrections) return {};
    
    const result: Record<string, string> = {};
    for (const [incorrect, correct] of corrections) {
      result[incorrect] = correct;
    }
    return result;
  }
}

// ---------------------------------------------------------------------------
// Default instance and helper functions
// ---------------------------------------------------------------------------

let defaultManager: CorrectionsDictionaryManager | null = null;

/**
 * Get the default corrections dictionary manager
 */
export function getDefaultCorrectionsDictionary(): CorrectionsDictionaryManager {
  if (!defaultManager) {
    defaultManager = new CorrectionsDictionaryManager();
  }
  return defaultManager;
}

/**
 * Initialize corrections dictionary with custom sources
 */
export async function initializeCorrectionsDictionary(sources: string[] = []): Promise<CorrectionsDictionaryManager> {
  const manager = new CorrectionsDictionaryManager();
  
  // Try to load from default locations
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const defaultSources = [
    join(__dirname, '..', 'corrections', 'common.json'),
  ];
  
  await manager.loadFromSources([...defaultSources, ...sources]);
  defaultManager = manager;
  
  return manager;
}
