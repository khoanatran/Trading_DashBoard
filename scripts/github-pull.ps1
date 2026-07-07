#Requires -Version 5.1
<#
  Pull latest dashboard data from GitHub (trades, journal, tags, media, notes).
  Run before launching on a second computer, or let launch-dashboard.ps1 do it automatically.

  Usage:
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/github-pull.ps1
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $ProjectRoot

function Find-Git {
  $candidates = @(
    $env:GIT_PATH,
    'C:\Program Files\Git\cmd\git.exe',
    'C:\Program Files\Git\bin\git.exe',
    'C:\Program Files (x86)\Git\cmd\git.exe'
  ) | Where-Object { $_ -and (Test-Path $_) }
  if ($candidates.Count -gt 0) { return $candidates[0] }
  $cmd = Get-Command git -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  return $null
}

$git = Find-Git
if (-not $git) {
  Write-Host 'Git not found — skipping pull. Install Git for Windows to enable sync.' -ForegroundColor Yellow
  exit 0
}

$remote = if ($env:GITHUB_BACKUP_REMOTE) { $env:GITHUB_BACKUP_REMOTE } else { 'https://github.com/khoanatran/Trading.git' }
$branch = if ($env:GITHUB_BACKUP_BRANCH) { $env:GITHUB_BACKUP_BRANCH } else { 'main' }

if (-not (Test-Path '.git')) {
  Write-Host 'No git repo — run npm run github:setup first.' -ForegroundColor Yellow
  exit 0
}

$gitName = if ($env:GITHUB_BACKUP_USER_NAME) { $env:GITHUB_BACKUP_USER_NAME } else { 'khoanatran' }
$gitEmail = if ($env:GITHUB_BACKUP_USER_EMAIL) { $env:GITHUB_BACKUP_USER_EMAIL } else { 'khoanatran@users.noreply.github.com' }
& $git config user.name $gitName
& $git config user.email $gitEmail

$remotes = & $git remote 2>$null
if ($remotes -notcontains 'origin') {
  & $git remote add origin $remote
} else {
  & $git remote set-url origin $remote
}

Write-Host "Fetching from $remote ($branch)..." -ForegroundColor Cyan
& $git fetch origin $branch

$behindRaw = & $git rev-list --count "HEAD..origin/$branch" 2>$null
$behind = 0
if ($behindRaw) { [void][int]::TryParse($behindRaw.Trim(), [ref]$behind) }

if ($behind -eq 0) {
  Write-Host 'Already up to date.' -ForegroundColor Green
  exit 0
}

$status = & $git status --porcelain
if ($status) {
  $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
  Write-Host 'Committing local changes before pull...' -ForegroundColor Yellow
  & $git add -A
  & $git commit -m "Dashboard local changes before pull ($stamp)"
}

Write-Host "Pulling $behind commit(s)..." -ForegroundColor Cyan
& $git pull --rebase origin $branch
Write-Host 'Pull complete. Dashboard data is up to date.' -ForegroundColor Green
