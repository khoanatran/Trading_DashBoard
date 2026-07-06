import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs/promises'
import path from 'path'
import { normalizeTradeImageSection } from '@/lib/trade-images'

const DATA_DIR = path.join(process.cwd(), 'data')
const IMAGES_MAPPING = path.join(DATA_DIR, 'trade-images.json')
const VIDEOS_MAPPING = path.join(DATA_DIR, 'trade-videos.json')
const TAGS_MAPPING = path.join(DATA_DIR, 'trade-tags.json')
const JOURNAL_MAPPING = path.join(DATA_DIR, 'trade-journal.json')

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

type ImageMapping = Record<string, ImageData[]>
type VideoMapping = Record<string, VideoData[]>
type TagMapping = Record<string, string[]>

async function readJsonFile<T>(filePath: string, defaultValue: T): Promise<T> {
  try {
    const content = await fs.readFile(filePath, 'utf-8')
    return JSON.parse(content) as T
  } catch {
    return defaultValue
  }
}

/**
 * POST /api/trade-media/batch
 * Fetches images, videos, and tags for multiple trades in a single request
 * Body: { tradeIds: string[] }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { tradeIds } = body as { tradeIds: string[] }

    if (!tradeIds || !Array.isArray(tradeIds)) {
      return NextResponse.json({ error: 'tradeIds array is required' }, { status: 400 })
    }

    // Read all mapping files in parallel
    const [imageMapping, videoMapping, tagMapping, journalMapping] = await Promise.all([
      readJsonFile<ImageMapping>(IMAGES_MAPPING, {}),
      readJsonFile<VideoMapping>(VIDEOS_MAPPING, {}),
      readJsonFile<TagMapping>(TAGS_MAPPING, {}),
      readJsonFile<Record<string, { note?: string; setupTags?: string[]; rating?: number; ratingManual?: boolean }>>(JOURNAL_MAPPING, {})
    ])

    // Build response for each trade
    const images: Record<string, Array<{ name: string; url: string; note: string; drawings: unknown[]; section: string }>> = {}
    const videos: Record<string, Array<VideoData & { url: string; thumbUrl: string | null }>> = {}
    const tags: Record<string, string[]> = {}
    const journal: Record<string, { note: string; setupTags: string[]; rating: number; ratingManual?: boolean }> = {}

    for (const tradeId of tradeIds) {
      // Images
      const tradeImages = imageMapping[tradeId] || []
      images[tradeId] = tradeImages.map(img => {
        // Handle migration from old format (string) to new format (ImageData)
        const imgData = typeof img === 'string' ? { name: img } : img
        return {
          name: imgData.name,
          note: imgData.note || '',
          drawings: imgData.drawings || [],
          section: normalizeTradeImageSection(imgData.section),
          url: `/api/trade-images/file?name=${encodeURIComponent(imgData.name)}`
        }
      })

      // Videos
      const tradeVideos = videoMapping[tradeId] || []
      videos[tradeId] = tradeVideos.map(vid => ({
        ...vid,
        url: `/api/trade-videos/file?name=${encodeURIComponent(vid.mp4FileName)}`,
        thumbUrl: vid.thumbFileName 
          ? `/api/trade-videos/thumb?name=${encodeURIComponent(vid.thumbFileName)}`
          : null
      }))

      // Tags
      tags[tradeId] = tagMapping[tradeId] || []

      const journalEntry = journalMapping[tradeId]
      journal[tradeId] = {
        note: journalEntry?.note ?? '',
        setupTags: journalEntry?.setupTags ?? [],
        rating: journalEntry?.rating ?? 0,
        ratingManual: journalEntry?.ratingManual ?? false,
      }
    }

    return NextResponse.json({ images, videos, tags, journal }, {
      headers: {
        'Cache-Control': 'private, max-age=60' // Cache for 1 minute on client
      }
    })
  } catch (error) {
    console.error('Batch fetch error:', error)
    return NextResponse.json({ error: 'Failed to fetch batch data' }, { status: 500 })
  }
}
