import type { Trade } from '@/utils/logParser'

export async function fetchTradesSnapshotFromServer(): Promise<Trade[] | null> {
  try {
    const res = await fetch('/api/trades-snapshot')
    if (!res.ok) return null
    const data = await res.json()
    return Array.isArray(data.trades) ? data.trades : null
  } catch {
    return null
  }
}

export async function syncTradesSnapshotToServer(
  trades: Trade[]
): Promise<{ ok: boolean; tradeCount?: number }> {
  if (trades.length === 0) return { ok: false }

  try {
    const res = await fetch('/api/trades-snapshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trades }),
    })
    if (!res.ok) return { ok: false }
    const data = await res.json()
    return { ok: true, tradeCount: data.tradeCount }
  } catch {
    return { ok: false }
  }
}
