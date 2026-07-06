import { NextRequest, NextResponse } from 'next/server'
import { writeTradeExportFile } from '@/lib/trade-export-server'
import type { Trade } from '@/utils/logParser'

/** POST /api/trade-export — write all trades to C:\SierraChart\Trade History for SC\trade-export-ET.txt */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { trades } = body as { trades?: Trade[] }

    if (!Array.isArray(trades)) {
      return NextResponse.json({ error: 'trades array is required' }, { status: 400 })
    }

    const { filePath, tradeCount } = await writeTradeExportFile(trades)

    return NextResponse.json({
      success: true,
      path: filePath,
      tradeCount,
    })
  } catch (error) {
    console.error('Failed to write trade export:', error)
    return NextResponse.json({ error: 'Failed to write trade export' }, { status: 500 })
  }
}
