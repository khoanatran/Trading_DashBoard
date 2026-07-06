import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs/promises'
import path from 'path'
import {
  normalizeTradeImageSection,
  reorderSectionImages,
  type TradeImageSection,
} from '@/lib/trade-images'

const DATA_DIR = path.join(process.cwd(), 'data')
const IMAGES_DIR = path.join(DATA_DIR, 'trade-images')
const MAPPING_FILE = path.join(DATA_DIR, 'trade-images.json')

// Drawing stroke structure
interface DrawingStroke {
  points: { x: number; y: number }[]
  color: string
  size: number
  tool: 'pen' | 'highlighter' | 'eraser'
}

// Image data structure with optional note and drawings
interface ImageData {
  name: string
  note?: string
  drawings?: DrawingStroke[]
  section?: string
}

// Mapping: tradeId -> array of ImageData
type MappingType = Record<string, ImageData[]>

// Helper to read the mapping file
async function readMapping(): Promise<MappingType> {
  try {
    const content = await fs.readFile(MAPPING_FILE, 'utf-8')
    const data = JSON.parse(content)
    
    // Handle migration from old format (string[]) to new format (ImageData[])
    const migrated: MappingType = {}
    for (const [tradeId, images] of Object.entries(data)) {
      if (Array.isArray(images)) {
        migrated[tradeId] = images.map(img => {
          const data = typeof img === 'string' ? { name: img } : img
          return {
            ...data,
            section: normalizeTradeImageSection(data.section),
          }
        })
      }
    }
    return migrated
  } catch {
    return {}
  }
}

// Helper to write the mapping file
async function writeMapping(mapping: MappingType): Promise<void> {
  await fs.writeFile(MAPPING_FILE, JSON.stringify(mapping, null, 2), 'utf-8')
  const { notifyDataChanged } = await import('@/lib/notify-data-changed')
  notifyDataChanged('trade images')
}

// GET /api/trade-images?tradeId=...
// Returns list of images for a trade with notes
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const tradeId = searchParams.get('tradeId')

  if (!tradeId) {
    return NextResponse.json({ error: 'tradeId is required' }, { status: 400 })
  }

  const mapping = await readMapping()
  const images = mapping[tradeId] || []

  // Return image data with URLs
  const imagesWithUrls = images.map(img => ({
    name: img.name,
    note: img.note || '',
    drawings: img.drawings || [],
    section: normalizeTradeImageSection(img.section),
    url: `/api/trade-images/file?name=${encodeURIComponent(img.name)}`
  }))

  return NextResponse.json({ tradeId, images: imagesWithUrls })
}

// DELETE /api/trade-images?tradeId=...&name=...
// Removes a specific image from a trade
export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const tradeId = searchParams.get('tradeId')
  const name = searchParams.get('name')

  if (!tradeId || !name) {
    return NextResponse.json({ error: 'tradeId and name are required' }, { status: 400 })
  }

  const mapping = await readMapping()
  
  if (!mapping[tradeId]) {
    return NextResponse.json({ error: 'Trade not found' }, { status: 404 })
  }

  const index = mapping[tradeId].findIndex(img => img.name === name)
  if (index === -1) {
    return NextResponse.json({ error: 'Image not found for this trade' }, { status: 404 })
  }

  // Remove from mapping
  mapping[tradeId].splice(index, 1)
  if (mapping[tradeId].length === 0) {
    delete mapping[tradeId]
  }
  await writeMapping(mapping)

  // Delete file from disk
  try {
    const filePath = path.join(IMAGES_DIR, name)
    await fs.unlink(filePath)
  } catch (err) {
    console.error('Failed to delete file:', err)
    // Continue anyway - mapping is updated
  }

  return NextResponse.json({ success: true })
}

// PATCH /api/trade-images
// Update note and/or drawings for an image
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    const { tradeId, name, note, drawings, sectionOrder } = body

    if (!tradeId) {
      return NextResponse.json({ error: 'tradeId is required' }, { status: 400 })
    }

    const mapping = await readMapping()

    if (!mapping[tradeId]) {
      return NextResponse.json({ error: 'Trade not found' }, { status: 404 })
    }

    if (sectionOrder !== undefined) {
      const section = normalizeTradeImageSection(sectionOrder.section) as TradeImageSection
      const names = sectionOrder.names

      if (!Array.isArray(names) || names.some((n: unknown) => typeof n !== 'string')) {
        return NextResponse.json({ error: 'sectionOrder.names must be an array of strings' }, { status: 400 })
      }

      const reordered = reorderSectionImages(mapping[tradeId], section, names)
      if (!reordered) {
        return NextResponse.json({ error: 'Invalid section image order' }, { status: 400 })
      }

      mapping[tradeId] = reordered
      await writeMapping(mapping)

      const imagesWithUrls = reordered.map(img => ({
        name: img.name,
        note: img.note || '',
        drawings: img.drawings || [],
        section: normalizeTradeImageSection(img.section),
        url: `/api/trade-images/file?name=${encodeURIComponent(img.name)}`,
      }))

      return NextResponse.json({ success: true, images: imagesWithUrls })
    }

    if (!name) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 })
    }

    const image = mapping[tradeId].find(img => img.name === name)
    if (!image) {
      return NextResponse.json({ error: 'Image not found for this trade' }, { status: 404 })
    }

    if (note !== undefined) {
      image.note = note || ''
    }

    if (drawings !== undefined) {
      image.drawings = drawings || []
    }

    await writeMapping(mapping)

    return NextResponse.json({
      success: true,
      note: image.note,
      drawings: image.drawings,
    })
  } catch (error) {
    console.error('PATCH error:', error)
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 })
  }
}
