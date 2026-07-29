import { NextResponse } from 'next/server'
import { listDashboardArchives } from '@/lib/dashboard-archive'

/** GET /api/dashboard-archives — list archives in Road to $50M folder */
export async function GET() {
  try {
    const archives = await listDashboardArchives()
    return NextResponse.json({
      archives: archives.map(item => ({
        title: item.title,
        dateRange: item.manifest.dateRange,
        createdAt: item.manifest.createdAt,
        tradeCount: item.manifest.tradeCount,
        mediaFileCount: item.manifest.mediaFileCount,
      })),
    })
  } catch (error) {
    console.error('Failed to list dashboard archives:', error)
    return NextResponse.json({ error: 'Failed to list archives' }, { status: 500 })
  }
}
