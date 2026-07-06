import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs/promises'
import path from 'path'

const DATA_DIR = path.join(process.cwd(), 'data')
const TAGS_FILE = path.join(DATA_DIR, 'trade-tags.json')

// Tag structure
interface TradeTagsMapping {
  [tradeId: string]: string[]
}

// Ensure data directory and file exist
async function ensureDataFile() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true })
    try {
      await fs.access(TAGS_FILE)
    } catch {
      await fs.writeFile(TAGS_FILE, JSON.stringify({}, null, 2))
    }
  } catch (err) {
    console.error('Failed to ensure data file:', err)
  }
}

// Read tags mapping
async function readMapping(): Promise<TradeTagsMapping> {
  await ensureDataFile()
  try {
    const content = await fs.readFile(TAGS_FILE, 'utf-8')
    return JSON.parse(content)
  } catch {
    return {}
  }
}

// Write tags mapping
async function writeMapping(mapping: TradeTagsMapping) {
  await ensureDataFile()
  await fs.writeFile(TAGS_FILE, JSON.stringify(mapping, null, 2))
  const { notifyDataChanged } = await import('@/lib/notify-data-changed')
  notifyDataChanged('trade tags')
}

// GET - Retrieve tags for one trade, or the full mapping when tradeId is omitted
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const tradeId = searchParams.get('tradeId')

  const mapping = await readMapping()

  if (!tradeId) {
    return NextResponse.json({ mapping })
  }

  const tags = mapping[tradeId] || []

  return NextResponse.json({ tags })
}

// POST - Add a tag to a trade
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { tradeId, tag } = body
    
    if (!tradeId || !tag) {
      return NextResponse.json({ error: 'tradeId and tag are required' }, { status: 400 })
    }
    
    const mapping = await readMapping()
    
    if (!mapping[tradeId]) {
      mapping[tradeId] = []
    }
    
    if (!mapping[tradeId].includes(tag)) {
      mapping[tradeId].push(tag)
    }
    
    await writeMapping(mapping)
    
    return NextResponse.json({ success: true, tags: mapping[tradeId] })
  } catch (err) {
    console.error('Failed to add tag:', err)
    return NextResponse.json({ error: 'Failed to add tag' }, { status: 500 })
  }
}

// DELETE - Remove a tag from a trade
export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const tradeId = searchParams.get('tradeId')
  const tag = searchParams.get('tag')
  
  if (!tradeId || !tag) {
    return NextResponse.json({ error: 'tradeId and tag are required' }, { status: 400 })
  }
  
  const mapping = await readMapping()
  
  if (mapping[tradeId]) {
    mapping[tradeId] = mapping[tradeId].filter(t => t !== tag)
    if (mapping[tradeId].length === 0) {
      delete mapping[tradeId]
    }
  }
  
  await writeMapping(mapping)
  
  return NextResponse.json({ success: true, tags: mapping[tradeId] || [] })
}

// PUT - Set all tags for a trade (replace)
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { tradeId, tags } = body
    
    if (!tradeId) {
      return NextResponse.json({ error: 'tradeId is required' }, { status: 400 })
    }
    
    const mapping = await readMapping()
    
    if (tags && tags.length > 0) {
      mapping[tradeId] = tags
    } else {
      delete mapping[tradeId]
    }
    
    await writeMapping(mapping)
    
    return NextResponse.json({ success: true, tags: mapping[tradeId] || [] })
  } catch (err) {
    console.error('Failed to set tags:', err)
    return NextResponse.json({ error: 'Failed to set tags' }, { status: 500 })
  }
}


