import {
  loadStoredTrades,
  saveStoredTrades,
  mergeImportedTrades,
  clearStoredTrades,
} from '@/lib/trade-storage'
import { fetchTradesSnapshotFromServer } from '@/lib/sync-trades-snapshot'
import { shouldBlockRemoteLiveDataMerge, isStaleLiveDataAfterReset } from '@/lib/live-session-utils'
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

function isServerSnapshotNewer(
  serverUpdatedAt: string | null,
  localUpdatedAt: string | null,
  serverCount: number,
  localCount: number
): boolean {
  if (serverUpdatedAt && localUpdatedAt) {
    return serverUpdatedAt > localUpdatedAt
  }
  return serverCount > localCount
}

/** Merge server trades snapshot into browser localStorage (for multi-computer sync). */
export async function restoreTradesFromServerSnapshot(): Promise<RestoreTradesResult> {
  const [snapshot, liveRes] = await Promise.all([
    fetchTradesSnapshotFromServer(),
    fetch(`/api/dashboard-session/live?t=${Date.now()}`, { cache: 'no-store' }).catch(() => null),
  ])

  let liveSession: { previousArchiveTitle?: string | null; lastImportFile?: string | null } | null =
    null
  if (liveRes?.ok) {
    try {
      const liveData = await liveRes.json()
      liveSession = liveData.liveSession ?? null
    } catch {
      // optional
    }
  }

  const serverTrades = snapshot.ok ? snapshot.trades : []
  const blockRemoteRestore = shouldBlockRemoteLiveDataMerge(liveSession)

  if (blockRemoteRestore) {
    if (isStaleLiveDataAfterReset(liveSession, serverTrades.length)) {
      clearStoredTrades()
      return {
        ok: true,
        restored: false,
        tradeCount: 0,
        added: 0,
        trades: [],
      }
    }

    if (serverTrades.length > 0) {
      saveStoredTrades(serverTrades, liveSession?.lastImportFile ?? null)
      return {
        ok: true,
        restored: true,
        tradeCount: serverTrades.length,
        added: 0,
        trades: serverTrades,
      }
    }

    clearStoredTrades()
    return {
      ok: true,
      restored: false,
      tradeCount: 0,
      added: 0,
      trades: [],
    }
  }

  if (!snapshot.ok || snapshot.trades.length === 0) {
    const stored = loadStoredTrades()
    const localTrades = stored?.trades ?? []
    return {
      ok: true,
      restored: false,
      tradeCount: localTrades.length,
      added: 0,
      trades: localTrades,
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
      trades: serverTrades,
    }
  }

  const { merged, added } = mergeImportedTrades(localTrades, serverTrades)
  const serverIsNewer = isServerSnapshotNewer(
    snapshot.updatedAt,
    stored?.updatedAt ?? null,
    serverTrades.length,
    localTrades.length
  )
  const shouldUpdate =
    added > 0 || merged.length > localTrades.length || serverIsNewer

  if (shouldUpdate) {
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
    const liveRes = await fetch(`/api/dashboard-session/live?t=${Date.now()}`, {
      cache: 'no-store',
    })
    if (liveRes.ok) {
      const liveData = await liveRes.json()
      const liveSession = liveData.liveSession
      const tradeCount = liveData.tradeCount ?? 0
      if (
        shouldBlockRemoteLiveDataMerge(liveSession) &&
        isStaleLiveDataAfterReset(liveSession, tradeCount)
      ) {
        localStorage.setItem('tradeNotes', '{}')
        localStorage.setItem('tradeSetupTags', '{}')
        localStorage.setItem('tradeRatings', '{}')
        localStorage.setItem('tradeRatingManual', '{}')
        return { ok: true, entryCount: 0 }
      }
    }

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
