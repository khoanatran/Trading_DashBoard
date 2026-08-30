import { NextResponse } from 'next/server'
import { archiveExists, deleteDashboardArchive, loadDashboardArchive } from '@/lib/dashboard-archive'
import { runGitHubBackup } from '@/lib/github-backup-server'

export const dynamic = 'force-dynamic'

/** GET /api/dashboard-archives/[slug] — load archive trades + metadata */
export async function GET(
  _request: Request,
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

/** DELETE /api/dashboard-archives/[slug] — permanently remove a saved archive */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ slug: string }> }
) {
  const { slug } = await context.params
  const title = decodeURIComponent(slug)

  if (!archiveExists(title)) {
    return NextResponse.json({ error: 'Archive not found' }, { status: 404 })
  }

  try {
    await deleteDashboardArchive(title)
    void runGitHubBackup(`deleted archive: ${title}`)
    return NextResponse.json({ ok: true, title })
  } catch (error) {
    console.error('Failed to delete dashboard archive:', error)
    const message = error instanceof Error ? error.message : 'Failed to delete archive'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
