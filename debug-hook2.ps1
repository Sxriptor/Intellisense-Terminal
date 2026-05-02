# Debug version to see what's happening with git comit
function _TacSend {
  param([string]$Type, [string]$Buffer)
  try {
    Write-Host "DEBUG: Calling tac --ipc $Type --buffer '$Buffer'" -ForegroundColor Cyan
    $result = & tac --ipc $Type --buffer $Buffer 2>$null
    Write-Host "DEBUG: Result = '$result'" -ForegroundColor Cyan
    if ($result -is [array]) { return ($result -join '') }
    return $result
  } catch {
    Write-Host "DEBUG: Exception in _TacSend: $_" -ForegroundColor Red
    return $null
  }
}

# Simple debug key handler
Set-PSReadLineKeyHandler -Key Enter -ScriptBlock {
  $line = $null
  $cursor = $null
  [Microsoft.PowerShell.PSConsoleReadLine]::GetBufferState([ref]$line, [ref]$cursor)
  
  Write-Host "DEBUG: Captured line = '$line'" -ForegroundColor Yellow
  
  if ($line -and $line.Trim()) {
    Write-Host "DEBUG: Trimmed line = '$($line.Trim())'" -ForegroundColor Yellow
    
    $corrected = _TacSend -Type 'correct' -Buffer $line.Trim()
    Write-Host "DEBUG: Corrected result = '$corrected'" -ForegroundColor Yellow
    
    if ($corrected -and $corrected -ne $line.Trim() -and $corrected.Trim()) {
      Write-Host "DEBUG: Applying correction!" -ForegroundColor Green
      [Microsoft.PowerShell.PSConsoleReadLine]::Replace(0, $line.Length, $corrected)
      Write-Host "Autocorrected: $($line.Trim()) -> $corrected" -ForegroundColor Green
    } else {
      Write-Host "DEBUG: No correction applied. corrected='$corrected', original='$($line.Trim())'" -ForegroundColor Red
    }
  } else {
    Write-Host "DEBUG: Empty or null line" -ForegroundColor Red
  }
  
  [Microsoft.PowerShell.PSConsoleReadLine]::AcceptLine()
}