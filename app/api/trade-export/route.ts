import { NextRequest, NextResponse } from 'next/server'
import { archiveExists } from '@/lib/dashboard-archive'
import {
  loadTradeExportContextFromArchive,
  writeTradeExportFile,
} from '@/lib/trade-export-server'
import { saveTradesSnapshot } from '@/lib/trades-snapshot-server'
import type { Trade } from '@/utils/logParser'

/** POST /api/trade-export — write trades to Sierra Chart export + sync snapshot to GitHub */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { trades, archiveTitle } = body as { trades?: Trade[]; archiveTitle?: string }

    if (!Array.isArray(trades)) {
      return NextResponse.json({ error: 'trades array is required' }, { status: 400 })
    }

    const archive = typeof archiveTitle === 'string' ? archiveTitle.trim() : ''
    if (archive) {
      if (!archiveExists(archive)) {
        return NextResponse.json({ error: 'Archive not found' }, { status: 404 })
      }

      const { filePath, tradeCount } = await writeTradeExportFile(trades, {
        context: await loadTradeExportContextFromArchive(archive),
      })

      return NextResponse.json({
        success: true,
        path: filePath,
        tradeCount,
        syncedToGitHub: false,
        archiveTitle: archive,
      })
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
