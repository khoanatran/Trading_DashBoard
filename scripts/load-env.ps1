#Requires -Version 5.1
<#
  Load .env.local into the current PowerShell session.
#>
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $ProjectRoot '.env.local'
if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*([^#=]+)=(.*)$') {
      $name = $matches[1].Trim()
      $value = $matches[2].Trim()
      if ($name) { Set-Item -Path "env:$name" -Value $value }
    }
  }
}
