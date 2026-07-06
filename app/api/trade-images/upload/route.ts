import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs/promises'
import path from 'path'
import { normalizeTradeImageSection } from '@/lib/trade-images'

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
  notifyDataChanged('trade image upload')
}

// Sanitize tradeId for use in filename
function sanitizeForFilename(str: string): string {
  return str.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 100)
}

// Generate a unique filename
function generateFilename(tradeId: string, originalName: string): string {
  const sanitizedId = sanitizeForFilename(tradeId)
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(2, 8)
  const ext = path.extname(originalName) || '.jpg'
  return `${sanitizedId}__${timestamp}_${random}${ext}`
}

// Ensure the images directory exists
async function ensureImagesDir(): Promise<void> {
  try {
    await fs.access(IMAGES_DIR)
  } catch {
    await fs.mkdir(IMAGES_DIR, { recursive: true })
  }
}

// POST /api/trade-images/upload
// Upload images for a trade (multipart/form-data with tradeId + files)
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const tradeId = formData.get('tradeId') as string
    const section = normalizeTradeImageSection(
      (formData.get('section') as string | null) ?? 'before'
    )

    if (!tradeId) {
      return NextResponse.json({ error: 'tradeId is required' }, { status: 400 })
    }

    await ensureImagesDir()

    const mapping = await readMapping()
    if (!mapping[tradeId]) {
      mapping[tradeId] = []
    }

    const uploadedFiles: ImageData[] = []

    // Process all files in the form data
    for (const [key, value] of formData.entries()) {
      if (key === 'tradeId') continue
      
      if (value instanceof File) {
        const file = value
        
        // Validate file type (images only)
        if (!file.type.startsWith('image/')) {
          continue // Skip non-image files
        }

        const filename = generateFilename(tradeId, file.name)
        const filePath = path.join(IMAGES_DIR, filename)

        // Write file to disk
        const buffer = Buffer.from(await file.arrayBuffer())
        await fs.writeFile(filePath, buffer)

        // Add to mapping with empty note and drawings
        const imageData: ImageData = {
          name: filename,
          note: '',
          drawings: [],
          section,
        }
        mapping[tradeId].push(imageData)
        uploadedFiles.push(imageData)
      }
    }

    await writeMapping(mapping)

    return NextResponse.json({ 
      success: true, 
      uploaded: uploadedFiles.length,
      files: uploadedFiles.map(img => ({
        name: img.name,
        note: img.note || '',
        drawings: img.drawings || [],
        section: normalizeTradeImageSection(img.section),
        url: `/api/trade-images/file?name=${encodeURIComponent(img.name)}`
      }))
    })
  } catch (error) {
    console.error('Upload error:', error)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}
