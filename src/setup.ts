import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { TAC_HOME } from "./paths.js";
import { getShellHook } from "./shell-hook.js";

export type SetupShell = "bash" | "zsh" | "powershell";

export interface InstallShellSetupOptions {
  shell?: string;
  homeDir?: string;
  tacHome?: string;
  hookFilePath?: string;
  profilePaths?: string[];
}

export interface InstallShellSetupResult {
  shell: SetupShell;
  hookFilePath: string;
  profilePaths: string[];
  updatedProfiles: string[];
}

function isSetupShell(value: string): value is SetupShell {
  return value === "bash" || value === "zsh" || value === "powershell";
}

export function detectShell(): SetupShell {
  if (process.platform === "win32") {
    return "powershell";
  }

  const shellPath = process.env["SHELL"] ?? "";
  if (shellPath.includes("zsh")) return "zsh";
  if (shellPath.includes("bash")) return "bash";

  return "bash";
}

export function resolveShell(shell?: string): SetupShell {
  if (shell === undefined || shell.trim() === "") {
    return detectShell();
  }

  if (isSetupShell(shell)) {
    return shell;
  }

  throw new Error(
    `Unsupported shell: "${shell}". Supported shells: bash, zsh, powershell`
  );
}

export function getDefaultHookFilePath(shell: SetupShell, tacHome: string = TAC_HOME): string {
  switch (shell) {
    case "bash":
      return join(tacHome, "tac-hook.bash");
    case "zsh":
      return join(tacHome, "tac-hook.zsh");
    case "powershell":
      return join(tacHome, "tac-hook.ps1");
  }
}

export function getDefaultProfilePaths(shell: SetupShell, homeDir: string = homedir()): string[] {
  switch (shell) {
    case "bash":
      return [join(homeDir, ".bashrc")];
    case "zsh":
      return [join(homeDir, ".zshrc")];
    case "powershell":
      return [
        join(homeDir, "Documents", "WindowsPowerShell", "Microsoft.PowerShell_profile.ps1"),
        join(homeDir, "Documents", "PowerShell", "Microsoft.PowerShell_profile.ps1"),
      ];
  }
}

function getProfileLine(shell: SetupShell, hookFilePath: string): string {
  if (shell === "powershell") {
    return `. "${hookFilePath}"`;
  }

  return `source "${hookFilePath}"`;
}

async function ensureProfileBlock(profilePath: string, line: string): Promise<boolean> {
  const marker = "# terminalsense setup";

  let existing = "";
  try {
    existing = await readFile(profilePath, "utf-8");
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code !== "ENOENT") {
      throw err;
    }
  }

  if (existing.includes(line)) {
    return false;
  }

  const separator = existing.length > 0 ? (existing.endsWith("\n") ? "\n" : "\n\n") : "";
  const next = `${existing}${separator}${marker}\n${line}\n`;

  await mkdir(dirname(profilePath), { recursive: true });
  await writeFile(profilePath, next, "utf-8");
  return true;
}

export async function installShellSetup(
  options: InstallShellSetupOptions = {}
): Promise<InstallShellSetupResult> {
  const shell = resolveShell(options.shell);
  const homeDir = options.homeDir ?? homedir();
  const tacHome = options.tacHome ?? TAC_HOME;
  const hookFilePath = options.hookFilePath ?? getDefaultHookFilePath(shell, tacHome);
  const profilePaths = options.profilePaths ?? getDefaultProfilePaths(shell, homeDir);

  await mkdir(dirname(hookFilePath), { recursive: true });
  await writeFile(hookFilePath, `${getShellHook(shell)}\n`, "utf-8");

  const line = getProfileLine(shell, hookFilePath);
  const updatedProfiles: string[] = [];

  for (const profilePath of profilePaths) {
    const updated = await ensureProfileBlock(profilePath, line);
    if (updated) {
      updatedProfiles.push(profilePath);
    }
  }

  return {
    shell,
    hookFilePath,
    profilePaths,
    updatedProfiles,
  };
}
