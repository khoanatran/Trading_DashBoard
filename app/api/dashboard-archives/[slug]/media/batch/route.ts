import { NextRequest, NextResponse } from 'next/server'
import { archiveExists, loadDashboardArchive } from '@/lib/dashboard-archive'
import { normalizeTradeImageSection } from '@/lib/trade-images'

interface ImageData {
  name: string
  note?: string
  drawings?: unknown[]
  section?: string
}

interface VideoData {
  id: string
  originalName: string
  mp4FileName: string
  thumbFileName?: string
  durationSec?: number
  clipStartSec?: number
  clipEndSec?: number
  createdAt: string
}

function archiveFileUrl(slug: string, relPath: string): string {
  return `/api/dashboard-archives/${encodeURIComponent(slug)}/file?path=${encodeURIComponent(relPath)}`
}

/** POST /api/dashboard-archives/[slug]/media/batch */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> }
) {
  const { slug } = await context.params
  const title = decodeURIComponent(slug)

  if (!archiveExists(title)) {
    return NextResponse.json({ error: 'Archive not found' }, { status: 404 })
  }

  try {
    const body = await request.json()
    const { tradeIds } = body as { tradeIds: string[] }
    if (!tradeIds || !Array.isArray(tradeIds)) {
      return NextResponse.json({ error: 'tradeIds array is required' }, { status: 400 })
    }

    const bundle = await loadDashboardArchive(title)
    const imageMapping = bundle.tradeImages as Record<string, ImageData[]>
    const videoMapping = bundle.tradeVideos as Record<string, VideoData[]>
    const tagMapping = bundle.tradeTags
    const journalMapping = bundle.tradeJournal as Record<
      string,
      { note?: string; setupTags?: string[]; rating?: number; ratingManual?: boolean }
    >

    const images: Record<string, Array<{ name: string; url: string; note: string; drawings: unknown[]; section: string }>> = {}
    const videos: Record<string, Array<VideoData & { url: string; thumbUrl: string | null }>> = {}
    const tags: Record<string, string[]> = {}
    const journal: Record<string, { note: string; setupTags: string[]; rating: number; ratingManual?: boolean }> = {}

    for (const tradeId of tradeIds) {
      const tradeImages = imageMapping[tradeId] || []
      images[tradeId] = tradeImages.map(img => {
        const imgData = typeof img === 'string' ? { name: img } : img
        return {
          name: imgData.name,
          note: imgData.note || '',
          drawings: imgData.drawings || [],
          section: normalizeTradeImageSection(imgData.section),
          url: archiveFileUrl(title, `trade-images/${imgData.name}`),
        }
      })

      const tradeVideos = videoMapping[tradeId] || []
      videos[tradeId] = tradeVideos.map(vid => ({
        ...vid,
        url: archiveFileUrl(title, `trade-videos/${vid.mp4FileName}`),
        thumbUrl: vid.thumbFileName
          ? archiveFileUrl(title, `trade-videos/${vid.thumbFileName}`)
          : null,
      }))

      tags[tradeId] = tagMapping[tradeId] || []

      const journalEntry = journalMapping[tradeId]
      journal[tradeId] = {
        note: journalEntry?.note ?? '',
        setupTags: journalEntry?.setupTags ?? [],
        rating: journalEntry?.rating ?? 0,
        ratingManual: journalEntry?.ratingManual ?? false,
      }
    }

    return NextResponse.json({ images, videos, tags, journal })
  } catch (error) {
    console.error('Archive batch fetch error:', error)
    return NextResponse.json({ error: 'Failed to fetch archive media batch' }, { status: 500 })
  }
}
