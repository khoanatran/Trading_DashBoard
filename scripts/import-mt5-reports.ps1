#Requires -Version 5.1
<#
  Merge ReportHistory-*.xlsx trades into data/trades-snapshot.json
  Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/import-mt5-reports.ps1
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$NodeDir = 'C:\Program Files\nodejs'
$env:Path = "$NodeDir;$env:Path"

Push-Location $ProjectRoot
try {
  npx --yes tsx scripts/import-mt5-reports.ts
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

  $backup = Join-Path $ProjectRoot 'scripts\github-backup.ps1'
  if (Test-Path $backup) {
    & powershell -NoProfile -ExecutionPolicy Bypass -File $backup
  }
} finally {
  Pop-Location
}
