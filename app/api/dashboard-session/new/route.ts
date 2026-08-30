import { NextRequest, NextResponse } from 'next/server'
import { startNewLiveSession } from '@/lib/dashboard-session'

export const maxDuration = 600
export const dynamic = 'force-dynamic'

/** POST /api/dashboard-session/new — archive live data, clear live dashboard, push to GitHub */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const archiveTitle = String(body.archiveTitle ?? '').trim()
    if (!archiveTitle) {
      return NextResponse.json({ error: 'archiveTitle is required' }, { status: 400 })
    }

    const result = await startNewLiveSession(archiveTitle)

    return NextResponse.json({
      ok: true,
      title: result.title,
      folderPath: result.folderPath,
      zipPath: result.zipPath,
      manifest: result.manifest,
      liveSession: result.liveSession,
      github: result.github,
    })
  } catch (error) {
    console.error('New live session failed:', error)
    const message = error instanceof Error ? error.message : 'Failed to start new session'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
