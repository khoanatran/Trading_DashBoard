import type { Trade } from '@/utils/logParser'

export async function syncTradeExportToDisk(
  trades: Trade[],
  options?: { archiveTitle?: string | null }
): Promise<{
  ok: boolean
  path?: string
  tradeCount?: number
  syncedToGitHub?: boolean
  archiveTitle?: string
}> {
  if (trades.length === 0) {
    return { ok: false }
  }

  try {
    const archiveTitle = options?.archiveTitle?.trim() || undefined
    const res = await fetch('/api/trade-export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trades, archiveTitle }),
    })

    if (!res.ok) {
      return { ok: false }
    }

    const data = await res.json()
    return {
      ok: true,
      path: data.path,
      tradeCount: data.tradeCount,
      syncedToGitHub: data.syncedToGitHub,
      archiveTitle: data.archiveTitle,
    }
  } catch {
    return { ok: false }
  }
}
