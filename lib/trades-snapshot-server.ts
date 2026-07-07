import fs from 'fs/promises'
import path from 'path'
import type { Trade } from '@/utils/logParser'
import { notifyDataChanged } from '@/lib/notify-data-changed'

const DATA_DIR = path.join(process.cwd(), 'data')
const TRADES_SNAPSHOT_FILE = path.join(DATA_DIR, 'trades-snapshot.json')

export interface TradesSnapshotData {
  trades: Trade[]
  updatedAt: string | null
}

function parseSnapshotFile(parsed: unknown): TradesSnapshotData {
  if (Array.isArray(parsed)) {
    return { trades: parsed as Trade[], updatedAt: null }
  }
  if (parsed && typeof parsed === 'object' && 'trades' in parsed) {
    const payload = parsed as { trades?: unknown; updatedAt?: string | null }
    return {
      trades: Array.isArray(payload.trades) ? (payload.trades as Trade[]) : [],
      updatedAt: payload.updatedAt ?? null,
    }
  }
  return { trades: [], updatedAt: null }
}

export async function loadTradesSnapshot(): Promise<Trade[]> {
  const data = await loadTradesSnapshotData()
  return data.trades
}

export async function loadTradesSnapshotData(): Promise<TradesSnapshotData> {
  try {
    const content = await fs.readFile(TRADES_SNAPSHOT_FILE, 'utf-8')
    return parseSnapshotFile(JSON.parse(content))
  } catch {
    return { trades: [], updatedAt: null }
  }
}

export async function saveTradesSnapshot(
  trades: Trade[]
): Promise<{ tradeCount: number; updatedAt: string }> {
  const updatedAt = new Date().toISOString()
  await fs.mkdir(DATA_DIR, { recursive: true })
  await fs.writeFile(
    TRADES_SNAPSHOT_FILE,
    JSON.stringify({ version: 1, trades, updatedAt }, null, 2),
    'utf-8'
  )
  notifyDataChanged('trades snapshot')

  // Push trades to GitHub quickly — other computers depend on this file
  void import('@/lib/github-backup-server').then(({ runGitHubBackup }) => {
    void runGitHubBackup('trades snapshot')
  })

  return { tradeCount: trades.length, updatedAt }
}
