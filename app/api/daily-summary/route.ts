import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs/promises'
import path from 'path'

const DATA_DIR = path.join(process.cwd(), 'data')
const SUMMARIES_FILE = path.join(DATA_DIR, 'daily-summaries.json')

interface DailySummaryEntry {
  note: string
  updatedAt: string
}

type SummariesMapping = Record<string, DailySummaryEntry>

async function ensureDataDir(): Promise<void> {
  try {
    await fs.access(DATA_DIR)
  } catch {
    await fs.mkdir(DATA_DIR, { recursive: true })
  }
}

async function readSummaries(): Promise<SummariesMapping> {
  try {
    const content = await fs.readFile(SUMMARIES_FILE, 'utf-8')
    return JSON.parse(content) as SummariesMapping
  } catch {
    return {}
  }
}

async function writeSummaries(summaries: SummariesMapping): Promise<void> {
  await ensureDataDir()
  await fs.writeFile(SUMMARIES_FILE, JSON.stringify(summaries, null, 2), 'utf-8')
  const { notifyDataChanged } = await import('@/lib/notify-data-changed')
  notifyDataChanged('daily summary')
}

function isValidDateKey(dateKey: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateKey)
}

/** GET /api/daily-summary?dateKey=YYYY-MM-DD */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const dateKey = searchParams.get('dateKey')

    if (!dateKey) {
      return NextResponse.json({ error: 'dateKey is required' }, { status: 400 })
    }
    if (!isValidDateKey(dateKey)) {
      return NextResponse.json({ error: 'Invalid dateKey format. Expected YYYY-MM-DD' }, { status: 400 })
    }

    const summaries = await readSummaries()
    const entry = summaries[dateKey]

    return NextResponse.json({
      dateKey,
      note: entry?.note ?? '',
      updatedAt: entry?.updatedAt ?? null,
    })
  } catch (error) {
    console.error('Error reading daily summary:', error)
    return NextResponse.json({ error: 'Failed to read daily summary' }, { status: 500 })
  }
}

/** PATCH /api/daily-summary — body: { dateKey, note } */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    const { dateKey, note } = body as { dateKey: string; note: string }

    if (!dateKey || !isValidDateKey(dateKey)) {
      return NextResponse.json({ error: 'Valid dateKey (YYYY-MM-DD) is required' }, { status: 400 })
    }

    const summaries = await readSummaries()
    const trimmed = (note ?? '').trim()

    if (trimmed) {
      summaries[dateKey] = {
        note: trimmed,
        updatedAt: new Date().toISOString(),
      }
    } else {
      delete summaries[dateKey]
    }

    await writeSummaries(summaries)

    return NextResponse.json({
      success: true,
      dateKey,
      note: summaries[dateKey]?.note ?? '',
      updatedAt: summaries[dateKey]?.updatedAt ?? null,
    })
  } catch (error) {
    console.error('Error saving daily summary:', error)
    return NextResponse.json({ error: 'Failed to save daily summary' }, { status: 500 })
  }
}
