import { NextRequest, NextResponse } from 'next/server'
import {
  getGitHubBackupStatus,
  runGitHubPull,
  runGitHubBackup,
  runGitHubSync,
  scheduleGitHubBackup,
  GITHUB_SYNC_DATA_PATHS,
} from '@/lib/github-backup-server'

/** GET /api/github-sync — sync status and list of backed-up data paths */
export async function GET() {
  return NextResponse.json({
    status: getGitHubBackupStatus(),
    syncedPaths: GITHUB_SYNC_DATA_PATHS,
  })
}

/** POST /api/github-sync — pull, push, or full sync */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const { action, reason } = body as {
      action?: 'pull' | 'push' | 'sync' | 'schedule'
      reason?: string
    }

    switch (action) {
      case 'pull': {
        const result = await runGitHubPull()
        return NextResponse.json({
          success: result.ok,
          result,
          status: getGitHubBackupStatus(),
        })
      }
      case 'push': {
        const result = await runGitHubBackup(reason ?? 'manual push')
        return NextResponse.json({
          success: result.ok,
          result,
          status: getGitHubBackupStatus(),
        })
      }
      case 'sync': {
        const result = await runGitHubSync(reason ?? 'manual sync')
        return NextResponse.json({
          success: result.ok,
          result,
          status: getGitHubBackupStatus(),
        })
      }
      case 'schedule':
      default: {
        scheduleGitHubBackup(reason ?? 'manual schedule')
        return NextResponse.json({
          success: true,
          scheduled: true,
          status: getGitHubBackupStatus(),
        })
      }
    }
  } catch (error) {
    console.error('GitHub sync failed:', error)
    return NextResponse.json({ error: 'GitHub sync failed' }, { status: 500 })
  }
}
