import { normalizeTradesRisk, getTradeDedupKey, type Trade } from '@/utils/logParser'
import { sortTradesForEquityCurve } from '@/utils/logParser'

const STORAGE_KEY = 'trading-dashboard-trades-v1'

export interface StoredTradesPayload {
  version: 1
  trades: Trade[]
  lastImportedFile: string | null
  updatedAt: string
}

export interface MergeTradesResult {
  merged: Trade[]
  added: number
  skipped: number
}

function sortTradesByTime(trades: Trade[]): Trade[] {
  return sortTradesForEquityCurve(trades)
}

export function loadStoredTrades(): StoredTradesPayload | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredTradesPayload
    if (parsed?.version !== 1 || !Array.isArray(parsed.trades)) return null
    return {
      version: 1,
      trades: normalizeTradesRisk(parsed.trades),
      lastImportedFile: parsed.lastImportedFile ?? null,
      updatedAt: parsed.updatedAt ?? new Date().toISOString(),
    }
  } catch (error) {
    console.warn('Failed to load saved trades:', error)
    return null
  }
}

export function saveStoredTrades(
  trades: Trade[],
  lastImportedFile?: string | null
): void {
  if (typeof window === 'undefined') return
  try {
    const existing = loadStoredTrades()
    const payload: StoredTradesPayload = {
      version: 1,
      trades: normalizeTradesRisk(trades),
      lastImportedFile:
        lastImportedFile !== undefined
          ? lastImportedFile
          : existing?.lastImportedFile ?? null,
      updatedAt: new Date().toISOString(),
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch (error) {
    console.error('Failed to save trades to local storage:', error)
  }
}

/** Merge newly imported trades into existing; skip duplicates by trade fingerprint. */
export function mergeImportedTrades(
  existing: Trade[],
  incoming: Trade[]
): MergeTradesResult {
  const normalizedIncoming = normalizeTradesRisk(incoming)
  const byKey = new Map<string, Trade>()

  for (const trade of existing) {
    byKey.set(getTradeDedupKey(trade), trade)
  }

  let added = 0
  let skipped = 0
  for (const trade of normalizedIncoming) {
    const key = getTradeDedupKey(trade)
    if (byKey.has(key)) {
      const existing = byKey.get(key)!
      // Refresh trade metrics from import but keep stable id fields for journal media.
      byKey.set(key, {
        ...trade,
        timestamp: existing.timestamp ?? trade.timestamp,
        entryTime: existing.entryTime ?? trade.entryTime,
        exitTime: existing.exitTime ?? trade.exitTime,
        sourceFile: existing.sourceFile ?? trade.sourceFile,
      })
      skipped++
      continue
    }
    byKey.set(key, trade)
    added++
  }

  return {
    merged: sortTradesByTime(Array.from(byKey.values())),
    added,
    skipped,
  }
}

export function clearStoredTrades(): void {
  if (typeof window === 'undefined') return
  localStorage.removeItem(STORAGE_KEY)
}
