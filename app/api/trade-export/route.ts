import { NextRequest, NextResponse } from 'next/server'
import { writeTradeExportFile } from '@/lib/trade-export-server'
import { saveTradesSnapshot } from '@/lib/trades-snapshot-server'
import type { Trade } from '@/utils/logParser'

/** POST /api/trade-export — write trades to Sierra Chart export + sync snapshot to GitHub */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { trades } = body as { trades?: Trade[] }

    if (!Array.isArray(trades)) {
      return NextResponse.json({ error: 'trades array is required' }, { status: 400 })
    }

    const { filePath, tradeCount } = await writeTradeExportFile(trades)
    const { updatedAt } = await saveTradesSnapshot(trades)

    return NextResponse.json({
      success: true,
      path: filePath,
      tradeCount,
      syncedToGitHub: true,
      updatedAt,
    })
  } catch (error) {
    console.error('Failed to write trade export:', error)
    return NextResponse.json({ error: 'Failed to write trade export' }, { status: 500 })
  }
}
