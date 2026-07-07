import { NextResponse } from 'next/server'
import { importMt5ReportsIntoSnapshot } from '@/lib/mt5-snapshot-import'

/** POST /api/trades-snapshot/import-mt5 — merge ReportHistory-*.xlsx into trades-snapshot.json */
export async function POST() {
  try {
    const result = await importMt5ReportsIntoSnapshot()
    return NextResponse.json(result)
  } catch (error) {
    console.error('MT5 snapshot import failed:', error)
    return NextResponse.json({ error: 'MT5 snapshot import failed' }, { status: 500 })
  }
}
