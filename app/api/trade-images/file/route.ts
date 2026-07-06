import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs/promises'
import path from 'path'

const DATA_DIR = path.join(process.cwd(), 'data')
const IMAGES_DIR = path.join(DATA_DIR, 'trade-images')

// MIME types for common image formats
const MIME_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml'
}

// GET /api/trade-images/file?name=...
// Stream an image file from disk
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const name = searchParams.get('name')

  if (!name) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }

  // Prevent directory traversal attacks
  const sanitizedName = path.basename(name)
  const filePath = path.join(IMAGES_DIR, sanitizedName)

  try {
    // Check if file exists
    await fs.access(filePath)

    // Read file
    const buffer = await fs.readFile(filePath)

    // Determine content type
    const ext = path.extname(sanitizedName).toLowerCase()
    const contentType = MIME_TYPES[ext] || 'application/octet-stream'

    // Return file with appropriate headers
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': contentType,
        'Content-Length': buffer.length.toString(),
        'Cache-Control': 'public, max-age=31536000, immutable'
      }
    })
  } catch (error) {
    console.error('File read error:', error)
    return NextResponse.json({ error: 'File not found' }, { status: 404 })
  }
}

