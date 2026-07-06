import { NextRequest, NextResponse } from 'next/server'
import {
  getGitHubBackupStatus,
  runGitHubBackup,
  scheduleGitHubBackup,
} from '@/lib/github-backup-server'

/** GET /api/github-backup — backup status */
export async function GET() {
  return NextResponse.json(getGitHubBackupStatus())
}

/** POST /api/github-backup — run or schedule backup ({ immediate?: boolean, reason?: string }) */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const { immediate, reason } = body as { immediate?: boolean; reason?: string }

    if (immediate) {
      const result = await runGitHubBackup(reason ?? 'manual backup')
      return NextResponse.json({ success: result.ok, result, status: getGitHubBackupStatus() })
    }

    scheduleGitHubBackup(reason ?? 'manual schedule')
    return NextResponse.json({
      success: true,
      scheduled: true,
      status: getGitHubBackupStatus(),
    })
  } catch (error) {
    console.error('GitHub backup failed:', error)
    return NextResponse.json({ error: 'GitHub backup failed' }, { status: 500 })
  }
}
