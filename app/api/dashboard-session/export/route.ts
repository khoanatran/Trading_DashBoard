import { NextRequest, NextResponse } from 'next/server'
import { exportLiveDashboardSession, scheduleSessionBackgroundTasks } from '@/lib/dashboard-session'

export const maxDuration = 600
export const dynamic = 'force-dynamic'

/** POST /api/dashboard-session/export — export live data to Road to $50M + GitHub archives/ */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const title = String(body.title ?? '').trim()
    if (!title) {
      return NextResponse.json({ error: 'title is required' }, { status: 400 })
    }

    const exported = await exportLiveDashboardSession(title)
    scheduleSessionBackgroundTasks(exported, `exported live session: ${title}`, true)

    return NextResponse.json({
      ok: true,
      ...exported,
      github: {
        ok: true,
        message: 'Archive saved. Folder extract and GitHub sync running in background.',
        background: true,
      },
    })
  } catch (error) {
    console.error('Live session export failed:', error)
    const message = error instanceof Error ? error.message : 'Export failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
