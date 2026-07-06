import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs/promises'
import path from 'path'
import { ensureFfmpegAvailable } from '@/lib/ffmpeg'
import { readVideoMapping, writeVideoMapping, TradeVideo } from '@/lib/trade-videos'
import {
  generateVideoThumbnail,
  getVideoDuration,
  processUploadedVideo,
  videoProcessingErrorMessage,
} from '@/lib/video-processing'

const DATA_DIR = path.join(process.cwd(), 'data')
const VIDEOS_DIR = path.join(DATA_DIR, 'trade-videos')

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

async function ensureVideosDir(): Promise<void> {
  try {
    await fs.access(VIDEOS_DIR)
  } catch {
    await fs.mkdir(VIDEOS_DIR, { recursive: true })
  }
}

export async function POST(request: NextRequest) {
  try {
    const ffmpegCheck = await ensureFfmpegAvailable()
    if (!ffmpegCheck.ok) {
      return NextResponse.json({ error: ffmpegCheck.error }, { status: 500 })
    }

    const formData = await request.formData()
    const tradeId = formData.get('tradeId') as string
    const trimStartStr = formData.get('trimStart') as string | null
    const trimEndStr = formData.get('trimEnd') as string | null

    if (!tradeId) {
      return NextResponse.json({ error: 'tradeId is required' }, { status: 400 })
    }

    const trimStart = trimStartStr ? parseFloat(trimStartStr) : undefined
    const trimEnd = trimEndStr ? parseFloat(trimEndStr) : undefined

    if (trimStart !== undefined && trimEnd !== undefined) {
      const clipDuration = trimEnd - trimStart
      if (clipDuration <= 0) {
        return NextResponse.json({ error: 'Invalid trim range' }, { status: 400 })
      }
      if (clipDuration > 600) {
        return NextResponse.json({ error: 'Clip must be 10 minutes or less' }, { status: 400 })
      }
    }

    await ensureVideosDir()

    const mapping = await readVideoMapping()
    if (!mapping[tradeId]) {
      mapping[tradeId] = []
    }

    const uploadedVideos: (TradeVideo & { url: string; thumbUrl: string | null })[] = []

    for (const [key, value] of formData.entries()) {
      if (key === 'tradeId' || key === 'trimStart' || key === 'trimEnd') continue

      if (value instanceof File) {
        const file = value

        const videoMimeTypes = [
          'video/x-matroska',
          'video/mp4',
          'video/webm',
          'video/quicktime',
          'video/x-msvideo',
          'video/mpeg',
          'application/octet-stream',
        ]

        const isVideo =
          videoMimeTypes.includes(file.type) ||
          /\.(mkv|mp4|webm|mov|avi)$/i.test(file.name)

        if (!isVideo) {
          console.log('Skipping non-video file:', file.name, file.type)
          continue
        }

        const tempFileName = generateFilename(tradeId, '_temp', path.extname(file.name))
        const tempPath = path.join(VIDEOS_DIR, tempFileName)

        const buffer = Buffer.from(await file.arrayBuffer())
        await fs.writeFile(tempPath, buffer)

        try {
          const mp4FileName = generateFilename(tradeId, '', '.mp4')
          const thumbFileName = generateFilename(tradeId, '_thumb', '.jpg')
          const mp4Path = path.join(VIDEOS_DIR, mp4FileName)
          const thumbPath = path.join(VIDEOS_DIR, thumbFileName)

          await processUploadedVideo(
            tempPath,
            mp4Path,
            file.name,
            trimStart,
            trimEnd
          )

          await generateVideoThumbnail(mp4Path, thumbPath)

          let finalThumbFileName: string | undefined
          try {
            await fs.access(thumbPath)
            finalThumbFileName = thumbFileName
          } catch {
            // Thumbnail wasn't created
          }

          await fs.unlink(tempPath)

          const finalDuration = await getVideoDuration(mp4Path)

          const videoId = generateVideoId()
          const videoData: TradeVideo = {
            id: videoId,
            originalName: file.name,
            mp4FileName,
            thumbFileName: finalThumbFileName,
            durationSec: finalDuration,
            clipStartSec: trimStart,
            clipEndSec: trimEnd,
            createdAt: new Date().toISOString(),
          }

          mapping[tradeId].push(videoData)
          uploadedVideos.push({
            ...videoData,
            url: `/api/trade-videos/file?name=${encodeURIComponent(mp4FileName)}`,
            thumbUrl: finalThumbFileName
              ? `/api/trade-videos/file?name=${encodeURIComponent(finalThumbFileName)}`
              : null,
          })
        } catch (conversionError) {
          try {
            await fs.unlink(tempPath)
          } catch {}
          console.error('Video processing error:', conversionError)
          return NextResponse.json(
            { error: videoProcessingErrorMessage(conversionError) },
            { status: 500 }
          )
        }
      }
    }

    if (uploadedVideos.length === 0) {
      return NextResponse.json(
        { error: 'No valid video file was uploaded.' },
        { status: 400 }
      )
    }

    await writeVideoMapping(mapping)

    return NextResponse.json({
      success: true,
      uploaded: uploadedVideos.length,
      videos: uploadedVideos,
    })
  } catch (error) {
    console.error('Upload error:', error)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}
