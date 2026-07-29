import { NextRequest, NextResponse } from 'next/server'
import { liveDashboardHasData } from '@/lib/dashboard-session'
import { readLiveSessionManifest, writeLiveSessionManifest } from '@/lib/live-session-server'
import { loadTradesSnapshotData } from '@/lib/trades-snapshot-server'

/** GET /api/dashboard-session/live — current live session info */
export async function GET() {
  try {
    const [{ trades, updatedAt }, liveSession] = await Promise.all([
      loadTradesSnapshotData(),
      readLiveSessionManifest(),
    ])

    return NextResponse.json({
      tradeCount: trades.length,
      updatedAt,
      hasData: liveDashboardHasData(),
      liveSession,
    })
  } catch (error) {
    console.error('Failed to read live session:', error)
    return NextResponse.json({ error: 'Failed to read live session' }, { status: 500 })
  }
}

/** PATCH /api/dashboard-session/live — update import label etc. */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    const liveSession = await writeLiveSessionManifest({
      lastImportFile:
        typeof body.lastImportFile === 'string' ? body.lastImportFile : undefined,
      label: typeof body.label === 'string' ? body.label : undefined,
    })
    return NextResponse.json({ ok: true, liveSession })
  } catch (error) {
    console.error('Failed to update live session:', error)
    return NextResponse.json({ error: 'Failed to update live session' }, { status: 500 })
  }
}
