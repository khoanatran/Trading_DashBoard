#Requires -Version 5.1
<#
  One-time setup: initialize git repo and push full dashboard backup to GitHub.
  Repo: https://github.com/khoanatran/Trading_DashBoard

  Prerequisites:
  1. Git for Windows — https://git-scm.com/download/win
  2. GitHub auth — sign in once via Git Credential Manager, or use a PAT

  Usage:
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/setup-github-backup.ps1
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
  Write-Host 'Git not found. Install Git for Windows, then re-run this script.' -ForegroundColor Red
  Write-Host '  winget install --id Git.Git -e --source winget'
  exit 1
}

$remote = if ($env:GITHUB_BACKUP_REMOTE) { $env:GITHUB_BACKUP_REMOTE } else { 'https://github.com/khoanatran/Trading_DashBoard.git' }
$branch = if ($env:GITHUB_BACKUP_BRANCH) { $env:GITHUB_BACKUP_BRANCH } else { 'main' }

Write-Host "Using git: $git"
Write-Host "Remote:    $remote"
Write-Host "Branch:    $branch"
Write-Host "Project:   $ProjectRoot"
Write-Host ''

if (-not (Test-Path '.git')) {
  & $git init
  & $git branch -M $branch
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

& $git add -A
$status = & $git status --porcelain
if (-not $status) {
  Write-Host 'Working tree clean — nothing to commit.' -ForegroundColor Yellow
} else {
  $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
  & $git commit -m "Initial dashboard backup ($stamp)"
}

Write-Host 'Pushing to GitHub...'
& $git push -u origin $branch

Write-Host ''
Write-Host 'Done. The dashboard will auto-backup on trade/tag/media changes while it runs.' -ForegroundColor Green
Write-Host 'Manual backup: npm run github:backup'
