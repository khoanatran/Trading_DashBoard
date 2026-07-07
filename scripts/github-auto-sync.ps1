#Requires -Version 5.1
<#
  Background file watcher: auto-commits and pushes dashboard data changes to GitHub.
  Watches data/ (trades, tags, notes, media metadata) even when the dashboard is not running.

  Usage:
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/github-auto-sync.ps1

  Install at logon:
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/setup-auto-sync-task.ps1
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'

$ProjectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$DataDir = Join-Path $ProjectRoot 'data'
$BackupScript = Join-Path $ProjectRoot 'scripts\github-backup.ps1'
$LogFile = Join-Path $ProjectRoot 'github-auto-sync.log'
$PollSeconds = 5
$DebounceMs = 8000

function Write-Log {
  param([string]$Message)
  $line = '[' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '] ' + $Message
  Add-Content -Path $LogFile -Value $line -Encoding utf8
  Write-Host $line
}

function Get-DataFingerprint {
  if (-not (Test-Path $DataDir)) { return '' }
  $parts = Get-ChildItem -Path $DataDir -Recurse -File -ErrorAction SilentlyContinue |
    Sort-Object FullName |
    ForEach-Object { $_.FullName + ':' + $_.LastWriteTimeUtc.Ticks + ':' + $_.Length }
  return ($parts -join '|')
}

function Invoke-Backup {
  param([string]$Reason)
  Write-Log ('Change detected (' + $Reason + ') - running backup...')
  try {
    $output = & powershell -NoProfile -ExecutionPolicy Bypass -File $BackupScript 2>&1
    foreach ($line in $output) { Write-Log ($line.ToString()) }
  } catch {
    Write-Log ('Backup error: ' + $_.Exception.Message)
  }
}

if (-not (Test-Path $DataDir)) {
  New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
}

Write-Log ('GitHub auto-sync started for ' + $ProjectRoot)
Write-Log ('Watching: ' + $DataDir)

$lastFingerprint = Get-DataFingerprint
$pendingAt = $null
$pendingReason = 'data change'

Write-Log ('Watcher active (poll ' + $PollSeconds + 's, debounce ' + $DebounceMs + 'ms). Press Ctrl+C to stop.')

try {
  while ($true) {
    Start-Sleep -Seconds $PollSeconds
    $currentFingerprint = Get-DataFingerprint
    if ($currentFingerprint -ne $lastFingerprint) {
      $lastFingerprint = $currentFingerprint
      $pendingAt = Get-Date
      $pendingReason = 'data change'
      Write-Log 'Pending backup scheduled...'
    }

    if ($pendingAt -and (((Get-Date) - $pendingAt).TotalMilliseconds -ge $DebounceMs)) {
      Invoke-Backup -Reason $pendingReason
      $pendingAt = $null
      $lastFingerprint = Get-DataFingerprint
    }
  }
} finally {
  Write-Log 'GitHub auto-sync stopped.'
}
