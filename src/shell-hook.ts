/**
 * Shell hook snippet generation for bash and zsh.
 *
 * The `init` CLI command outputs the appropriate snippet so the user can
 * eval it in their shell configuration file.
 */

// ---------------------------------------------------------------------------
// Zsh hook snippet
// ---------------------------------------------------------------------------

/**
 * Returns the zsh shell hook snippet.
 *
 * The snippet defines:
 *  - `_tac_preexec`: runs before each command, sends buffer to daemon for
 *    autocorrect via IPC, and re-executes the corrected command if one is
 *    returned.
 *  - `_tac_zle_widget`: ZLE widget that fires on Tab, sends the current
 *    buffer to the daemon for a ghost-text suggestion, and renders it.
 *
 * The user adds `eval "$(terminal-autocorrect init zsh)"` to their `.zshrc`.
 */
export function getZshHook(): string {
  return `# terminal-autocorrect zsh hook
# Add this to your ~/.zshrc:
#   eval "$(terminal-autocorrect init zsh)"

_tac_preexec() {
  local result
  result=$(echo "$1" | timeout 0.1 terminal-autocorrect --ipc correct 2>/dev/null)
  if [[ -n "$result" ]]; then
    print -n "\\r\\033[K✓ autocorrected: $result\\n"
    eval "$result"
    return 1
  fi
}

_tac_zle_widget() {
  local ghost
  ghost=$(echo "$BUFFER" | timeout 0.1 terminal-autocorrect --ipc suggest 2>/dev/null)
  if [[ -n "$ghost" ]]; then
    print -Pn "\\033[2m\${ghost}\\033[0m"
  fi
}

autoload -Uz add-zsh-hook
add-zsh-hook preexec _tac_preexec
zle -N _tac_zle_widget
bindkey '^I' _tac_zle_widget
`;
}

// ---------------------------------------------------------------------------
// Bash hook snippet
// ---------------------------------------------------------------------------

/**
 * Returns the bash shell hook snippet.
 *
 * The snippet uses `bash-preexec` (a widely-used compatibility shim) to
 * provide `preexec` and `precmd` hooks equivalent to zsh's.
 *
 * The user adds `eval "$(terminal-autocorrect init bash)"` to their
 * `.bashrc` or `.bash_profile`.
 */
export function getBashHook(): string {
  return `# terminal-autocorrect bash hook
# Add this to your ~/.bashrc:
#   eval "$(terminal-autocorrect init bash)"

_tac_preexec() {
  local result
  result=$(echo "$1" | timeout 0.1 terminal-autocorrect --ipc correct 2>/dev/null)
  if [[ -n "$result" ]]; then
    echo -e "\\r\\033[K✓ autocorrected: $result"
    eval "$result"
    return 1
  fi
}

_tac_precmd() {
  local ghost
  ghost=$(echo "$READLINE_LINE" | timeout 0.1 terminal-autocorrect --ipc suggest 2>/dev/null)
  if [[ -n "$ghost" ]]; then
    echo -ne "\\033[2m\${ghost}\\033[0m"
  fi
}

# Use bash-preexec if available, otherwise fall back to PROMPT_COMMAND
if declare -f preexec_functions > /dev/null 2>&1; then
  preexec_functions+=(_tac_preexec)
  precmd_functions+=(_tac_precmd)
else
  _tac_original_prompt_command="\${PROMPT_COMMAND}"
  PROMPT_COMMAND="_tac_precmd\${_tac_original_prompt_command:+; \${_tac_original_prompt_command}}"
  trap '_tac_preexec "\$BASH_COMMAND"' DEBUG
fi
`;
}

// ---------------------------------------------------------------------------
// PowerShell hook snippet (Windows)
// ---------------------------------------------------------------------------

/**
 * Returns the PowerShell shell hook snippet for Windows.
 *
 * The snippet hooks into PSReadLine (included with PowerShell 5.1+ and pwsh)
 * to provide:
 *  - `_TacPreExecution`: runs before each command via `$ExecutionContext.InvokeCommand.PreCommandLookupAction`
 *    to send the buffer to the daemon for autocorrect.
 *  - A custom Tab key handler via `Set-PSReadLineKeyHandler` for ghost-text suggestions.
 *
 * The user adds the following to their PowerShell profile
 * (`$PROFILE` — typically `~\Documents\PowerShell\Microsoft.PowerShell_profile.ps1`):
 *
 *   Invoke-Expression (& terminal-autocorrect init powershell)
 */
export function getPowerShellHook(): string {
  return `# terminal-autocorrect PowerShell hook
# Add this to your PowerShell profile ($PROFILE):
#   Invoke-Expression ((& tac init powershell) -join "\`n")

function _TacSend {
  param([string]$Type, [string]$Buffer)
  
  # Prevent recursion: skip if we're already inside the hook
  if ($global:_TacInHook) { return $null }
  
  try {
    $global:_TacInHook = $true
    $result = & tac --ipc $Type --buffer $Buffer 2>$null
    if ($result -is [array]) { return ($result -join '') }
    return $result
  } catch {
    return $null
  } finally {
    $global:_TacInHook = $false
  }
}

# Initialize guard variable
$global:_TacInHook = $false

# Autocorrect: Use PSReadLine to intercept the full command line before execution
# This works for all commands, including external executables like git, npm, etc.
if (Get-Module -ListAvailable -Name PSReadLine) {
  Set-PSReadLineKeyHandler -Key Enter -ScriptBlock {
    $line = $null
    $cursor = $null
    [Microsoft.PowerShell.PSConsoleReadLine]::GetBufferState([ref]$line, [ref]$cursor)
    
    if ($line) {
      # Extract the first word (command name) from the line
      $firstWord = ($line -split '\s+')[0]
      if ($firstWord) {
        $corrected = _TacSend -Type 'correct' -Buffer $firstWord
        if ($corrected -and $corrected -ne $firstWord) {
          # Replace the first word with the corrected version
          $newLine = $line -replace "^$([regex]::Escape($firstWord))", $corrected
          [Microsoft.PowerShell.PSConsoleReadLine]::Replace(0, $line.Length, $newLine)
          Write-Host "\`n\`u{2713} autocorrected: $firstWord -> $corrected" -ForegroundColor Green
        }
      }
    }
    
    # Execute the command
    [Microsoft.PowerShell.PSConsoleReadLine]::AcceptLine()
  }
}

# Record executed commands + show next-command prediction via prompt hook
$null = New-Variable -Name _TacOriginalPrompt -Value (Get-Item Function:\prompt -ErrorAction SilentlyContinue).ScriptBlock -Scope Global -Force -ErrorAction SilentlyContinue
function global:prompt {
  $lastId = (Get-History -Count 1 -ErrorAction SilentlyContinue).Id
  if ($null -ne $lastId -and $lastId -ne $global:_TacLastRecordedId) {
    $global:_TacLastRecordedId = $lastId
    $lastCmd = (Get-History -Id $lastId -ErrorAction SilentlyContinue).CommandLine
    if ($lastCmd) { _TacSend -Type 'record' -Buffer $lastCmd | Out-Null }
  }
  $prediction = _TacSend -Type 'suggest' -Buffer ''
  if ($prediction) { Write-Host "  hint: $prediction" -ForegroundColor DarkGray }
  if ($null -ne $global:_TacOriginalPrompt) {
    & $global:_TacOriginalPrompt
  } else {
    "PS $($executionContext.SessionState.Path.CurrentLocation)$('>' * ($nestedPromptLevel + 1)) "
  }
}
`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get the shell hook snippet for the given shell.
 *
 * @param shell - "bash", "zsh", or "powershell"
 * @returns The shell hook snippet as a string
 * @throws {Error} if the shell is not supported
 */
export function getShellHook(shell: "bash" | "zsh" | "powershell"): string {
  switch (shell) {
    case "zsh":
      return getZshHook();
    case "bash":
      return getBashHook();
    case "powershell":
      return getPowerShellHook();
    default: {
      const _exhaustive: never = shell;
      void _exhaustive;
      throw new Error(`Unsupported shell: ${String(shell)}. Supported shells: bash, zsh, powershell`);
    }
  }
}
