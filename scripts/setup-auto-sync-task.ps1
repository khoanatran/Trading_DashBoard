#Requires -Version 5.1
<#
  Register a Windows Scheduled Task to run GitHub auto-sync at user logon.
  Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/setup-auto-sync-task.ps1
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$SyncScript = Join-Path $ProjectRoot 'scripts\github-auto-sync.ps1'
$TaskName = 'Omen Trading GitHub Auto-Sync'

$action = New-ScheduledTaskAction `
  -Execute 'powershell.exe' `
  -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$SyncScript`"" `
  -WorkingDirectory $ProjectRoot

$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Description 'Auto-commits and pushes Trading Dashboard data changes to GitHub' `
  -Force | Out-Null

Write-Host "Scheduled task registered: $TaskName" -ForegroundColor Green
Write-Host 'Auto-sync will start at next logon. To start now, run:'
Write-Host "  powershell -NoProfile -ExecutionPolicy Bypass -File `"$SyncScript`""
