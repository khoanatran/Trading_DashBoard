import {
  loadStoredTrades,
  saveStoredTrades,
  mergeImportedTrades,
} from '@/lib/trade-storage'
import type { Trade } from '@/utils/logParser'

export interface RestoreTradesResult {
  ok: boolean
  restored: boolean
  tradeCount: number
  added: number
  trades: Trade[]
}

export interface RestoreJournalResult {
  ok: boolean
  entryCount: number
}

async function fetchTradesSnapshotFromServer(): Promise<Trade[] | null> {
  try {
    const res = await fetch(`/api/trades-snapshot?t=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) return null
    const data = await res.json()
    return Array.isArray(data.trades) ? data.trades : null
  } catch {
    return null
  }
}

/** Merge server trades snapshot into browser localStorage (for multi-computer sync). */
export async function restoreTradesFromServerSnapshot(): Promise<RestoreTradesResult> {
  const serverTrades = await fetchTradesSnapshotFromServer()
  const stored = loadStoredTrades()
  const localTrades = stored?.trades ?? []

  if (!serverTrades || serverTrades.length === 0) {
    return {
      ok: true,
      restored: false,
      tradeCount: localTrades.length,
      added: 0,
      trades: localTrades,
    }
  }

  if (localTrades.length === 0) {
    saveStoredTrades(serverTrades, stored?.lastImportedFile ?? null)
    return {
      ok: true,
      restored: true,
      tradeCount: serverTrades.length,
      added: serverTrades.length,
      trades: serverTrades,
    }
  }

  let { merged, added } = mergeImportedTrades(localTrades, serverTrades)

  // Never drop trades that exist only on the server (other machine)
  if (serverTrades.length > merged.length) {
    const serverFirst = mergeImportedTrades(serverTrades, localTrades)
    if (serverFirst.merged.length > merged.length) {
      merged = serverFirst.merged
      added = Math.max(added, serverFirst.added, merged.length - localTrades.length)
    }
  }

  const serverHasMore = serverTrades.length > localTrades.length
  const mergedHasMore = merged.length > localTrades.length
  const shouldSave = added > 0 || serverHasMore || mergedHasMore || merged.length !== localTrades.length

  if (shouldSave) {
    saveStoredTrades(merged, stored?.lastImportedFile ?? null)
    return {
      ok: true,
      restored: true,
      tradeCount: merged.length,
      added: Math.max(added, merged.length - localTrades.length),
      trades: merged,
    }
  }

  return {
    ok: true,
    restored: false,
    tradeCount: localTrades.length,
    added: 0,
    trades: localTrades,
  }
}

/** Hydrate journal localStorage cache from server JSON (notes, setup tags, ratings). */
export async function restoreJournalCacheFromServer(): Promise<RestoreJournalResult> {
  try {
    const res = await fetch(`/api/trade-journal?t=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) return { ok: false, entryCount: 0 }

    const data = await res.json()
    const mapping = data.mapping
    if (!mapping || typeof mapping !== 'object') {
      return { ok: true, entryCount: 0 }
    }

    const notes: Record<string, string> = {}
    const setupTags: Record<string, string[]> = {}
    const ratings: Record<string, number> = {}
    const ratingManual: Record<string, boolean> = {}

    for (const [tradeId, entry] of Object.entries(mapping)) {
      const e = entry as {
        note?: string
        setupTags?: string[]
        rating?: number
        ratingManual?: boolean
      }
      notes[tradeId] = e.note ?? ''
      setupTags[tradeId] = e.setupTags ?? []
      ratingManual[tradeId] = e.ratingManual ?? false
      ratings[tradeId] = e.rating ?? 0
    }

    localStorage.setItem('tradeNotes', JSON.stringify(notes))
    localStorage.setItem('tradeSetupTags', JSON.stringify(setupTags))
    localStorage.setItem('tradeRatings', JSON.stringify(ratings))
    localStorage.setItem('tradeRatingManual', JSON.stringify(ratingManual))

    return { ok: true, entryCount: Object.keys(mapping).length }
  } catch {
    return { ok: false, entryCount: 0 }
  }
}

/** Restore trades + journal cache from server after a GitHub pull. */
export async function restoreDashboardFromServer(): Promise<{
  trades: RestoreTradesResult
  journal: RestoreJournalResult
}> {
  const [trades, journal] = await Promise.all([
    restoreTradesFromServerSnapshot(),
    restoreJournalCacheFromServer(),
  ])
  return { trades, journal }
}
