#Requires -Version 5.1
<#
  Full round-trip sync: pull latest from GitHub, then push any local changes.
  Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/github-sync.ps1
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
& (Join-Path $ScriptDir 'github-pull.ps1')
& (Join-Path $ScriptDir 'github-backup.ps1')
