import type { Trade } from '@/utils/logParser'

export interface TradesSnapshotResponse {
  ok: boolean
  trades: Trade[]
  updatedAt: string | null
}

export async function fetchTradesSnapshotFromServer(): Promise<TradesSnapshotResponse> {
  try {
    const res = await fetch('/api/trades-snapshot')
    if (!res.ok) return { ok: false, trades: [], updatedAt: null }
    const data = await res.json()
    if (!Array.isArray(data.trades)) return { ok: false, trades: [], updatedAt: null }
    return {
      ok: true,
      trades: data.trades as Trade[],
      updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : null,
    }
  } catch {
    return { ok: false, trades: [], updatedAt: null }
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
