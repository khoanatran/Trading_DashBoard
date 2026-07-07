#Requires -Version 5.1
<#
  Pull latest dashboard DATA from GitHub (trades, journal, tags, media, notes).
  Uses a data-only strategy — never rebases source code, so launch cannot break the build.

  Usage:
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/github-pull.ps1
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'

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

function Test-RebaseInProgress {
  $rebaseMerge = Join-Path $ProjectRoot '.git\rebase-merge'
  $rebaseApply = Join-Path $ProjectRoot '.git\rebase-apply'
  return (Test-Path $rebaseMerge) -or (Test-Path $rebaseApply)
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

if (Test-RebaseInProgress) {
  Write-Host 'Aborting stuck git rebase from a previous failed pull...' -ForegroundColor Yellow
  & $git rebase --abort 2>$null
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

Write-Host "Fetching dashboard data from $remote ($branch)..." -ForegroundColor Cyan
& $git fetch origin $branch 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Host 'Fetch failed — continuing with local data.' -ForegroundColor Yellow
  exit 0
}

$remoteRef = "origin/$branch"

# Commit any local data changes first so they are not lost
$dataStatus = & $git status --porcelain -- data/ 2>$null
if ($dataStatus) {
  $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
  Write-Host 'Saving local dashboard data before pull...' -ForegroundColor Yellow
  & $git add data/ 2>$null
  & $git commit -m "Dashboard data before pull ($stamp)" 2>$null
}

# Pull only data/ from remote — avoids source-code merge conflicts on launch
$changedFiles = & $git diff --name-only HEAD $remoteRef -- data/ 2>$null
$fileList = @($changedFiles | Where-Object { $_.Trim() })
if ($fileList.Count -eq 0) {
  Write-Host 'Dashboard data already up to date.' -ForegroundColor Green
  exit 0
}

Write-Host "Updating $($fileList.Count) data file(s) from GitHub..." -ForegroundColor Cyan
& $git checkout $remoteRef -- data/ 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Host 'Data checkout failed — continuing with local data.' -ForegroundColor Yellow
  exit 0
}

# Stage updated data so the next auto-backup can push if needed
& $git add data/ 2>$null

Write-Host 'Dashboard data updated from GitHub.' -ForegroundColor Green
