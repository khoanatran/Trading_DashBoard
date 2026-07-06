import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs/promises'
import path from 'path'

const DATA_DIR = path.join(process.cwd(), 'data')
const IMAGES_DIR = path.join(DATA_DIR, 'daily-images')
const MAPPING_FILE = path.join(DATA_DIR, 'daily-images.json')

interface ImageData {
  name: string
  note?: string
}

type MappingType = Record<string, ImageData[]>

function isValidDateKey(dateKey: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateKey)
}

async function readMapping(): Promise<MappingType> {
  try {
    const content = await fs.readFile(MAPPING_FILE, 'utf-8')
    const data = JSON.parse(content) as MappingType
    const migrated: MappingType = {}
    for (const [dateKey, images] of Object.entries(data)) {
      if (Array.isArray(images)) {
        migrated[dateKey] = images.map(img =>
          typeof img === 'string' ? { name: img } : img
        )
      }
    }
    return migrated
  } catch {
    return {}
  }
}

async function writeMapping(mapping: MappingType): Promise<void> {
  await fs.writeFile(MAPPING_FILE, JSON.stringify(mapping, null, 2), 'utf-8')
  const { notifyDataChanged } = await import('@/lib/notify-data-changed')
  notifyDataChanged('daily summary images')
}

/** GET /api/daily-summary/images?dateKey=YYYY-MM-DD */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const dateKey = searchParams.get('dateKey')

  if (!dateKey || !isValidDateKey(dateKey)) {
    return NextResponse.json({ error: 'Valid dateKey is required' }, { status: 400 })
  }

  const mapping = await readMapping()
  const images = mapping[dateKey] || []

  return NextResponse.json({
    dateKey,
    images: images.map(img => ({
      name: img.name,
      note: img.note || '',
      url: `/api/daily-summary/images/file?name=${encodeURIComponent(img.name)}`,
    })),
  })
}

/** DELETE /api/daily-summary/images?dateKey=...&name=... */
export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const dateKey = searchParams.get('dateKey')
  const name = searchParams.get('name')

  if (!dateKey || !name || !isValidDateKey(dateKey)) {
    return NextResponse.json({ error: 'dateKey and name are required' }, { status: 400 })
  }

  const mapping = await readMapping()
  if (!mapping[dateKey]) {
    return NextResponse.json({ error: 'Date not found' }, { status: 404 })
  }

  const index = mapping[dateKey].findIndex(img => img.name === name)
  if (index === -1) {
    return NextResponse.json({ error: 'Image not found' }, { status: 404 })
  }

  mapping[dateKey].splice(index, 1)
  if (mapping[dateKey].length === 0) {
    delete mapping[dateKey]
  }
  await writeMapping(mapping)

  try {
    await fs.unlink(path.join(IMAGES_DIR, name))
  } catch {
    // mapping updated even if file missing
  }

  return NextResponse.json({ success: true })
}

/** PATCH /api/daily-summary/images — image note */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    const { dateKey, name, note } = body as { dateKey: string; name: string; note: string }

    if (!dateKey || !name || !isValidDateKey(dateKey)) {
      return NextResponse.json({ error: 'dateKey and name are required' }, { status: 400 })
    }

    const mapping = await readMapping()
    if (!mapping[dateKey]) {
      return NextResponse.json({ error: 'Date not found' }, { status: 404 })
    }

    const image = mapping[dateKey].find(img => img.name === name)
    if (!image) {
      return NextResponse.json({ error: 'Image not found' }, { status: 404 })
    }

    image.note = note || ''
    await writeMapping(mapping)

    return NextResponse.json({ success: true, note: image.note })
  } catch (error) {
    console.error('PATCH daily image error:', error)
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 })
  }
}
