import { NextResponse } from 'next/server'
import { runDashboardFullSync } from '@/lib/dashboard-sync-server'

/** GET /api/dashboard-sync — alias for status via github-sync */
export async function GET() {
  return NextResponse.json({ endpoint: 'dashboard-sync', method: 'POST to run full sync' })
}

/** POST /api/dashboard-sync — pull (merge) + MT5 import + push */
export async function POST() {
  try {
    const result = await runDashboardFullSync('browser launch sync')
    return NextResponse.json({ success: result.ok, result })
  } catch (error) {
    console.error('Dashboard sync failed:', error)
    return NextResponse.json({ error: 'Dashboard sync failed' }, { status: 500 })
  }
}
