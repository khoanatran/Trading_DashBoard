import fs from 'fs/promises'
import path from 'path'
import type { Trade } from '@/utils/logParser'
import { notifyDataChanged } from '@/lib/notify-data-changed'

const DATA_DIR = path.join(process.cwd(), 'data')
const TRADES_SNAPSHOT_FILE = path.join(DATA_DIR, 'trades-snapshot.json')

export async function loadTradesSnapshot(): Promise<Trade[]> {
  try {
    const raw = await fs.readFile(TRADES_SNAPSHOT_FILE, 'utf-8')
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed as Trade[]
  } catch {
    return []
  }
}

export async function saveTradesSnapshot(trades: Trade[]): Promise<{ tradeCount: number }> {
  await fs.mkdir(DATA_DIR, { recursive: true })
  await fs.writeFile(TRADES_SNAPSHOT_FILE, JSON.stringify(trades, null, 2), 'utf-8')
  notifyDataChanged('trades snapshot')
  return { tradeCount: trades.length }
}
