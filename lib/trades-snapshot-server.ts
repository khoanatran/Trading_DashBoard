import fs from 'fs/promises'
import path from 'path'
import type { Trade } from '@/utils/logParser'
import { notifyDataChanged } from '@/lib/notify-data-changed'

const DATA_DIR = path.join(process.cwd(), 'data')
const TRADES_SNAPSHOT_FILE = path.join(DATA_DIR, 'trades-snapshot.json')

export async function saveTradesSnapshot(trades: Trade[]): Promise<{ tradeCount: number }> {
  await fs.mkdir(DATA_DIR, { recursive: true })
  await fs.writeFile(TRADES_SNAPSHOT_FILE, JSON.stringify(trades, null, 2), 'utf-8')
  notifyDataChanged('trades snapshot')
  return { tradeCount: trades.length }
}
