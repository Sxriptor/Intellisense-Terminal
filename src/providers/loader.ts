/**
 * Dynamic provider loading utilities.
 *
 * Implements Req 8.4: WHERE an external AI provider is configured, the Daemon
 * SHALL load the provider module by the path specified in the configuration.
 *
 * The dynamic loading logic already exists in src/daemon.ts (_loadModule).
 * This module exposes it as a reusable utility so that other parts of the
 * codebase (and external tooling) can load providers without depending on the
 * full Daemon class.
 */

import type { SuggestionProvider } from "./types.js";
import type { MemoryPredictor } from "./types.js";

// ---------------------------------------------------------------------------
// loadProvider
// ---------------------------------------------------------------------------

/**
 * Dynamically load an external suggestion provider from the given module path.
 *
 * The module must export a default that implements the SuggestionProvider
 * interface (i.e., has a `suggest(buffer, history)` method).
 *
 * @param modulePath - Absolute or relative path to the provider module.
 * @returns The loaded SuggestionProvider, or null if loading fails.
 */
export async function loadProvider(
  modulePath: string
): Promise<SuggestionProvider | null> {
  return _loadModule<SuggestionProvider>(modulePath, "suggestion provider");
}

// ---------------------------------------------------------------------------
// loadMemoryPredictor
// ---------------------------------------------------------------------------

/**
 * Dynamically load an external memory predictor from the given module path.
 *
 * The module must export a default that implements the MemoryPredictor
 * interface (i.e., has `predict(recentCommands)` and `record(command, sessionId)` methods).
 *
 * @param modulePath - Absolute or relative path to the predictor module.
 * @returns The loaded MemoryPredictor, or null if loading fails.
 */
export async function loadMemoryPredictor(
  modulePath: string
): Promise<MemoryPredictor | null> {
  return _loadModule<MemoryPredictor>(modulePath, "memory predictor");
}

// ---------------------------------------------------------------------------
// Internal helper
// ---------------------------------------------------------------------------

/**
 * Dynamically import a module at `modulePath` and return its default export.
 *
 * Returns `null` and logs a warning if:
 *  - The module cannot be found or loaded.
 *  - The module does not export a default.
 */
async function _loadModule<T>(
  modulePath: string,
  label: string
): Promise<T | null> {
  try {
    // Dynamic import — works for both ESM and CJS modules (Req 8.4)
    const mod = (await import(modulePath)) as { default?: T };

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
