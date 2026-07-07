#Requires -Version 5.1
<#
  Manual GitHub backup (same logic as dashboard auto-sync).
  Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/github-backup.ps1
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $ProjectRoot

function Find-Git {
  $candidates = @(
    $env:GIT_PATH,
    'C:\Program Files\Git\cmd\git.exe',
    'C:\Program Files\Git\bin\git.exe'
  ) | Where-Object { $_ -and (Test-Path $_) }
  if ($candidates.Count -gt 0) { return $candidates[0] }
  $cmd = Get-Command git -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  return $null
}

$git = Find-Git
if (-not $git) {
  Write-Error 'Git not found. Install Git for Windows or set GIT_PATH.'
}

$remote = if ($env:GITHUB_BACKUP_REMOTE) { $env:GITHUB_BACKUP_REMOTE } else { 'https://github.com/khoanatran/Trading_DashBoard.git' }
$branch = if ($env:GITHUB_BACKUP_BRANCH) { $env:GITHUB_BACKUP_BRANCH } else { 'main' }

if (-not (Test-Path '.git')) {
  & $git init
  & $git branch -M $branch
  if ((& $git remote) -notcontains 'origin') {
    & $git remote add origin $remote
  }
}

$gitName = if ($env:GITHUB_BACKUP_USER_NAME) { $env:GITHUB_BACKUP_USER_NAME } else { 'khoanatran' }
$gitEmail = if ($env:GITHUB_BACKUP_USER_EMAIL) { $env:GITHUB_BACKUP_USER_EMAIL } else { 'khoanatran@users.noreply.github.com' }
& $git config user.name $gitName
& $git config user.email $gitEmail

& $git add -A
$status = & $git status --porcelain
if ($status) {
  $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
  & $git commit -m "Dashboard backup ($stamp)"
}

$aheadRaw = & $git rev-list --count "origin/$branch..HEAD" 2>$null
$ahead = 0
if ($aheadRaw) { [void][int]::TryParse($aheadRaw.Trim(), [ref]$ahead) }

if (-not $status -and $ahead -eq 0) {
  Write-Host 'Nothing to commit or push — already backed up.'
  exit 0
}

& $git push -u origin $branch
Write-Host 'Pushed to GitHub.'
