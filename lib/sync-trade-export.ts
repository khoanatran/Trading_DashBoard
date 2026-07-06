import type { Trade } from '@/utils/logParser'

export async function syncTradeExportToDisk(
  trades: Trade[]
): Promise<{ ok: boolean; path?: string; tradeCount?: number }> {
  if (trades.length === 0) {
    return { ok: false }
  }

  try {
    const res = await fetch('/api/trade-export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trades }),
    })

    if (!res.ok) {
      return { ok: false }
    }

    const data = await res.json()
    return {
      ok: true,
      path: data.path,
      tradeCount: data.tradeCount,
    }
  } catch {
    return { ok: false }
  }
}
