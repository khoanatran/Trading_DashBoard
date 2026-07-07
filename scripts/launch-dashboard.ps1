# Starts the production server (if needed) and opens the dashboard in the default browser.
param(
  [switch]$SkipBrowser
)

$ErrorActionPreference = 'Continue'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Port = 3000
$Url = "http://localhost:$Port/"
$NodeDir = 'C:\Program Files\nodejs'
$NpmCmd = Join-Path $NodeDir 'npm.cmd'
$NodeExe = Join-Path $NodeDir 'node.exe'
$LogFile = Join-Path $ProjectRoot 'dashboard-server.log'
$BuildIdFile = Join-Path $ProjectRoot '.next\BUILD_ID'
$LastServedBuildFile = Join-Path $ProjectRoot '.next\last-served-build-id'

function Write-Log {
  param([string]$Message)
  "[$((Get-Date).ToString('o'))] $Message" | Out-File -FilePath $LogFile -Append -Encoding utf8
}

function Test-ServerReady {
  try {
    $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
    return $r.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Ensure-NodeOnPath {
  if (-not (Test-Path $NodeExe)) {
    Write-Log "ERROR: Node.js not found at $NodeDir"
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show(
      "Node.js was not found at:`n$NodeDir`n`nInstall Node.js or fix the path in scripts\launch-dashboard.ps1",
      'Trading Dashboard',
      'OK',
      'Error'
    ) | Out-Null
    exit 1
  }
  $env:Path = "$NodeDir;$env:Path"
}

function Test-BuildStale {
  if (-not (Test-Path $BuildIdFile)) { return $true }
  $buildTime = (Get-Item $BuildIdFile).LastWriteTimeUtc
  $sourceRoots = @(
    (Join-Path $ProjectRoot 'app'),
    (Join-Path $ProjectRoot 'components'),
    (Join-Path $ProjectRoot 'lib'),
    (Join-Path $ProjectRoot 'utils'),
    (Join-Path $ProjectRoot 'hooks')
  )
  foreach ($root in $sourceRoots) {
    if (-not (Test-Path $root)) { continue }
    $newest = Get-ChildItem -Path $root -Recurse -Include '*.ts', '*.tsx' -File -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTimeUtc -Descending |
      Select-Object -First 1
    if ($newest -and $newest.LastWriteTimeUtc -gt $buildTime) {
      return $true
    }
  }
  return $false
}

function Test-BuildValid {
  return (
    (Test-Path $BuildIdFile) -and
    (Test-Path (Join-Path $ProjectRoot '.next\build-manifest.json')) -and
    (Test-Path (Join-Path $ProjectRoot '.next\prerender-manifest.json'))
  )
}

function Get-CurrentBuildId {
  if (-not (Test-Path $BuildIdFile)) { return '' }
  return (Get-Content $BuildIdFile -Raw).Trim()
}

function Get-LastServedBuildId {
  if (-not (Test-Path $LastServedBuildFile)) { return '' }
  return (Get-Content $LastServedBuildFile -Raw).Trim()
}

function Set-LastServedBuildId {
  param([string]$BuildId)
  if (-not $BuildId) { return }
  Set-Content -Path $LastServedBuildFile -Value $BuildId -Encoding utf8 -NoNewline
}

function Stop-DashboardServer {
  Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue |
    ForEach-Object {
      Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
    }
  Start-Sleep -Seconds 1
}

function Ensure-Build {
  if ((Test-BuildValid) -and -not (Test-BuildStale)) {
    Write-Log 'Using existing production build (.next)'
    return @{ ok = $true; rebuilt = $false }
  }

  if (Test-BuildStale) {
    Write-Log 'Source changed since last build - rebuilding...'
  } elseif (-not (Test-BuildValid)) {
    Write-Log 'Production build missing or incomplete - rebuilding...'
  }

  if (-not (Test-Path $NpmCmd)) {
    Write-Log "ERROR: npm.cmd not found at $NpmCmd"
    return @{ ok = $false; rebuilt = $false }
  }

  Write-Log 'Building dashboard (first launch may take 1-2 minutes)...'
  Write-Host 'Building production bundle (please wait)...' -ForegroundColor Yellow
  Push-Location $ProjectRoot
  try {
    & $NpmCmd run build 2>&1 | Tee-Object -FilePath $LogFile -Append
    if ($LASTEXITCODE -ne 0 -or -not (Test-BuildValid)) {
      Write-Log "ERROR: Build failed (exit $LASTEXITCODE)"
      return @{ ok = $false; rebuilt = $false }
    }
    Write-Log 'Build completed'
    return @{ ok = $true; rebuilt = $true }
  } catch {
    Write-Log "ERROR: Build exception: $_"
    return @{ ok = $false; rebuilt = $false }
  } finally {
    Pop-Location
  }
}

function Start-DashboardServer {
  if (-not (Test-Path $NpmCmd)) {
    Write-Log "ERROR: npm.cmd not found at $NpmCmd"
    return $false
  }

  Write-Log 'Starting Next.js server...'
  try {
    $proc = Start-Process -FilePath $NpmCmd `
      -ArgumentList @('run', 'start', '--', '-p', "$Port") `
      -WorkingDirectory $ProjectRoot `
      -WindowStyle Minimized `
      -PassThru
    Write-Log "Started Next.js via npm (PID $($proc.Id))"
    return $true
  } catch {
    Write-Log "ERROR: Failed to start server: $_"
    return $false
  }
}

function Wait-ForServer {
  param([int]$TimeoutSeconds = 90)
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-ServerReady) { return $true }
    Start-Sleep -Milliseconds 500
  }
  return $false
}

function Show-Error {
  param([string]$Message)
  Write-Log "ERROR: $Message"
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.MessageBox]::Show(
    "$Message`n`nSee dashboard-server.log in the project folder.",
    'Trading Dashboard',
    'OK',
    'Error'
  ) | Out-Null
}

function Show-ServerTimeoutError {
  Show-Error ('The server did not respond on ' + $Url + ' within 90 seconds.')
}

function Open-DashboardBrowser {
  if ($SkipBrowser) { return }
  try {
    Start-Process $Url -ErrorAction Stop
  } catch {
    Write-Log "Start-Process browser failed: $_ - trying cmd start"
    Start-Process -FilePath 'cmd.exe' -ArgumentList @('/c', 'start', '', $Url) -WindowStyle Hidden
  }
}

function Sync-DashboardWithGitHub {
  $syncOnLaunch = $env:GITHUB_SYNC_PULL_ON_LAUNCH
  if ($syncOnLaunch -eq 'false') {
    Write-Log 'Dashboard sync on launch disabled (GITHUB_SYNC_PULL_ON_LAUNCH=false)'
    return
  }

  $syncScript = Join-Path $ProjectRoot 'scripts\github-full-sync.ps1'
  if (-not (Test-Path $syncScript)) {
    Write-Log 'github-full-sync.ps1 not found — skipping sync'
    return
  }

  Write-Host 'Syncing trades, media, tags, and notes with GitHub...' -ForegroundColor Cyan
  Write-Log 'Running github-full-sync.ps1'
  try {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $syncScript 2>&1 | ForEach-Object {
      Write-Log "sync: $_"
      Write-Host $_
    }
  } catch {
    Write-Log "Dashboard sync failed (continuing with local data): $_"
    Write-Host 'Dashboard sync failed — using local data.' -ForegroundColor Yellow
  }
}

Ensure-NodeOnPath
Write-Log 'Launcher started'
Write-Host 'Trading Dashboard launcher...' -ForegroundColor Cyan

Sync-DashboardWithGitHub

$buildResult = Ensure-Build
if (-not $buildResult.ok) {
  Show-Error 'The dashboard could not be built. Run npm run build from the project folder to see details.'
  exit 1
}

$currentBuildId = Get-CurrentBuildId
$lastServedBuildId = Get-LastServedBuildId
$buildChanged = $currentBuildId -and ($currentBuildId -ne $lastServedBuildId)
$mustRestart = $buildResult.rebuilt -or $buildChanged

if (Test-ServerReady) {
  if ($mustRestart) {
    Write-Log ('Build changed - restarting server (was: ' + $lastServedBuildId + ', now: ' + $currentBuildId + ')')
    Stop-DashboardServer
    if (-not (Start-DashboardServer)) {
      Show-Error 'The dashboard server could not be restarted after a new build.'
      exit 1
    }
    if (-not (Wait-ForServer -TimeoutSeconds 90)) {
      Show-ServerTimeoutError
      exit 1
    }
    Set-LastServedBuildId $currentBuildId
    Write-Host "Server ready." -ForegroundColor Green
    Open-DashboardBrowser
  } else {
    Write-Log 'Server already running (current build)'
    Write-Host "Server already running - opening browser." -ForegroundColor Green
    Open-DashboardBrowser
  }
  exit 0
}

if (-not (Start-DashboardServer)) {
  Show-Error 'The dashboard server could not be started.'
  exit 1
}

Write-Host 'Waiting for server on port 3000...' -ForegroundColor Yellow
if (-not (Wait-ForServer -TimeoutSeconds 90)) {
  Show-ServerTimeoutError
  exit 1
}

Set-LastServedBuildId $currentBuildId
Write-Log 'Server ready'
Write-Host "Server ready." -ForegroundColor Green
Open-DashboardBrowser
exit 0
