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
}

export interface RestoreJournalResult {
  ok: boolean
  entryCount: number
}

async function fetchTradesSnapshotFromServer(): Promise<Trade[] | null> {
  try {
    const res = await fetch('/api/trades-snapshot')
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
  if (!serverTrades || serverTrades.length === 0) {
    const stored = loadStoredTrades()
    return {
      ok: true,
      restored: false,
      tradeCount: stored?.trades.length ?? 0,
      added: 0,
    }
  }

  const stored = loadStoredTrades()
  const localTrades = stored?.trades ?? []

  if (localTrades.length === 0) {
    saveStoredTrades(serverTrades, stored?.lastImportedFile ?? null)
    return {
      ok: true,
      restored: true,
      tradeCount: serverTrades.length,
      added: serverTrades.length,
    }
  }

  const { merged, added } = mergeImportedTrades(localTrades, serverTrades)
  if (added > 0) {
    saveStoredTrades(merged, stored?.lastImportedFile ?? null)
    return {
      ok: true,
      restored: true,
      tradeCount: merged.length,
      added,
    }
  }

  return {
    ok: true,
    restored: false,
    tradeCount: localTrades.length,
    added: 0,
  }
}

/** Hydrate journal localStorage cache from server JSON (notes, setup tags, ratings). */
export async function restoreJournalCacheFromServer(): Promise<RestoreJournalResult> {
  try {
    const res = await fetch('/api/trade-journal')
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
