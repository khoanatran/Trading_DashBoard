import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs/promises'
import path from 'path'

const DATA_DIR = path.join(process.cwd(), 'data')
const FLAGS_FILE = path.join(DATA_DIR, 'flags.json')

export interface FlagsData {
  days: Record<string, boolean>
  trades: Record<string, boolean>
}

interface FlagsFile extends FlagsData {
  /** Bumped when day flags no longer auto-sync trade flags. */
  _v?: number
}

const FLAGS_SCHEMA_VERSION = 1

function emptyFlags(): FlagsFile {
  return { _v: FLAGS_SCHEMA_VERSION, days: {}, trades: {} }
}

function dayKeyFromTradeId(tradeId: string): string | null {
  const match = tradeId.match(/(\d{4}-\d{2}-\d{2})T/)
  return match?.[1] ?? null
}

/** Remove trade flags that were bulk-synced from calendar day flags (legacy behavior). */
function migrateSeparatedDayTradeFlags(file: FlagsFile): { file: FlagsFile; changed: boolean } {
  if (file._v === FLAGS_SCHEMA_VERSION) {
    return { file, changed: false }
  }

  const flaggedDays = new Set(Object.keys(file.days ?? {}))
  const trades = { ...(file.trades ?? {}) }
  for (const tradeId of Object.keys(trades)) {
    const dayKey = dayKeyFromTradeId(tradeId)
    if (dayKey && flaggedDays.has(dayKey)) {
      delete trades[tradeId]
    }
  }

  return {
    file: {
      _v: FLAGS_SCHEMA_VERSION,
      days: file.days ?? {},
      trades,
    },
    changed: true,
  }
}

function toFlagsData(file: FlagsFile): FlagsData {
  return { days: file.days ?? {}, trades: file.trades ?? {} }
}

async function ensureDataFile(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true })
  try {
    await fs.access(FLAGS_FILE)
  } catch {
    await fs.writeFile(FLAGS_FILE, JSON.stringify(emptyFlags(), null, 2))
  }
}

async function readFlagsFile(): Promise<FlagsFile> {
  await ensureDataFile()
  try {
    const content = await fs.readFile(FLAGS_FILE, 'utf-8')
    const parsed = JSON.parse(content) as Partial<FlagsFile>
    return {
      _v: parsed._v,
      days: parsed.days && typeof parsed.days === 'object' ? parsed.days : {},
      trades: parsed.trades && typeof parsed.trades === 'object' ? parsed.trades : {},
    }
  } catch {
    return emptyFlags()
  }
}

async function readFlags(): Promise<FlagsData> {
  const raw = await readFlagsFile()
  const { file, changed } = migrateSeparatedDayTradeFlags(raw)
  if (changed) {
    await writeFlagsFile(file)
  }
  return toFlagsData(file)
}

async function writeFlagsFile(data: FlagsFile): Promise<void> {
  await ensureDataFile()
  const payload: FlagsFile = {
    _v: FLAGS_SCHEMA_VERSION,
    days: data.days ?? {},
    trades: data.trades ?? {},
  }
  await fs.writeFile(FLAGS_FILE, JSON.stringify(payload, null, 2))
  const { notifyDataChanged } = await import('@/lib/notify-data-changed')
  notifyDataChanged('flags')
}

async function writeFlags(data: FlagsData): Promise<void> {
  await writeFlagsFile({
    _v: FLAGS_SCHEMA_VERSION,
    days: data.days,
    trades: data.trades,
  })
}

/** GET /api/flags — full day + trade flag mapping */
export async function GET() {
  try {
    const flags = await readFlags()
    return NextResponse.json(flags)
  } catch (error) {
    console.error('Failed to read flags:', error)
    return NextResponse.json({ error: 'Failed to read flags' }, { status: 500 })
  }
}

/**
 * POST /api/flags
 * - Toggle a calendar day only: { dateKey, flagged }
 * - Toggle a single trade: { tradeId, flagged }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { dateKey, tradeId, flagged } = body as {
      dateKey?: string
      tradeId?: string
      flagged?: boolean
    }

    if (typeof flagged !== 'boolean') {
      return NextResponse.json({ error: 'flagged must be a boolean' }, { status: 400 })
    }

    if (typeof tradeId === 'string' && tradeId.length > 0) {
      const data = await readFlags()
      if (flagged) {
        data.trades[tradeId] = true
      } else {
        delete data.trades[tradeId]
      }
      await writeFlags(data)
      return NextResponse.json({ success: true, ...data })
    }

    if (!dateKey || typeof dateKey !== 'string') {
      return NextResponse.json({ error: 'dateKey or tradeId is required' }, { status: 400 })
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
      return NextResponse.json({ error: 'Invalid dateKey format. Expected YYYY-MM-DD' }, { status: 400 })
    }

    const data = await readFlags()

    if (flagged) {
      data.days[dateKey] = true
    } else {
      delete data.days[dateKey]
    }

    await writeFlags(data)
    return NextResponse.json({ success: true, ...data })
  } catch (error) {
    console.error('Failed to save flags:', error)
    return NextResponse.json({ error: 'Failed to save flags' }, { status: 500 })
  }
}
