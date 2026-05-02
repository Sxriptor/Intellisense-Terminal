/**
 * Learned Corrections System
 * 
 * Manages corrections learned from user behavior.
 * These have higher priority than built-in corrections.
 */

import { readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { TAC_HOME } from "./paths.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LearnedCorrectionEntry {
  /** The incorrect command/subcommand */
  incorrect: string;
  /** The correct command/subcommand */
  correct: string;
  /** How many times this correction was applied */
  frequency: number;
  /** Last time this was used */
  lastUsed: string;
  /** Optional: specific command this applies to */
  command?: string;
  /** Optional: confidence score (0-1) */
  confidence?: number;
}

export interface LearnedCorrectionsData {
  /** Version of the corrections format */
  version: string;
  /** Description */
  description?: string;
  /** Array of learned correction entries */
  corrections: LearnedCorrectionEntry[];
}

// ---------------------------------------------------------------------------
// LearnedCorrectionsManager
// ---------------------------------------------------------------------------

export class LearnedCorrectionsManager {
  private corrections = new Map<string, Map<string, LearnedCorrectionEntry>>();
  private globalCorrections = new Map<string, LearnedCorrectionEntry>();
  private correctionsFile: string;
  
  constructor(correctionsFile?: string) {
    this.correctionsFile = correctionsFile || join(TAC_HOME, 'learned-corrections.json');
  }
  
  /**
   * Load learned corrections from persistent storage
   */
  async loadLearnedCorrections(): Promise<void> {
    try {
      const content = await readFile(this.correctionsFile, 'utf-8');
      const data: LearnedCorrectionsData = JSON.parse(content);
      
      for (const entry of data.corrections) {
        if (entry.command) {
          // Command-specific correction
          if (!this.corrections.has(entry.command)) {
            this.corrections.set(entry.command, new Map());
          }
          this.corrections.get(entry.command)!.set(entry.incorrect, entry);
        } else {
          // Global correction
          this.globalCorrections.set(entry.incorrect, entry);
        }
      }
    } catch (error) {
      // File doesn't exist yet - that's fine
    }
  }
  
  /**
   * Save learned corrections to persistent storage
   */
  async saveLearnedCorrections(): Promise<void> {
    try {
      const allCorrections: LearnedCorrectionEntry[] = [];
      
      // Add global corrections
      for (const entry of this.globalCorrections.values()) {
        allCorrections.push(entry);
      }
      
      // Add command-specific corrections
      for (const [command, corrections] of this.corrections.entries()) {
        for (const entry of corrections.values()) {
          allCorrections.push({ ...entry, command });
        }
      }
      
      const data: LearnedCorrectionsData = {
        version: "1.0.0",
        description: "Learned corrections from user behavior",
        corrections: allCorrections,
      };
      
      // Ensure directory exists
      const dir = dirname(this.correctionsFile);
      await import('node:fs/promises').then(fs => fs.mkdir(dir, { recursive: true }));
      
      await writeFile(this.correctionsFile, JSON.stringify(data, null, 2));
    } catch (error) {
      console.warn(`Could not save learned corrections to ${this.correctionsFile}:`, error);
    }
  }
  
  /**
   * Get learned correction for a command/subcommand combination
   * Returns undefined if no learned correction exists
   */
  getCorrection(command: string, subcommand: string): string | undefined {
    // Check command-specific corrections first
    const commandCorrections = this.corrections.get(command);
    if (commandCorrections?.has(subcommand)) {
      const entry = commandCorrections.get(subcommand)!;
      // Update usage stats
      entry.frequency++;
      entry.lastUsed = new Date().toISOString();
      commandCorrections.set(subcommand, entry);
      
      // Save asynchronously
      this.saveLearnedCorrections().catch(() => {});
      
      return entry.correct;
    }
    
    // Check global corrections
    const globalEntry = this.globalCorrections.get(subcommand);
    if (globalEntry) {
      // Update usage stats
      globalEntry.frequency++;
      globalEntry.lastUsed = new Date().toISOString();
      this.globalCorrections.set(subcommand, globalEntry);
      
      // Save asynchronously
      this.saveLearnedCorrections().catch(() => {});
      
      return globalEntry.correct;
    }
    
    return undefined;
  }
  
  /**
   * Get learned correction for a top-level command
   */
  getCommandCorrection(command: string): string | undefined {
    const entry = this.globalCorrections.get(command);
    if (entry) {
      // Update usage stats
      entry.frequency++;
      entry.lastUsed = new Date().toISOString();
      this.globalCorrections.set(command, entry);
      
      // Save asynchronously
      this.saveLearnedCorrections().catch(() => {});
      
      return entry.correct;
    }
    return undefined;
  }
  
  /**
   * Learn a new correction from user behavior
   */
  learnCorrection(incorrect: string, correct: string, command?: string): void {
    if (command) {
      // Command-specific correction
      if (!this.corrections.has(command)) {
        this.corrections.set(command, new Map());
      }
      
      const commandCorrections = this.corrections.get(command)!;
      const existing = commandCorrections.get(incorrect);
      
      if (existing) {
        // Update existing
        existing.frequency++;
        existing.lastUsed = new Date().toISOString();
        existing.correct = correct; // Update in case it changed
      } else {
        // Create new
        const entry: LearnedCorrectionEntry = {
          incorrect,
          correct,
          frequency: 1,
          lastUsed: new Date().toISOString(),
          command,
          confidence: 0.7, // Start with good confidence since it's from user behavior
        };
        commandCorrections.set(incorrect, entry);
      }
    } else {
      // Global correction
      const existing = this.globalCorrections.get(incorrect);
      
      if (existing) {
        // Update existing
        existing.frequency++;
        existing.lastUsed = new Date().toISOString();
        existing.correct = correct;
      } else {
        // Create new
        const entry: LearnedCorrectionEntry = {
          incorrect,
          correct,
          frequency: 1,
          lastUsed: new Date().toISOString(),
          confidence: 0.7,
        };
        this.globalCorrections.set(incorrect, entry);
      }
    }
    
    // Save asynchronously
    this.saveLearnedCorrections().catch(() => {});
  }
  
  /**
   * Get statistics about learned corrections
   */
  getStats(): { 
    totalCorrections: number; 
    commandSpecific: number; 
    global: number; 
    commands: string[];
    topCorrections: Array<{ incorrect: string; correct: string; frequency: number }>;
  } {
    let commandSpecific = 0;
    const commands = new Set<string>();
    const allCorrections: LearnedCorrectionEntry[] = [];
    
    for (const [command, corrections] of this.corrections.entries()) {
      commands.add(command);
      commandSpecific += corrections.size;
      for (const entry of corrections.values()) {
        allCorrections.push(entry);
      }
    }
    
    for (const entry of this.globalCorrections.values()) {
      allCorrections.push(entry);
    }
    
    const topCorrections = allCorrections
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, 10)
      .map(c => ({ incorrect: c.incorrect, correct: c.correct, frequency: c.frequency }));
    
    return {
      totalCorrections: commandSpecific + this.globalCorrections.size,
      commandSpecific,
      global: this.globalCorrections.size,
      commands: Array.from(commands),
      topCorrections,
    };
  }
}

// ---------------------------------------------------------------------------
// Default instance and helper functions
// ---------------------------------------------------------------------------

let defaultManager: LearnedCorrectionsManager | null = null;

/**
 * Get the default learned corrections manager
 */
export function getDefaultLearnedCorrections(): LearnedCorrectionsManager {
  if (!defaultManager) {
    defaultManager = new LearnedCorrectionsManager();
  }
  return defaultManager;
}

/**
 * Initialize learned corrections manager
 */
export async function initializeLearnedCorrections(): Promise<LearnedCorrectionsManager> {
  const manager = new LearnedCorrectionsManager();
  await manager.loadLearnedCorrections();
  defaultManager = manager;
  return manager;
}