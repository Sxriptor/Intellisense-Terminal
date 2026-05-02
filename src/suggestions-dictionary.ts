/**
 * Suggestions Dictionary System
 * 
 * Manages command completion suggestions based on prefixes.
 * Different from corrections - this predicts completions, not fixes typos.
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { TAC_HOME } from "./paths.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SuggestionEntry {
  /** The partial command prefix */
  prefix: string;
  /** The suggested completion */
  completion: string;
  /** How many times this suggestion was used */
  frequency: number;
  /** Last time this was used */
  lastUsed: string;
  /** Optional: specific command this applies to */
  command?: string;
  /** Optional: confidence score (0-1) */
  confidence?: number;
}

export interface SuggestionsDictionary {
  /** Version of the suggestions format */
  version: string;
  /** Description of this suggestions set */
  description?: string;
  /** Array of suggestion entries */
  suggestions: SuggestionEntry[];
}

// ---------------------------------------------------------------------------
// Built-in suggestions (common command completions)
// ---------------------------------------------------------------------------

const BUILTIN_SUGGESTIONS: SuggestionEntry[] = [
  // Git suggestions
  { prefix: "git st", completion: "git status", frequency: 100, lastUsed: new Date().toISOString(), command: "git" },
  { prefix: "git co", completion: "git checkout", frequency: 80, lastUsed: new Date().toISOString(), command: "git" },
  { prefix: "git com", completion: "git commit", frequency: 90, lastUsed: new Date().toISOString(), command: "git" },
  { prefix: "git comm", completion: "git commit", frequency: 95, lastUsed: new Date().toISOString(), command: "git" },
  { prefix: "git pu", completion: "git push", frequency: 85, lastUsed: new Date().toISOString(), command: "git" },
  { prefix: "git pus", completion: "git push", frequency: 90, lastUsed: new Date().toISOString(), command: "git" },
  { prefix: "git pul", completion: "git pull", frequency: 85, lastUsed: new Date().toISOString(), command: "git" },
  { prefix: "git pull", completion: "git pull", frequency: 95, lastUsed: new Date().toISOString(), command: "git" },
  { prefix: "git br", completion: "git branch", frequency: 70, lastUsed: new Date().toISOString(), command: "git" },
  { prefix: "git bra", completion: "git branch", frequency: 80, lastUsed: new Date().toISOString(), command: "git" },
  { prefix: "git ad", completion: "git add", frequency: 90, lastUsed: new Date().toISOString(), command: "git" },
  { prefix: "git add", completion: "git add .", frequency: 60, lastUsed: new Date().toISOString(), command: "git" },
  { prefix: "git cl", completion: "git clone", frequency: 50, lastUsed: new Date().toISOString(), command: "git" },
  { prefix: "git clo", completion: "git clone", frequency: 70, lastUsed: new Date().toISOString(), command: "git" },
  { prefix: "git di", completion: "git diff", frequency: 60, lastUsed: new Date().toISOString(), command: "git" },
  { prefix: "git dif", completion: "git diff", frequency: 80, lastUsed: new Date().toISOString(), command: "git" },
  { prefix: "git lo", completion: "git log", frequency: 50, lastUsed: new Date().toISOString(), command: "git" },
  { prefix: "git log", completion: "git log --oneline", frequency: 40, lastUsed: new Date().toISOString(), command: "git" },
  
  // NPM suggestions
  { prefix: "npm i", completion: "npm install", frequency: 95, lastUsed: new Date().toISOString(), command: "npm" },
  { prefix: "npm in", completion: "npm install", frequency: 90, lastUsed: new Date().toISOString(), command: "npm" },
  { prefix: "npm ins", completion: "npm install", frequency: 85, lastUsed: new Date().toISOString(), command: "npm" },
  { prefix: "npm inst", completion: "npm install", frequency: 80, lastUsed: new Date().toISOString(), command: "npm" },
  { prefix: "npm s", completion: "npm start", frequency: 80, lastUsed: new Date().toISOString(), command: "npm" },
  { prefix: "npm st", completion: "npm start", frequency: 85, lastUsed: new Date().toISOString(), command: "npm" },
  { prefix: "npm sta", completion: "npm start", frequency: 90, lastUsed: new Date().toISOString(), command: "npm" },
  { prefix: "npm t", completion: "npm test", frequency: 70, lastUsed: new Date().toISOString(), command: "npm" },
  { prefix: "npm te", completion: "npm test", frequency: 80, lastUsed: new Date().toISOString(), command: "npm" },
  { prefix: "npm tes", completion: "npm test", frequency: 85, lastUsed: new Date().toISOString(), command: "npm" },
  { prefix: "npm b", completion: "npm run build", frequency: 60, lastUsed: new Date().toISOString(), command: "npm" },
  { prefix: "npm bu", completion: "npm run build", frequency: 70, lastUsed: new Date().toISOString(), command: "npm" },
  { prefix: "npm bui", completion: "npm run build", frequency: 75, lastUsed: new Date().toISOString(), command: "npm" },
  { prefix: "npm buil", completion: "npm run build", frequency: 80, lastUsed: new Date().toISOString(), command: "npm" },
  { prefix: "npm r", completion: "npm run", frequency: 85, lastUsed: new Date().toISOString(), command: "npm" },
  { prefix: "npm ru", completion: "npm run", frequency: 90, lastUsed: new Date().toISOString(), command: "npm" },
  { prefix: "npm run", completion: "npm run dev", frequency: 50, lastUsed: new Date().toISOString(), command: "npm" },
  
  // Docker suggestions
  { prefix: "docker r", completion: "docker run", frequency: 80, lastUsed: new Date().toISOString(), command: "docker" },
  { prefix: "docker ru", completion: "docker run", frequency: 85, lastUsed: new Date().toISOString(), command: "docker" },
  { prefix: "docker b", completion: "docker build", frequency: 70, lastUsed: new Date().toISOString(), command: "docker" },
  { prefix: "docker bu", completion: "docker build", frequency: 75, lastUsed: new Date().toISOString(), command: "docker" },
  { prefix: "docker bui", completion: "docker build", frequency: 80, lastUsed: new Date().toISOString(), command: "docker" },
  { prefix: "docker p", completion: "docker ps", frequency: 90, lastUsed: new Date().toISOString(), command: "docker" },
  { prefix: "docker ps", completion: "docker ps -a", frequency: 60, lastUsed: new Date().toISOString(), command: "docker" },
  { prefix: "docker i", completion: "docker images", frequency: 70, lastUsed: new Date().toISOString(), command: "docker" },
  { prefix: "docker im", completion: "docker images", frequency: 80, lastUsed: new Date().toISOString(), command: "docker" },
  { prefix: "docker ima", completion: "docker images", frequency: 85, lastUsed: new Date().toISOString(), command: "docker" },
  
  // Shell suggestions
  { prefix: "l", completion: "ls", frequency: 95, lastUsed: new Date().toISOString() },
  { prefix: "ls", completion: "ls -la", frequency: 60, lastUsed: new Date().toISOString() },
  { prefix: "ll", completion: "ls -la", frequency: 80, lastUsed: new Date().toISOString() },
  { prefix: "c", completion: "cd", frequency: 90, lastUsed: new Date().toISOString() },
  { prefix: "cd", completion: "cd ..", frequency: 40, lastUsed: new Date().toISOString() },
  { prefix: "cd .", completion: "cd ..", frequency: 70, lastUsed: new Date().toISOString() },
  { prefix: "mk", completion: "mkdir", frequency: 80, lastUsed: new Date().toISOString() },
  { prefix: "mkd", completion: "mkdir", frequency: 85, lastUsed: new Date().toISOString() },
  { prefix: "mkdi", completion: "mkdir", frequency: 90, lastUsed: new Date().toISOString() },
];

// ---------------------------------------------------------------------------
// SuggestionsDictionaryManager
// ---------------------------------------------------------------------------

export class SuggestionsDictionaryManager {
  private suggestions = new Map<string, SuggestionEntry>();
  private learnedSuggestions = new Map<string, SuggestionEntry>();
  private suggestionsFile: string;
  
  constructor(suggestionsFile?: string) {
    this.suggestionsFile = suggestionsFile || join(TAC_HOME, 'learned-suggestions.json');
    this.loadBuiltinSuggestions();
  }
  
  /**
   * Load built-in suggestions into the manager
   */
  private loadBuiltinSuggestions(): void {
    for (const entry of BUILTIN_SUGGESTIONS) {
      this.suggestions.set(entry.prefix, entry);
    }
  }
  
  /**
   * Load suggestions from a JSON file
   */
  async loadFromFile(filePath: string): Promise<void> {
    try {
      const content = await readFile(filePath, 'utf-8');
      const dictionary: SuggestionsDictionary = JSON.parse(content);
      
      for (const entry of dictionary.suggestions) {
        this.suggestions.set(entry.prefix, entry);
      }
    } catch (error) {
      // Silently ignore file loading errors - suggestions are optional
      console.warn(`Could not load suggestions from ${filePath}:`, error);
    }
  }
  
  /**
   * Load learned suggestions from the persistent file
   */
  async loadLearnedSuggestions(): Promise<void> {
    try {
      const content = await readFile(this.suggestionsFile, 'utf-8');
      const dictionary: SuggestionsDictionary = JSON.parse(content);
      
      for (const entry of dictionary.suggestions) {
        this.learnedSuggestions.set(entry.prefix, entry);
        // Also add to main suggestions with higher priority
        this.suggestions.set(entry.prefix, entry);
      }
    } catch (error) {
      // File doesn't exist yet - that's fine
    }
  }
  
  /**
   * Save learned suggestions to persistent storage
   */
  async saveLearnedSuggestions(): Promise<void> {
    try {
      const dictionary: SuggestionsDictionary = {
        version: "1.0.0",
        description: "Learned command suggestions",
        suggestions: Array.from(this.learnedSuggestions.values()),
      };
      
      // Ensure directory exists
      const dir = dirname(this.suggestionsFile);
      await import('node:fs/promises').then(fs => fs.mkdir(dir, { recursive: true }));
      
      await writeFile(this.suggestionsFile, JSON.stringify(dictionary, null, 2));
    } catch (error) {
      console.warn(`Could not save suggestions to ${this.suggestionsFile}:`, error);
    }
  }
  
  /**
   * Get suggestion for a command prefix
   * Learned suggestions have higher priority than built-in ones
   */
  getSuggestion(prefix: string): string | undefined {
    // Check learned suggestions first (higher priority)
    const learnedEntry = this.learnedSuggestions.get(prefix);
    if (learnedEntry) {
      // Update frequency and last used
      learnedEntry.frequency++;
      learnedEntry.lastUsed = new Date().toISOString();
      this.learnedSuggestions.set(prefix, learnedEntry);
      
      // Save asynchronously without blocking
      this.saveLearnedSuggestions().catch(() => {});
      
      return learnedEntry.completion;
    }
    
    // Fall back to built-in suggestions
    const builtinEntry = this.suggestions.get(prefix);
    if (builtinEntry) {
      return builtinEntry.completion;
    }
    
    // Try partial matching - find suggestions that start with this prefix
    // Check learned first, then built-in
    const learnedMatches = Array.from(this.learnedSuggestions.entries())
      .filter(([key, _]) => key.startsWith(prefix))
      .sort((a, b) => b[1].frequency - a[1].frequency);
    
    if (learnedMatches.length > 0) {
      const [_, bestMatch] = learnedMatches[0];
      return bestMatch.completion;
    }
    
    const builtinMatches = Array.from(this.suggestions.entries())
      .filter(([key, _]) => key.startsWith(prefix))
      .sort((a, b) => b[1].frequency - a[1].frequency);
    
    if (builtinMatches.length > 0) {
      const [_, bestMatch] = builtinMatches[0];
      return bestMatch.completion;
    }
    
    return undefined;
  }
  
  /**
   * Learn a new suggestion from user behavior
   */
  learnSuggestion(prefix: string, completion: string, command?: string): void {
    const existing = this.learnedSuggestions.get(prefix);
    
    if (existing) {
      // Update existing
      existing.frequency++;
      existing.lastUsed = new Date().toISOString();
      existing.completion = completion; // Update in case it changed
    } else {
      // Create new
      const entry: SuggestionEntry = {
        prefix,
        completion,
        frequency: 1,
        lastUsed: new Date().toISOString(),
        command,
        confidence: 0.5, // Start with medium confidence
      };
      this.learnedSuggestions.set(prefix, entry);
    }
    
    // Also add to main suggestions
    this.suggestions.set(prefix, this.learnedSuggestions.get(prefix)!);
    
    // Save asynchronously
    this.saveLearnedSuggestions().catch(() => {});
  }
  
  /**
   * Get statistics about suggestions
   */
  getStats(): { 
    totalSuggestions: number; 
    builtinSuggestions: number; 
    learnedSuggestions: number; 
    commands: string[];
    topSuggestions: Array<{ prefix: string; completion: string; frequency: number }>;
  } {
    const commands = new Set<string>();
    const allSuggestions = Array.from(this.suggestions.values());
    
    allSuggestions.forEach(s => {
      if (s.command) commands.add(s.command);
    });
    
    const topSuggestions = allSuggestions
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, 10)
      .map(s => ({ prefix: s.prefix, completion: s.completion, frequency: s.frequency }));
    
    return {
      totalSuggestions: this.suggestions.size,
      builtinSuggestions: BUILTIN_SUGGESTIONS.length,
      learnedSuggestions: this.learnedSuggestions.size,
      commands: Array.from(commands),
      topSuggestions,
    };
  }
}

// ---------------------------------------------------------------------------
// Default instance and helper functions
// ---------------------------------------------------------------------------

let defaultManager: SuggestionsDictionaryManager | null = null;

/**
 * Get the default suggestions dictionary manager
 */
export function getDefaultSuggestionsDictionary(): SuggestionsDictionaryManager {
  if (!defaultManager) {
    defaultManager = new SuggestionsDictionaryManager();
  }
  return defaultManager;
}

/**
 * Initialize suggestions dictionary with custom sources
 */
export async function initializeSuggestionsDictionary(sources: string[] = []): Promise<SuggestionsDictionaryManager> {
  const manager = new SuggestionsDictionaryManager();
  
  // Try to load from default package locations if no sources provided
  if (sources.length === 0) {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const defaultSources = [
      join(__dirname, '..', 'suggestions', 'common.json'),
    ];
    sources = defaultSources;
  }
  
  // Load from sources
  await Promise.all(sources.map(source => manager.loadFromFile(source)));
  
  // Load learned suggestions from user directory
  await manager.loadLearnedSuggestions();
  
  defaultManager = manager;
  return manager;
}