/**
 * Unit tests for shell hook snippet generation (Task 11.5).
 *
 * Tests verify:
 *  - Required function names are present in each snippet
 *  - ANSI escape codes for ghost text rendering are present
 *  - IPC calls for autocorrect and suggestion are present
 *  - 100ms timeout is applied to IPC calls
 *  - Shell-specific integration points (add-zsh-hook, PROMPT_COMMAND, etc.)
 */

import { describe, it, expect } from "vitest";
import { getZshHook, getBashHook, getPowerShellHook, getShellHook } from "../../shell-hook.js";

// ---------------------------------------------------------------------------
// 11.1 — Zsh hook snippet
// ---------------------------------------------------------------------------

describe("getZshHook", () => {
  it("contains _tac_preexec function", () => {
    const snippet = getZshHook();
    expect(snippet).toContain("_tac_preexec()");
  });

  it("contains _tac_zle_widget function", () => {
    const snippet = getZshHook();
    expect(snippet).toContain("_tac_zle_widget()");
  });

  it("registers preexec hook via add-zsh-hook", () => {
    const snippet = getZshHook();
    expect(snippet).toContain("add-zsh-hook");
    expect(snippet).toContain("preexec");
    expect(snippet).toContain("_tac_preexec");
  });

  it("registers ZLE widget with zle -N", () => {
    const snippet = getZshHook();
    expect(snippet).toContain("zle -N _tac_zle_widget");
  });

  it("binds Tab key (^I) to the ZLE widget", () => {
    const snippet = getZshHook();
    expect(snippet).toContain("bindkey");
    expect(snippet).toContain("^I");
    expect(snippet).toContain("_tac_zle_widget");
  });

  it("autoloads add-zsh-hook", () => {
    const snippet = getZshHook();
    expect(snippet).toContain("autoload -Uz add-zsh-hook");
  });

  // 11.3 — IPC calls
  it("contains IPC call for autocorrect", () => {
    const snippet = getZshHook();
    expect(snippet).toContain("terminal-autocorrect --ipc correct");
  });

  it("contains IPC call for suggestion", () => {
    const snippet = getZshHook();
    expect(snippet).toContain("terminal-autocorrect --ipc suggest");
  });

  it("applies 100ms timeout to IPC calls", () => {
    const snippet = getZshHook();
    expect(snippet).toContain("timeout 0.1");
  });

  // 11.4 — Ghost text rendering
  it("renders ghost text with ANSI dim escape sequence", () => {
    const snippet = getZshHook();
    expect(snippet).toContain("\\033[2m");
  });

  it("resets ANSI formatting after ghost text", () => {
    const snippet = getZshHook();
    expect(snippet).toContain("\\033[0m");
  });

  it("uses $BUFFER for the current input buffer", () => {
    const snippet = getZshHook();
    expect(snippet).toContain("$BUFFER");
  });

  it("returns a non-empty string", () => {
    const snippet = getZshHook();
    expect(snippet.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 11.2 — Bash hook snippet
// ---------------------------------------------------------------------------

describe("getBashHook", () => {
  it("contains _tac_preexec function", () => {
    const snippet = getBashHook();
    expect(snippet).toContain("_tac_preexec()");
  });

  it("contains _tac_precmd function", () => {
    const snippet = getBashHook();
    expect(snippet).toContain("_tac_precmd()");
  });

  it("supports bash-preexec via preexec_functions array", () => {
    const snippet = getBashHook();
    expect(snippet).toContain("preexec_functions");
    expect(snippet).toContain("_tac_preexec");
  });

  it("supports bash-preexec via precmd_functions array", () => {
    const snippet = getBashHook();
    expect(snippet).toContain("precmd_functions");
    expect(snippet).toContain("_tac_precmd");
  });

  it("falls back to PROMPT_COMMAND when bash-preexec is unavailable", () => {
    const snippet = getBashHook();
    expect(snippet).toContain("PROMPT_COMMAND");
    expect(snippet).toContain("_tac_precmd");
  });

  it("uses DEBUG trap as fallback for preexec in bash", () => {
    const snippet = getBashHook();
    expect(snippet).toContain("trap");
    expect(snippet).toContain("DEBUG");
  });

  // 11.3 — IPC calls
  it("contains IPC call for autocorrect", () => {
    const snippet = getBashHook();
    expect(snippet).toContain("terminal-autocorrect --ipc correct");
  });

  it("contains IPC call for suggestion", () => {
    const snippet = getBashHook();
    expect(snippet).toContain("terminal-autocorrect --ipc suggest");
  });

  it("applies 100ms timeout to IPC calls", () => {
    const snippet = getBashHook();
    expect(snippet).toContain("timeout 0.1");
  });

  // 11.4 — Ghost text rendering
  it("renders ghost text with ANSI dim escape sequence", () => {
    const snippet = getBashHook();
    expect(snippet).toContain("\\033[2m");
  });

  it("resets ANSI formatting after ghost text", () => {
    const snippet = getBashHook();
    expect(snippet).toContain("\\033[0m");
  });

  it("returns a non-empty string", () => {
    const snippet = getBashHook();
    expect(snippet.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// getShellHook — public API
// ---------------------------------------------------------------------------

describe("getShellHook", () => {
  it("returns zsh snippet for 'zsh'", () => {
    const snippet = getShellHook("zsh");
    expect(snippet).toBe(getZshHook());
  });

  it("returns bash snippet for 'bash'", () => {
    const snippet = getShellHook("bash");
    expect(snippet).toBe(getBashHook());
  });

  it("throws for unsupported shell", () => {
    expect(() => getShellHook("fish" as "bash" | "zsh" | "powershell")).toThrow("Unsupported shell");
  });

  it("returns powershell snippet for 'powershell'", () => {
    const snippet = getShellHook("powershell");
    expect(snippet).toBe(getPowerShellHook());
  });

  it("zsh snippet contains all required elements", () => {
    const snippet = getShellHook("zsh");
    // Function names
    expect(snippet).toContain("_tac_preexec");
    expect(snippet).toContain("_tac_zle_widget");
    // Hook registration
    expect(snippet).toContain("add-zsh-hook");
    // IPC calls with timeout
    expect(snippet).toContain("terminal-autocorrect --ipc correct");
    expect(snippet).toContain("terminal-autocorrect --ipc suggest");
    expect(snippet).toContain("timeout 0.1");
    // ANSI codes
    expect(snippet).toContain("\\033[2m");
    expect(snippet).toContain("\\033[0m");
  });

  it("bash snippet contains all required elements", () => {
    const snippet = getShellHook("bash");
    // Function names
    expect(snippet).toContain("_tac_preexec");
    expect(snippet).toContain("_tac_precmd");
    // Fallback mechanism
    expect(snippet).toContain("PROMPT_COMMAND");
    // IPC calls with timeout
    expect(snippet).toContain("terminal-autocorrect --ipc correct");
    expect(snippet).toContain("terminal-autocorrect --ipc suggest");
    expect(snippet).toContain("timeout 0.1");
    // ANSI codes
    expect(snippet).toContain("\\033[2m");
    expect(snippet).toContain("\\033[0m");
  });
});

// ---------------------------------------------------------------------------
// PowerShell hook snippet (Windows)
// ---------------------------------------------------------------------------

describe("getPowerShellHook", () => {
  it("contains _TacSend helper function", () => {
    const snippet = getPowerShellHook();
    expect(snippet).toContain("function _TacSend");
  });

  it("contains prompt wrapper for recording commands", () => {
    const snippet = getPowerShellHook();
    expect(snippet).toContain("function global:prompt");
  });

  it("hooks into PreCommandLookupAction for autocorrect", () => {
    const snippet = getPowerShellHook();
    expect(snippet).toContain("PreCommandLookupAction");
  });

  it("uses Set-PSReadLineKeyHandler for Tab ghost-text", () => {
    const snippet = getPowerShellHook();
    expect(snippet).toContain("Set-PSReadLineKeyHandler");
    expect(snippet).toContain("-Key Tab");
  });

  it("contains IPC call for autocorrect", () => {
    const snippet = getPowerShellHook();
    // The PowerShell hook uses _TacSend -Type 'correct' which calls
    // `tac --ipc $Type` — verify the binary name is present
    expect(snippet).toContain("tac --ipc");
  });

  it("contains IPC call for suggestion", () => {
    const snippet = getPowerShellHook();
    expect(snippet).toContain("tac --ipc");
    expect(snippet).toContain("suggest");
  });

  it("contains IPC call for record", () => {
    const snippet = getPowerShellHook();
    expect(snippet).toContain("tac --ipc");
    expect(snippet).toContain("record");
  });

  it("wraps the original prompt function", () => {
    const snippet = getPowerShellHook();
    expect(snippet).toContain("function global:prompt");
    expect(snippet).toContain("_TacOriginalPrompt");
  });

  it("returns a non-empty string", () => {
    const snippet = getPowerShellHook();
    expect(snippet.length).toBeGreaterThan(0);
  });
});
