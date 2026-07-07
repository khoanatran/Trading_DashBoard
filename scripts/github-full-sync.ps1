#Requires -Version 5.1
<#
  Full bidirectional sync: merge GitHub data, import MT5 reports, push to GitHub.
  Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/github-full-sync.ps1
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$NodeDir = 'C:\Program Files\nodejs'
$env:Path = "$NodeDir;C:\Program Files\Git\cmd;C:\Program Files\Git\bin;$env:Path"

. (Join-Path $ProjectRoot 'scripts\load-env.ps1')

Push-Location $ProjectRoot
try {
  Write-Host 'Syncing dashboard with GitHub...' -ForegroundColor Cyan
  npx --yes tsx scripts/dashboard-full-sync.ts
  exit $LASTEXITCODE
} finally {
  Pop-Location
}
