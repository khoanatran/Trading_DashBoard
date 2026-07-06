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
    return JSON.parse(content) as MappingType
  } catch {
    return {}
  }
}

async function writeMapping(mapping: MappingType): Promise<void> {
  await fs.writeFile(MAPPING_FILE, JSON.stringify(mapping, null, 2), 'utf-8')
  const { notifyDataChanged } = await import('@/lib/notify-data-changed')
  notifyDataChanged('daily summary image upload')
}

async function ensureImagesDir(): Promise<void> {
  try {
    await fs.access(IMAGES_DIR)
  } catch {
    await fs.mkdir(IMAGES_DIR, { recursive: true })
  }
}

function generateFilename(dateKey: string, originalName: string): string {
  const safeDate = dateKey.replace(/[^0-9-]/g, '')
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(2, 8)
  const ext = path.extname(originalName) || '.jpg'
  return `daily__${safeDate}__${timestamp}_${random}${ext}`
}

/** POST /api/daily-summary/images/upload — multipart: dateKey + files */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const dateKey = formData.get('dateKey') as string

    if (!dateKey || !isValidDateKey(dateKey)) {
      return NextResponse.json({ error: 'Valid dateKey is required' }, { status: 400 })
    }

    await ensureImagesDir()

    const mapping = await readMapping()
    if (!mapping[dateKey]) {
      mapping[dateKey] = []
    }

    const uploadedFiles: ImageData[] = []

    for (const [key, value] of formData.entries()) {
      if (key === 'dateKey') continue
      if (value instanceof File && value.type.startsWith('image/')) {
        const filename = generateFilename(dateKey, value.name)
        const buffer = Buffer.from(await value.arrayBuffer())
        await fs.writeFile(path.join(IMAGES_DIR, filename), buffer)
        const imageData: ImageData = { name: filename, note: '' }
        mapping[dateKey].push(imageData)
        uploadedFiles.push(imageData)
      }
    }

    await writeMapping(mapping)

    return NextResponse.json({
      success: true,
      uploaded: uploadedFiles.length,
      files: uploadedFiles.map(img => ({
        name: img.name,
        note: '',
        url: `/api/daily-summary/images/file?name=${encodeURIComponent(img.name)}`,
      })),
    })
  } catch (error) {
    console.error('Daily image upload error:', error)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}
