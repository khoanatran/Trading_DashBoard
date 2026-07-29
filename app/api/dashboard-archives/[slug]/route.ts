import { NextRequest, NextResponse } from 'next/server'
import { archiveExists, loadDashboardArchive } from '@/lib/dashboard-archive'

/** GET /api/dashboard-archives/[slug] — load archive trades + metadata */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ slug: string }> }
) {
  const { slug } = await context.params
  const title = decodeURIComponent(slug)

  if (!archiveExists(title)) {
    return NextResponse.json({ error: 'Archive not found' }, { status: 404 })
  }

  try {
    const bundle = await loadDashboardArchive(title)
    return NextResponse.json({
      title: bundle.manifest.title,
      manifest: bundle.manifest,
      trades: bundle.trades,
      tradeJournal: bundle.tradeJournal,
      tradeTags: bundle.tradeTags,
      flags: bundle.flags,
    })
  } catch (error) {
    console.error('Failed to load dashboard archive:', error)
    return NextResponse.json({ error: 'Failed to load archive' }, { status: 500 })
  }
}
