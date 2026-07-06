# Creates "Trading Dashboard" shortcut on the Desktop (and Start Menu).
$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$BatLauncher = Join-Path $PSScriptRoot 'Launch-Trading-Dashboard.bat'
$ShortcutName = 'Trading Dashboard.lnk'

$IconLocation = "$env:SystemRoot\System32\imageres.dll,96"

function New-DashboardShortcut {
  param([string]$Folder)

  if (-not (Test-Path $Folder)) {
    New-Item -ItemType Directory -Path $Folder -Force | Out-Null
  }

  $path = Join-Path $Folder $ShortcutName
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($path)
  # cmd.exe /c is more reliable than targeting .bat directly from Desktop shortcuts
  $shortcut.TargetPath = "$env:SystemRoot\System32\cmd.exe"
  $shortcut.Arguments = "/c `"$BatLauncher`""
  $shortcut.WorkingDirectory = $ProjectRoot
  $shortcut.Description = 'Start trading dashboard at http://localhost:3000/'
  $shortcut.IconLocation = $IconLocation
  $shortcut.WindowStyle = 1
  $shortcut.Save()
  Write-Host "Created: $path"
}

$desktop = [Environment]::GetFolderPath('Desktop')
$startMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'

New-DashboardShortcut -Folder $desktop
New-DashboardShortcut -Folder $startMenu

Write-Host ''
Write-Host 'Double-click "Trading Dashboard" on your Desktop to launch the app.'
Write-Host "Desktop folder: $desktop"
