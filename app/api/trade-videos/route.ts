import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs/promises'
import path from 'path'
import { readVideoMapping, writeVideoMapping, VIDEOS_DIR } from '@/lib/trade-videos'

// GET /api/trade-videos?tradeId=...
// Returns list of videos for a trade
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const tradeId = searchParams.get('tradeId')

  if (!tradeId) {
    return NextResponse.json({ error: 'tradeId is required' }, { status: 400 })
  }

  const mapping = await readVideoMapping()
  const videos = mapping[tradeId] || []

  // Return video data with URLs
  const videosWithUrls = videos.map(video => ({
    ...video,
    url: `/api/trade-videos/file?name=${encodeURIComponent(video.mp4FileName)}`,
    thumbUrl: video.thumbFileName 
      ? `/api/trade-videos/file?name=${encodeURIComponent(video.thumbFileName)}`
      : null
  }))

  return NextResponse.json({ tradeId, videos: videosWithUrls })
}

// DELETE /api/trade-videos?tradeId=...&videoId=...
// Removes a specific video from a trade
export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const tradeId = searchParams.get('tradeId')
  const videoId = searchParams.get('videoId')

  if (!tradeId || !videoId) {
    return NextResponse.json({ error: 'tradeId and videoId are required' }, { status: 400 })
  }

  const mapping = await readVideoMapping()
  
  if (!mapping[tradeId]) {
    return NextResponse.json({ error: 'Trade not found' }, { status: 404 })
  }

  const index = mapping[tradeId].findIndex(v => v.id === videoId)
  if (index === -1) {
    return NextResponse.json({ error: 'Video not found for this trade' }, { status: 404 })
  }

  const video = mapping[tradeId][index]

  // Remove from mapping
  mapping[tradeId].splice(index, 1)
  if (mapping[tradeId].length === 0) {
    delete mapping[tradeId]
  }
  await writeVideoMapping(mapping)

  // Delete files from disk
  try {
    const mp4Path = path.join(VIDEOS_DIR, video.mp4FileName)
    await fs.unlink(mp4Path)
  } catch (err) {
    console.error('Failed to delete MP4 file:', err)
  }

  if (video.thumbFileName) {
    try {
      const thumbPath = path.join(VIDEOS_DIR, video.thumbFileName)
      await fs.unlink(thumbPath)
    } catch (err) {
      console.error('Failed to delete thumbnail:', err)
    }
  }

  return NextResponse.json({ success: true })
}



