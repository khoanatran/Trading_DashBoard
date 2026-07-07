import { execFile } from 'child_process'
import fs from 'fs'
import path from 'path'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

const REPO_ROOT = process.cwd()
const REMOTE_URL =
  process.env.GITHUB_BACKUP_REMOTE ?? 'https://github.com/khoanatran/Trading_DashBoard.git'
const BRANCH = process.env.GITHUB_BACKUP_BRANCH ?? 'main'
const ENABLED = process.env.GITHUB_BACKUP_ENABLED !== 'false'
const DEBOUNCE_MS = Number(process.env.GITHUB_BACKUP_DEBOUNCE_MS ?? 8000)

const GIT_CANDIDATES = [
  process.env.GIT_PATH,
  'git',
  'C:\\Program Files\\Git\\cmd\\git.exe',
  'C:\\Program Files\\Git\\bin\\git.exe',
  'C:\\Program Files (x86)\\Git\\cmd\\git.exe',
].filter((value): value is string => Boolean(value))

/** JSON + media paths synced to GitHub for cross-machine dashboard backup. */
export const GITHUB_SYNC_DATA_PATHS = [
  'data/trades-snapshot.json',
  'data/trade-journal.json',
  'data/trade-tags.json',
  'data/trade-images.json',
  'data/trade-videos.json',
  'data/daily-summaries.json',
  'data/daily-images.json',
  'data/weekly-notes.json',
  'data/flags.json',
  'data/trade-images/',
  'data/trade-videos/',
  'data/daily-images/',
] as const

export interface GitHubBackupStatus {
  enabled: boolean
  gitAvailable: boolean
  gitPath: string | null
  remoteUrl: string
  branch: string
  lastResult: GitHubBackupResult | null
  lastPullResult: GitHubPullResult | null
  pending: boolean
  inFlight: boolean
  pullInFlight: boolean
}

export interface GitHubBackupResult {
  ok: boolean
  message: string
  at: string
  committed: boolean
  pushed: boolean
}

export interface GitHubPullResult {
  ok: boolean
  message: string
  at: string
  pulled: boolean
  behind: number
}

export interface GitHubSyncResult {
  ok: boolean
  message: string
  at: string
  pull: GitHubPullResult
  push: GitHubBackupResult
}

let cachedGit: string | null | undefined
let pendingTimer: ReturnType<typeof setTimeout> | null = null
let backupInFlight = false
let pullInFlight = false
let lastResult: GitHubBackupResult | null = null
let lastPullResult: GitHubPullResult | null = null
let pendingReason: string | undefined

function resolveGitExecutable(): string | null {
  if (cachedGit !== undefined) return cachedGit

  for (const candidate of GIT_CANDIDATES) {
    if (candidate.includes('\\') || candidate.includes('/')) {
      if (fs.existsSync(candidate)) {
        cachedGit = candidate
        return candidate
      }
      continue
    }
    cachedGit = candidate
    return candidate
  }

  cachedGit = null
  return null
}

async function runGit(
  git: string,
  args: string[],
  options?: { allowFailure?: boolean }
): Promise<{ stdout: string; stderr: string }> {
  try {
    const result = await execFileAsync(git, args, {
      cwd: REPO_ROOT,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
    })
    return {
      stdout: result.stdout?.toString() ?? '',
      stderr: result.stderr?.toString() ?? '',
    }
  } catch (error) {
    if (options?.allowFailure && error && typeof error === 'object' && 'stdout' in error) {
      const err = error as { stdout?: Buffer; stderr?: Buffer }
      return {
        stdout: err.stdout?.toString() ?? '',
        stderr: err.stderr?.toString() ?? '',
      }
    }
    throw error
  }
}

async function ensureGitIdentity(git: string): Promise<void> {
  const name = process.env.GITHUB_BACKUP_USER_NAME ?? 'khoanatran'
  const email = process.env.GITHUB_BACKUP_USER_EMAIL ?? 'khoanatran@users.noreply.github.com'
  await runGit(git, ['config', 'user.name', name])
  await runGit(git, ['config', 'user.email', email])
}

async function ensureRepository(git: string): Promise<void> {
  const gitDir = path.join(REPO_ROOT, '.git')
  if (!fs.existsSync(gitDir)) {
    await runGit(git, ['init'])
    await runGit(git, ['branch', '-M', BRANCH])
  }

  await ensureGitIdentity(git)

  const remotes = await runGit(git, ['remote'], { allowFailure: true })
  if (!remotes.stdout.split('\n').map(line => line.trim()).includes('origin')) {
    await runGit(git, ['remote', 'add', 'origin', REMOTE_URL])
  } else {
    await runGit(git, ['remote', 'set-url', 'origin', REMOTE_URL])
  }
}

export function getGitHubBackupStatus(): GitHubBackupStatus {
  const gitPath = resolveGitExecutable()
  return {
    enabled: ENABLED,
    gitAvailable: gitPath !== null,
    gitPath,
    remoteUrl: REMOTE_URL,
    branch: BRANCH,
    lastResult,
    lastPullResult,
    pending: pendingTimer !== null,
    inFlight: backupInFlight,
    pullInFlight,
  }
}

export function scheduleGitHubBackup(reason?: string): void {
  if (!ENABLED) return

  pendingReason = reason ?? pendingReason
  if (pendingTimer) clearTimeout(pendingTimer)
  pendingTimer = setTimeout(() => {
    pendingTimer = null
    void runGitHubBackup(pendingReason)
    pendingReason = undefined
  }, DEBOUNCE_MS)
}

export async function runGitHubBackup(reason?: string): Promise<GitHubBackupResult> {
  if (!ENABLED) {
    const result: GitHubBackupResult = {
      ok: false,
      message: 'GitHub backup is disabled (GITHUB_BACKUP_ENABLED=false)',
      at: new Date().toISOString(),
      committed: false,
      pushed: false,
    }
    lastResult = result
    return result
  }

  const git = resolveGitExecutable()
  if (!git) {
    const result: GitHubBackupResult = {
      ok: false,
      message:
        'Git executable not found. Install Git for Windows or set GIT_PATH in .env.local',
      at: new Date().toISOString(),
      committed: false,
      pushed: false,
    }
    lastResult = result
    return result
  }

  if (backupInFlight) {
    scheduleGitHubBackup(reason)
    return (
      lastResult ?? {
        ok: true,
        message: 'Backup already running; rescheduled',
        at: new Date().toISOString(),
        committed: false,
        pushed: false,
      }
    )
  }

  backupInFlight = true
  const at = new Date().toISOString()

  try {
    await ensureRepository(git)
    await runGit(git, ['add', '-A'])

    const status = await runGit(git, ['status', '--porcelain'])
    if (!status.stdout.trim()) {
      const result: GitHubBackupResult = {
        ok: true,
        message: 'Nothing to commit',
        at,
        committed: false,
        pushed: false,
      }
      lastResult = result
      return result
    }

    const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19)
    const commitMessage = `Dashboard backup: ${reason ?? 'sync'} (${stamp})`
    await runGit(git, ['commit', '-m', commitMessage])

    try {
      await runGit(git, ['push', '-u', 'origin', BRANCH])
    } catch (pushError) {
      const message =
        pushError instanceof Error ? pushError.message : String(pushError)
      const result: GitHubBackupResult = {
        ok: false,
        message: `Committed locally but push failed: ${message}`,
        at,
        committed: true,
        pushed: false,
      }
      lastResult = result
      return result
    }

    const result: GitHubBackupResult = {
      ok: true,
      message: `Pushed to ${REMOTE_URL} (${BRANCH})`,
      at,
      committed: true,
      pushed: true,
    }
    lastResult = result
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const result: GitHubBackupResult = {
      ok: false,
      message,
      at,
      committed: false,
      pushed: false,
    }
    lastResult = result
    return result
  } finally {
    backupInFlight = false
  }
}

export async function runGitHubPull(): Promise<GitHubPullResult> {
  if (!ENABLED) {
    const result: GitHubPullResult = {
      ok: false,
      message: 'GitHub sync is disabled (GITHUB_BACKUP_ENABLED=false)',
      at: new Date().toISOString(),
      pulled: false,
      behind: 0,
    }
    lastPullResult = result
    return result
  }

  const git = resolveGitExecutable()
  if (!git) {
    const result: GitHubPullResult = {
      ok: false,
      message:
        'Git executable not found. Install Git for Windows or set GIT_PATH in .env.local',
      at: new Date().toISOString(),
      pulled: false,
      behind: 0,
    }
    lastPullResult = result
    return result
  }

  if (pullInFlight) {
    return (
      lastPullResult ?? {
        ok: true,
        message: 'Pull already running',
        at: new Date().toISOString(),
        pulled: false,
        behind: 0,
      }
    )
  }

  pullInFlight = true
  const at = new Date().toISOString()

  try {
    await ensureRepository(git)

    try {
      await runGit(git, ['fetch', 'origin', BRANCH])
    } catch (fetchError) {
      const message = fetchError instanceof Error ? fetchError.message : String(fetchError)
      const result: GitHubPullResult = {
        ok: false,
        message: `Fetch failed: ${message}`,
        at,
        pulled: false,
        behind: 0,
      }
      lastPullResult = result
      return result
    }

    const behindStatus = await runGit(
      git,
      ['rev-list', '--count', `HEAD..origin/${BRANCH}`],
      { allowFailure: true }
    )
    const behind = Number.parseInt(behindStatus.stdout.trim(), 10) || 0

    const dataStatus = await runGit(
      git,
      ['status', '--porcelain', '--', 'data/'],
      { allowFailure: true }
    )
    if (dataStatus.stdout.trim()) {
      const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19)
      await runGit(git, ['add', 'data/'])
      await runGit(git, ['commit', '-m', `Dashboard data before pull (${stamp})`], {
        allowFailure: true,
      })
    }

    const changedFiles = await runGit(
      git,
      ['diff', '--name-only', 'HEAD', `origin/${BRANCH}`, '--', 'data/'],
      { allowFailure: true }
    )

    if (!changedFiles.stdout.trim()) {
      const result: GitHubPullResult = {
        ok: true,
        message: 'Dashboard data already up to date',
        at,
        pulled: false,
        behind,
      }
      lastPullResult = result
      return result
    }

    try {
      await runGit(git, ['checkout', `origin/${BRANCH}`, '--', 'data/'])
      await runGit(git, ['add', 'data/'])
    } catch (pullError) {
      const message = pullError instanceof Error ? pullError.message : String(pullError)
      const result: GitHubPullResult = {
        ok: false,
        message: `Data pull failed: ${message}`,
        at,
        pulled: false,
        behind,
      }
      lastPullResult = result
      return result
    }

    const fileCount = changedFiles.stdout.trim().split('\n').filter(Boolean).length
    const result: GitHubPullResult = {
      ok: true,
      message: `Updated ${fileCount} data file(s) from ${REMOTE_URL} (${BRANCH})`,
      at,
      pulled: true,
      behind,
    }
    lastPullResult = result
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const result: GitHubPullResult = {
      ok: false,
      message,
      at,
      pulled: false,
      behind: 0,
    }
    lastPullResult = result
    return result
  } finally {
    pullInFlight = false
  }
}

/** Pull latest from GitHub, then push any local changes (full round-trip sync). */
export async function runGitHubSync(reason?: string): Promise<GitHubSyncResult> {
  const pull = await runGitHubPull()
  const push = await runGitHubBackup(reason ?? 'full sync')
  const at = new Date().toISOString()

  return {
    ok: pull.ok && push.ok,
    message: pull.ok && push.ok
      ? 'Sync complete (pull + push)'
      : `Sync incomplete — pull: ${pull.message}; push: ${push.message}`,
    at,
    pull,
    push,
  }
}
