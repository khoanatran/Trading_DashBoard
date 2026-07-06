import { NextRequest, NextResponse } from 'next/server'
import { saveTradesSnapshot } from '@/lib/trades-snapshot-server'
import type { Trade } from '@/utils/logParser'

/** POST /api/trades-snapshot — persist current trades to data/trades-snapshot.json */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { trades } = body as { trades?: Trade[] }

    if (!Array.isArray(trades)) {
      return NextResponse.json({ error: 'trades array is required' }, { status: 400 })
    }

    const { tradeCount } = await saveTradesSnapshot(trades)
    return NextResponse.json({ success: true, tradeCount })
  } catch (error) {
    console.error('Failed to save trades snapshot:', error)
    return NextResponse.json({ error: 'Failed to save trades snapshot' }, { status: 500 })
  }
}
