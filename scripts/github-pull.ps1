#Requires -Version 5.1
<#
  Pull and merge dashboard data from GitHub (part of full sync).
  Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/github-pull.ps1
#>
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
& (Join-Path $ScriptDir 'github-full-sync.ps1')
