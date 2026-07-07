import { fetchAndMergeFromGitHub, mergeRemoteDashboardData } from '@/lib/dashboard-data-merge'
import { importMt5ReportsIntoSnapshot } from '@/lib/mt5-snapshot-import'
import { runGitHubBackup } from '@/lib/github-backup-server'
import { resolveGitExecutable, ensureGitRepository, runGit, BRANCH } from '@/lib/git-repo'
import { setNotifySuppressed } from '@/lib/notify-data-changed'

export interface DashboardSyncResult {
  ok: boolean
  message: string
  at: string
  pulled: boolean
  pushed: boolean
  tradesAdded: number
  mt5Added: number
  tradeCount: number
  changedFiles: string[]
  mediaCopied: string[]
}

/** Full bidirectional sync: merge GitHub → local, import MT5, push local → GitHub. */
export async function runDashboardFullSync(reason?: string): Promise<DashboardSyncResult> {
  const at = new Date().toISOString()
  setNotifySuppressed(true)

  try {
    const git = resolveGitExecutable()
    if (!git) {
      return {
        ok: false,
        message: 'Git not found — install Git for Windows',
        at,
        pulled: false,
        pushed: false,
        tradesAdded: 0,
        mt5Added: 0,
        tradeCount: 0,
        changedFiles: [],
        mediaCopied: [],
      }
    }

    await ensureGitRepository(git)

    const rebaseMerge = `${process.cwd()}/.git/rebase-merge`
    const rebaseApply = `${process.cwd()}/.git/rebase-apply`
    const fs = await import('fs')
    if (fs.existsSync(rebaseMerge) || fs.existsSync(rebaseApply)) {
      await runGit(git, ['rebase', '--abort'], { allowFailure: true })
    }

    await runGit(git, ['fetch', 'origin', BRANCH])

    const mergeResult = await mergeRemoteDashboardData(git)
    const pulled = Boolean(mergeResult && mergeResult.changedFiles.length > 0)

    const mt5Result = await importMt5ReportsIntoSnapshot()
    const mt5Added = mt5Result.added

    setNotifySuppressed(false)
    const backup = await runGitHubBackup(reason ?? 'dashboard full sync')

    const changedFiles = [
      ...(mergeResult?.changedFiles ?? []),
      ...(mt5Added > 0 ? ['data/trades-snapshot.json'] : []),
    ]

    const tradeCount = mt5Result.total || mergeResult?.tradeCount || 0
    const tradesAdded = (mergeResult?.tradesAdded ?? 0) + mt5Added

    return {
      ok: backup.ok,
      message: buildSyncMessage(mergeResult, mt5Result, backup),
      at,
      pulled,
      pushed: backup.pushed,
      tradesAdded,
      mt5Added,
      tradeCount,
      changedFiles: [...new Set(changedFiles)],
      mediaCopied: mergeResult?.mediaCopied ?? [],
    }
  } catch (error) {
    setNotifySuppressed(false)
    const message = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      message,
      at,
      pulled: false,
      pushed: false,
      tradesAdded: 0,
      mt5Added: 0,
      tradeCount: 0,
      changedFiles: [],
      mediaCopied: [],
    }
  } finally {
    setNotifySuppressed(false)
  }
}

function buildSyncMessage(
  merge: Awaited<ReturnType<typeof fetchAndMergeFromGitHub>>,
  mt5: Awaited<ReturnType<typeof importMt5ReportsIntoSnapshot>>,
  backup: Awaited<ReturnType<typeof runGitHubBackup>>
): string {
  const parts: string[] = []
  if (merge && merge.changedFiles.length > 0) {
    parts.push(`merged ${merge.changedFiles.length} file(s) from GitHub`)
  }
  if (merge && merge.mediaCopied.length > 0) {
    parts.push(`copied ${merge.mediaCopied.length} media file(s)`)
  }
  if (mt5.added > 0) parts.push(`imported ${mt5.added} MT5 trade(s)`)
  if (backup.pushed) parts.push('pushed to GitHub')
  else if (backup.committed) parts.push('committed locally')
  else if (parts.length === 0) parts.push('already in sync')
  return parts.join('; ')
}
