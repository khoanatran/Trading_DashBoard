import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs/promises'
import path from 'path'

const DATA_DIR = path.join(process.cwd(), 'data')
const JOURNAL_FILE = path.join(DATA_DIR, 'trade-journal.json')

export interface TradeJournalEntry {
  note: string
  setupTags: string[]
  rating: number
  /** When true, rating was set manually and is not auto-derived from setup tags. */
  ratingManual?: boolean
  updatedAt: string
}

export type TradeJournalMapping = Record<string, TradeJournalEntry>

async function ensureDataFile(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true })
  try {
    await fs.access(JOURNAL_FILE)
  } catch {
    await fs.writeFile(JOURNAL_FILE, JSON.stringify({}, null, 2), 'utf-8')
  }
}

async function readMapping(): Promise<TradeJournalMapping> {
  await ensureDataFile()
  try {
    const content = await fs.readFile(JOURNAL_FILE, 'utf-8')
    return JSON.parse(content) as TradeJournalMapping
  } catch {
    return {}
  }
}

async function writeMapping(mapping: TradeJournalMapping): Promise<void> {
  await ensureDataFile()
  await fs.writeFile(JOURNAL_FILE, JSON.stringify(mapping, null, 2), 'utf-8')
  const { notifyDataChanged } = await import('@/lib/notify-data-changed')
  notifyDataChanged('trade journal')
}

function emptyEntry(): TradeJournalEntry {
  return { note: '', setupTags: [], rating: 0, updatedAt: new Date().toISOString() }
}

/** GET /api/trade-journal — full mapping, or ?tradeId=... for one entry */
export async function GET(request: NextRequest) {
  const tradeId = new URL(request.url).searchParams.get('tradeId')
  const mapping = await readMapping()

  if (!tradeId) {
    return NextResponse.json({ mapping })
  }

  const entry = mapping[tradeId] ?? emptyEntry()
  return NextResponse.json({ tradeId, ...entry })
}

/** PATCH /api/trade-journal — auto-save note, setup tags, and/or rating */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    const { tradeId, note, setupTags, rating, ratingManual } = body as {
      tradeId?: string
      note?: string
      setupTags?: string[]
      rating?: number
      ratingManual?: boolean
    }

    if (!tradeId) {
      return NextResponse.json({ error: 'tradeId is required' }, { status: 400 })
    }

    const mapping = await readMapping()
    const current = mapping[tradeId] ?? emptyEntry()

    const next: TradeJournalEntry = {
      note: note !== undefined ? note : current.note,
      setupTags: setupTags !== undefined ? setupTags : current.setupTags,
      rating: rating !== undefined ? rating : current.rating,
      ratingManual: ratingManual !== undefined ? ratingManual : current.ratingManual,
      updatedAt: new Date().toISOString(),
    }

    mapping[tradeId] = next
    await writeMapping(mapping)

    return NextResponse.json({ tradeId, ...next, saved: true })
  } catch (error) {
    console.error('Failed to save trade journal:', error)
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 })
  }
}
