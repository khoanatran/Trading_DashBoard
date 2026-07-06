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

export interface GitHubBackupStatus {
  enabled: boolean
  gitAvailable: boolean
  gitPath: string | null
  remoteUrl: string
  branch: string
  lastResult: GitHubBackupResult | null
  pending: boolean
  inFlight: boolean
}

export interface GitHubBackupResult {
  ok: boolean
  message: string
  at: string
  committed: boolean
  pushed: boolean
}

let cachedGit: string | null | undefined
let pendingTimer: ReturnType<typeof setTimeout> | null = null
let backupInFlight = false
let lastResult: GitHubBackupResult | null = null
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
    pending: pendingTimer !== null,
    inFlight: backupInFlight,
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
