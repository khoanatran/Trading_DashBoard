import fs from 'fs/promises'
import path from 'path'
import { remigrateTradeMetadata } from '../lib/trade-metadata-migration'
import type { Trade } from '../utils/logParser'

const DATA_DIR = path.join(process.cwd(), 'data')
const SNAPSHOT = path.join(DATA_DIR, 'trades-snapshot.json')

function tradeStubFromId(tradeId: string): Trade {
  const splitAt = tradeId.indexOf('::')
  const sourceFile = splitAt >= 0 ? tradeId.slice(0, splitAt) : 'unknown'
  const timestamp = splitAt >= 0 ? tradeId.slice(splitAt + 2) : tradeId
  return {
    timestamp,
    entryTime: timestamp,
    exitTime: timestamp,
    sourceFile,
    direction: null,
    riskAmount: null,
    estDollarRisked: null,
    slPoints: null,
    tpPoints: null,
    orderQty: null,
    entryPrice: null,
    exitPrice: null,
    reward: null,
    rrRatio: null,
    pnl: null,
    isClosed: true,
  }
}

async function loadTradesForRemigrate(): Promise<{ trades: Trade[]; source: string }> {
  try {
    const snapshot = JSON.parse(await fs.readFile(SNAPSHOT, 'utf-8')) as Trade[]
    if (Array.isArray(snapshot) && snapshot.length > 0) {
      return { trades: snapshot, source: 'trades-snapshot.json' }
    }
  } catch {
    // fall through to metadata bootstrap
  }

  const ids = new Set<string>()
  for (const file of ['trade-images.json', 'trade-videos.json', 'trade-journal.json', 'trade-tags.json']) {
    try {
      const mapping = JSON.parse(await fs.readFile(path.join(DATA_DIR, file), 'utf-8')) as Record<string, unknown>
      for (const key of Object.keys(mapping)) ids.add(key)
    } catch {
      // optional file
    }
  }

  try {
    const flags = JSON.parse(await fs.readFile(path.join(DATA_DIR, 'flags.json'), 'utf-8')) as {
      trades?: Record<string, boolean>
    }
    for (const key of Object.keys(flags.trades ?? {})) ids.add(key)
  } catch {
    // optional
  }

  if (ids.size === 0) {
    throw new Error('No trades snapshot or journal metadata keys found to remigrate.')
  }

  return {
    trades: [...ids].map(tradeStubFromId),
    source: 'metadata trade-id keys (bootstrap)',
  }
}

async function main() {
  const { trades, source } = await loadTradesForRemigrate()
  console.log(`Remigrating metadata for ${trades.length} trade(s) from ${source}...`)

  const result = await remigrateTradeMetadata(trades)
  console.log('Trade metadata remigration complete:')
  console.log(JSON.stringify(result, null, 2))
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
