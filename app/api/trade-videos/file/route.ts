import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs/promises'
import path from 'path'

const DATA_DIR = path.join(process.cwd(), 'data')
const VIDEOS_DIR = path.join(DATA_DIR, 'trade-videos')

// MIME types for video and image formats
const MIME_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png'
}

// GET /api/trade-videos/file?name=...
// Stream a video/thumbnail file from disk
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const name = searchParams.get('name')

  if (!name) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }

  // Prevent directory traversal attacks
  const sanitizedName = path.basename(name)
  const filePath = path.join(VIDEOS_DIR, sanitizedName)

  try {
    // Check if file exists and get stats
    const stats = await fs.stat(filePath)

    // Get range header for partial content (video seeking)
    const range = request.headers.get('range')
    const ext = path.extname(sanitizedName).toLowerCase()
    const contentType = MIME_TYPES[ext] || 'application/octet-stream'

    if (range && ext === '.mp4') {
      // Handle range request for video streaming
      const parts = range.replace(/bytes=/, '').split('-')
      const start = parseInt(parts[0], 10)
      const end = parts[1] ? parseInt(parts[1], 10) : stats.size - 1
      const chunkSize = end - start + 1

      // Read the specific range
      const fileHandle = await fs.open(filePath, 'r')
      const buffer = Buffer.alloc(chunkSize)
      await fileHandle.read(buffer, 0, chunkSize, start)
      await fileHandle.close()

      return new NextResponse(buffer, {
        status: 206,
        headers: {
          'Content-Range': `bytes ${start}-${end}/${stats.size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunkSize.toString(),
          'Content-Type': contentType
        }
      })
    } else {
      // Full file response
      const buffer = await fs.readFile(filePath)

      return new NextResponse(buffer, {
        headers: {
          'Content-Type': contentType,
          'Content-Length': buffer.length.toString(),
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'public, max-age=31536000, immutable'
        }
      })
    }
  } catch (error) {
    console.error('File read error:', error)
    return NextResponse.json({ error: 'File not found' }, { status: 404 })
  }
}



