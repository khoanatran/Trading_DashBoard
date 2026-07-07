import { execFile } from 'child_process'
import fs from 'fs'
import path from 'path'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

export const REPO_ROOT = process.cwd()
export const REMOTE_URL =
  process.env.GITHUB_BACKUP_REMOTE ?? 'https://github.com/khoanatran/Trading_DashBoard.git'
export const BRANCH = process.env.GITHUB_BACKUP_BRANCH ?? 'main'

const GIT_CANDIDATES = [
  process.env.GIT_PATH,
  'git',
  'C:\\Program Files\\Git\\cmd\\git.exe',
  'C:\\Program Files\\Git\\bin\\git.exe',
  'C:\\Program Files (x86)\\Git\\cmd\\git.exe',
].filter((value): value is string => Boolean(value))

let cachedGit: string | null | undefined

export function resolveGitExecutable(): string | null {
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

export async function runGit(
  git: string,
  args: string[],
  options?: { allowFailure?: boolean }
): Promise<{ stdout: string; stderr: string }> {
  try {
    const result = await execFileAsync(git, args, {
      cwd: REPO_ROOT,
      maxBuffer: 20 * 1024 * 1024,
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

export async function ensureGitRepository(git: string): Promise<void> {
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

  const name = process.env.GITHUB_BACKUP_USER_NAME ?? 'khoanatran'
  const email = process.env.GITHUB_BACKUP_USER_EMAIL ?? 'khoanatran@users.noreply.github.com'
  await runGit(git, ['config', 'user.name', name])
  await runGit(git, ['config', 'user.email', email])
}

export function remoteRef(): string {
  return `origin/${BRANCH}`
}

export async function readRemoteFile(
  git: string,
  filePath: string
): Promise<string | null> {
  const normalized = filePath.replace(/\\/g, '/')
  const result = await runGit(git, ['show', `${remoteRef()}:${normalized}`], {
    allowFailure: true,
  })
  const content = result.stdout
  return content.trim() ? content : null
}

export async function readRemoteBinaryFile(
  git: string,
  filePath: string
): Promise<Buffer | null> {
  const normalized = filePath.replace(/\\/g, '/')
  try {
    const result = await execFileAsync(git, ['show', `${remoteRef()}:${normalized}`], {
      cwd: REPO_ROOT,
      maxBuffer: 50 * 1024 * 1024,
      windowsHide: true,
      encoding: 'buffer',
    })
    const buf = result.stdout as Buffer
    return buf?.length ? buf : null
  } catch {
    return null
  }
}
export async function listRemoteFiles(
  git: string,
  dirPath: string
): Promise<string[]> {
  const normalized = dirPath.replace(/\\/g, '/').replace(/\/$/, '')
  const result = await runGit(
    git,
    ['ls-tree', '-r', '--name-only', remoteRef(), normalized],
    { allowFailure: true }
  )
  return result.stdout
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
}
