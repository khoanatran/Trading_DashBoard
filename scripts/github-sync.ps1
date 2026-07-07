#Requires -Version 5.1
<#
  Full round-trip sync: merge pull + MT5 import + push.
  Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/github-sync.ps1
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
& (Join-Path $ScriptDir 'github-full-sync.ps1')
