import { NextRequest, NextResponse } from 'next/server'
import { exportLiveDashboardSession } from '@/lib/dashboard-session'
import { runGitHubBackup } from '@/lib/github-backup-server'

/** POST /api/dashboard-session/export — export live data to Road to $50M + GitHub archives/ */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const title = String(body.title ?? '').trim()
    if (!title) {
      return NextResponse.json({ error: 'title is required' }, { status: 400 })
    }

    const exported = await exportLiveDashboardSession(title)
    const github = await runGitHubBackup(`exported live session: ${title}`)

    return NextResponse.json({
      ok: true,
      ...exported,
      github,
    })
  } catch (error) {
    console.error('Live session export failed:', error)
    const message = error instanceof Error ? error.message : 'Export failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
