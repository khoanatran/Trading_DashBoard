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
$DebounceMs = 8000

function Write-Log {
  param([string]$Message)
  $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Message"
  Add-Content -Path $LogFile -Value $line -Encoding utf8
  Write-Host $line
}

function Invoke-Backup {
  param([string]$Reason)
  Write-Log "Change detected ($Reason) — running backup..."
  try {
    & powershell -NoProfile -ExecutionPolicy Bypass -File $BackupScript 2>&1 | ForEach-Object { Write-Log $_ }
  } catch {
    Write-Log "Backup error: $_"
  }
}

if (-not (Test-Path $DataDir)) {
  New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
}

Write-Log "GitHub auto-sync started for $ProjectRoot"
Write-Log "Watching: $DataDir"

$timer = $null
$pendingReason = 'data change'

function Schedule-Backup {
  param([string]$Reason)
  $script:pendingReason = $Reason
  if ($script:timer) {
    $script:timer.Stop()
    $script:timer.Dispose()
  }
  $script:timer = New-Object System.Timers.Timer
  $script:timer.Interval = $DebounceMs
  $script:timer.AutoReset = $false
  Register-ObjectEvent -InputObject $script:timer -EventName Elapsed -Action {
    Invoke-Backup -Reason $using:pendingReason
  } | Out-Null
  $script:timer.Start()
}

$watcher = New-Object System.IO.FileSystemWatcher
$watcher.Path = $DataDir
$watcher.IncludeSubdirectories = $true
$watcher.EnableRaisingEvents = $true
$watcher.NotifyFilter = [IO.NotifyFilters]'FileName, LastWrite, Size, CreationTime'

Register-ObjectEvent -InputObject $watcher -EventName Changed -Action {
  Schedule-Backup -Reason $Event.SourceEventArgs.Name
} | Out-Null

Register-ObjectEvent -InputObject $watcher -EventName Created -Action {
  Schedule-Backup -Reason $Event.SourceEventArgs.Name
} | Out-Null

Register-ObjectEvent -InputObject $watcher -EventName Deleted -Action {
  Schedule-Backup -Reason $Event.SourceEventArgs.Name
} | Out-Null

Register-ObjectEvent -InputObject $watcher -EventName Renamed -Action {
  Schedule-Backup -Reason $Event.SourceEventArgs.Name
} | Out-Null

Write-Log "Watcher active (debounce ${DebounceMs}ms). Press Ctrl+C to stop."

try {
  while ($true) { Start-Sleep -Seconds 3600 }
} finally {
  $watcher.EnableRaisingEvents = $false
  $watcher.Dispose()
  Write-Log 'GitHub auto-sync stopped.'
}
