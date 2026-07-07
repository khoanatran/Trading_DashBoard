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

const GIT_CANDIDATES = [
  process.env.GIT_PATH,
  'git',
  'C:\\Program Files\\Git\\cmd\\git.exe',
  'C:\\Program Files\\Git\\bin\\git.exe',
  'C:\\Program Files (x86)\\Git\\cmd\\git.exe',
].filter((value): value is string => Boolean(value))

export interface GitHubPullResult {
  ok: boolean
  message: string
  at: string
  pulled: boolean
  behindCount: number
  changedFiles: string[]
  dataChanged: boolean
}

let cachedGit: string | null | undefined
let pullInFlight = false
let lastPullResult: GitHubPullResult | null = null

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

async function ensureRepository(git: string): Promise<void> {
  const gitDir = path.join(REPO_ROOT, '.git')
  if (!fs.existsSync(gitDir)) {
    throw new Error('Not a git repository')
  }

  const remotes = await runGit(git, ['remote'], { allowFailure: true })
  if (!remotes.stdout.split('\n').map(line => line.trim()).includes('origin')) {
    await runGit(git, ['remote', 'add', 'origin', REMOTE_URL])
  } else {
    await runGit(git, ['remote', 'set-url', 'origin', REMOTE_URL])
  }
}

function parseChangedFiles(stdout: string): string[] {
  return stdout
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
}

function hasDataChanges(files: string[]): boolean {
  return files.some(file => file.replace(/\\/g, '/').startsWith('data/'))
}

export function getGitHubPullStatus(): {
  enabled: boolean
  gitAvailable: boolean
  gitPath: string | null
  remoteUrl: string
  branch: string
  lastResult: GitHubPullResult | null
  inFlight: boolean
} {
  const gitPath = resolveGitExecutable()
  return {
    enabled: ENABLED,
    gitAvailable: gitPath !== null,
    gitPath,
    remoteUrl: REMOTE_URL,
    branch: BRANCH,
    lastResult: lastPullResult,
    inFlight: pullInFlight,
  }
}

/**
 * Pull only data/ from GitHub (matches scripts/github-pull.ps1).
 * Avoids full-repo pull + stash/pop, which could revert freshly synced trades.
 */
export async function runGitHubPull(): Promise<GitHubPullResult> {
  const at = new Date().toISOString()

  if (!ENABLED) {
    const result: GitHubPullResult = {
      ok: false,
      message: 'GitHub sync is disabled (GITHUB_BACKUP_ENABLED=false)',
      at,
      pulled: false,
      behindCount: 0,
      changedFiles: [],
      dataChanged: false,
    }
    lastPullResult = result
    return result
  }

  const git = resolveGitExecutable()
  if (!git) {
    const result: GitHubPullResult = {
      ok: false,
      message: 'Git executable not found. Install Git for Windows or set GIT_PATH in .env.local',
      at,
      pulled: false,
      behindCount: 0,
      changedFiles: [],
      dataChanged: false,
    }
    lastPullResult = result
    return result
  }

  if (pullInFlight) {
    return (
      lastPullResult ?? {
        ok: true,
        message: 'Pull already in progress',
        at,
        pulled: false,
        behindCount: 0,
        changedFiles: [],
        dataChanged: false,
      }
    )
  }

  pullInFlight = true

  try {
    await ensureRepository(git)

    const rebaseMerge = path.join(REPO_ROOT, '.git', 'rebase-merge')
    const rebaseApply = path.join(REPO_ROOT, '.git', 'rebase-apply')
    if (fs.existsSync(rebaseMerge) || fs.existsSync(rebaseApply)) {
      await runGit(git, ['rebase', '--abort'], { allowFailure: true })
    }

    await runGit(git, ['fetch', 'origin', BRANCH])

    const remoteRef = `origin/${BRANCH}`

    const dataStatus = await runGit(git, ['status', '--porcelain', '--', 'data/'], {
      allowFailure: true,
    })
    if (dataStatus.stdout.trim()) {
      const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19)
      await runGit(git, ['add', 'data/'])
      await runGit(git, ['commit', '-m', `Dashboard data before pull (${stamp})`], {
        allowFailure: true,
      })
    }

    const diff = await runGit(git, ['diff', '--name-only', 'HEAD', remoteRef, '--', 'data/'], {
      allowFailure: true,
    })
    const changedFiles = parseChangedFiles(diff.stdout)

    if (changedFiles.length === 0) {
      const result: GitHubPullResult = {
        ok: true,
        message: 'Dashboard data already up to date',
        at,
        pulled: false,
        behindCount: 0,
        changedFiles: [],
        dataChanged: false,
      }
      lastPullResult = result
      return result
    }

    await runGit(git, ['checkout', remoteRef, '--', 'data/'])
    await runGit(git, ['add', 'data/'])

    const behind = await runGit(git, ['rev-list', '--count', `HEAD..${remoteRef}`], {
      allowFailure: true,
    })
    const behindCount = Number.parseInt(behind.stdout.trim() || '0', 10) || 0

    const result: GitHubPullResult = {
      ok: true,
      message: `Updated ${changedFiles.length} data file(s) from GitHub`,
      at,
      pulled: true,
      behindCount,
      changedFiles,
      dataChanged: hasDataChanges(changedFiles),
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
      behindCount: 0,
      changedFiles: [],
      dataChanged: false,
    }
    lastPullResult = result
    return result
  } finally {
    pullInFlight = false
  }
}
