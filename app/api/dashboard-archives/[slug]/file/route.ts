import { NextRequest, NextResponse } from 'next/server'
import path from 'path'
import { archiveExists, readArchiveMediaFile } from '@/lib/dashboard-archive'

const MIME_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
}

/** GET /api/dashboard-archives/[slug]/file?path=trade-images/foo.png */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> }
) {
  const { slug } = await context.params
  const title = decodeURIComponent(slug)
  const relPath = request.nextUrl.searchParams.get('path')

  if (!relPath) {
    return NextResponse.json({ error: 'path is required' }, { status: 400 })
  }

  if (!archiveExists(title)) {
    return NextResponse.json({ error: 'Archive not found' }, { status: 404 })
  }

  const normalized = relPath.replace(/\\/g, '/')
  if (normalized.includes('..')) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 })
  }

  try {
    const buffer = readArchiveMediaFile(title, normalized)
    if (!buffer) {
      return NextResponse.json({ error: 'File not found in archive' }, { status: 404 })
    }

    const ext = path.extname(normalized).toLowerCase()
    const contentType = MIME_TYPES[ext] || 'application/octet-stream'

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': contentType,
        'Content-Length': buffer.length.toString(),
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    })
  } catch (error) {
    console.error('Archive file read error:', error)
    return NextResponse.json({ error: 'Failed to read archive file' }, { status: 500 })
  }
}
