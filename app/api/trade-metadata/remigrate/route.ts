import { NextRequest, NextResponse } from 'next/server'
import { remigrateTradeMetadata } from '@/lib/trade-metadata-migration'
import type { Trade } from '@/utils/logParser'

/** POST /api/trade-metadata/remigrate — remap journal media/metadata to current trade ids */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { trades } = body as { trades?: Trade[] }

    if (!Array.isArray(trades)) {
      return NextResponse.json({ error: 'trades array is required' }, { status: 400 })
    }

    const result = await remigrateTradeMetadata(trades)
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    console.error('Failed to remigrate trade metadata:', error)
    return NextResponse.json({ error: 'Failed to remigrate trade metadata' }, { status: 500 })
  }
}
