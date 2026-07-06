import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs/promises'
import path from 'path'
import { ensureFfmpegAvailable, runFfmpeg } from '@/lib/ffmpeg'
import { readVideoMapping, writeVideoMapping, TradeVideo } from '@/lib/trade-videos'
import {
  formatVideoTime,
  generateVideoThumbnail,
  getVideoDuration,
  videoProcessingErrorMessage,
} from '@/lib/video-processing'

const DATA_DIR = path.join(process.cwd(), 'data')
const VIDEOS_DIR = path.join(DATA_DIR, 'trade-videos')

const MAX_CLIP_DURATION_SEC = 600

function sanitizeForFilename(str: string): string {
  return str.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 100)
}

function generateFilename(tradeId: string, suffix: string, ext: string): string {
  const sanitizedId = sanitizeForFilename(tradeId)
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(2, 8)
  return `${sanitizedId}__${timestamp}_${random}${suffix}${ext}`
}

function generateVideoId(): string {
  return `vid_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`
}

export async function POST(request: NextRequest) {
  try {
    const ffmpegCheck = await ensureFfmpegAvailable()
    if (!ffmpegCheck.ok) {
      return NextResponse.json({ error: ffmpegCheck.error }, { status: 500 })
    }

    const body = await request.json()
    const { tradeId, videoId, startSec, endSec } = body

    if (!tradeId || !videoId || startSec === undefined || endSec === undefined) {
      return NextResponse.json(
        { error: 'tradeId, videoId, startSec, and endSec are required' },
        { status: 400 }
      )
    }

    const start = parseFloat(startSec)
    const end = parseFloat(endSec)

    if (isNaN(start) || isNaN(end)) {
      return NextResponse.json({ error: 'startSec and endSec must be numbers' }, { status: 400 })
    }

    if (start < 0) {
      return NextResponse.json({ error: 'startSec must be >= 0' }, { status: 400 })
    }

    if (end <= start) {
      return NextResponse.json({ error: 'endSec must be greater than startSec' }, { status: 400 })
    }

    const clipDuration = end - start
    if (clipDuration > MAX_CLIP_DURATION_SEC) {
      return NextResponse.json(
        {
          error: `Clip duration (${Math.round(clipDuration)}s) exceeds maximum of ${MAX_CLIP_DURATION_SEC / 60} minutes`,
        },
        { status: 400 }
      )
    }

    const mapping = await readVideoMapping()

    if (!mapping[tradeId]) {
      return NextResponse.json({ error: 'Trade not found' }, { status: 404 })
    }

    const sourceVideo = mapping[tradeId].find(v => v.id === videoId)
    if (!sourceVideo) {
      return NextResponse.json({ error: 'Video not found for this trade' }, { status: 404 })
    }

    const sourcePath = path.join(VIDEOS_DIR, sourceVideo.mp4FileName)
    try {
      await fs.access(sourcePath)
    } catch {
      return NextResponse.json({ error: 'Source video file not found' }, { status: 404 })
    }

    const sourceDuration = await getVideoDuration(sourcePath)
    if (end > sourceDuration) {
      return NextResponse.json(
        { error: `endSec (${end}) exceeds video duration (${sourceDuration.toFixed(1)}s)` },
        { status: 400 }
      )
    }

    const clipFileName = generateFilename(tradeId, '_clip', '.mp4')
    const thumbFileName = generateFilename(tradeId, '_clip_thumb', '.jpg')
    const clipPath = path.join(VIDEOS_DIR, clipFileName)
    const thumbPath = path.join(VIDEOS_DIR, thumbFileName)

    try {
      await runFfmpeg(
        [
          '-y',
          '-ss',
          formatVideoTime(start),
          '-i',
          sourcePath,
          '-t',
          formatVideoTime(clipDuration),
          '-map',
          '0:v:0',
          '-map',
          '0:a:0?',
          '-c:v',
          'libx264',
          '-crf',
          '23',
          '-preset',
          'fast',
          '-c:a',
          'aac',
          '-b:a',
          '128k',
          '-movflags',
          '+faststart',
          clipPath,
        ],
        120_000
      )
    } catch (err) {
      console.error('Clip creation error:', err)
      return NextResponse.json(
        { error: videoProcessingErrorMessage(err) },
        { status: 500 }
      )
    }

    await generateVideoThumbnail(clipPath, thumbPath)

    let finalThumbFileName: string | undefined
    try {
      await fs.access(thumbPath)
      finalThumbFileName = thumbFileName
    } catch {
      // Thumbnail wasn't created
    }

    const finalDuration = await getVideoDuration(clipPath)

    const clipVideoId = generateVideoId()
    const clipData: TradeVideo = {
      id: clipVideoId,
      originalName: `Clip of ${sourceVideo.originalName}`,
      mp4FileName: clipFileName,
      thumbFileName: finalThumbFileName,
      durationSec: finalDuration,
      clipStartSec: start,
      clipEndSec: end,
      createdAt: new Date().toISOString(),
    }

    mapping[tradeId].push(clipData)
    await writeVideoMapping(mapping)

    return NextResponse.json({
      success: true,
      clip: {
        ...clipData,
        url: `/api/trade-videos/file?name=${encodeURIComponent(clipFileName)}`,
        thumbUrl: finalThumbFileName
          ? `/api/trade-videos/file?name=${encodeURIComponent(finalThumbFileName)}`
          : null,
      },
    })
  } catch (error) {
    console.error('Clip error:', error)
    return NextResponse.json({ error: 'Failed to create clip' }, { status: 500 })
  }
}
