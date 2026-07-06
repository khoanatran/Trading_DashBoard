import type { Trade } from '@/utils/logParser'

export interface RemigrateSummary {
  images: { remappedKeys: number; recoveredFiles: number; totalEntries: number }
  videos: { remappedKeys: number; recoveredFiles: number; totalEntries: number }
  journal: { remappedKeys: number; totalEntries: number }
  tags: { remappedKeys: number; totalEntries: number }
  flags: { remappedTrades: number }
}

export async function remigrateTradeMetadataOnServer(
  trades: Trade[]
): Promise<{ ok: boolean; summary?: RemigrateSummary }> {
  if (trades.length === 0) {
    return { ok: false }
  }

  try {
    const res = await fetch('/api/trade-metadata/remigrate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trades }),
    })

    if (!res.ok) return { ok: false }

    const data = await res.json()
    return {
      ok: true,
      summary: {
        images: data.images,
        videos: data.videos,
        journal: data.journal,
        tags: data.tags,
        flags: data.flags,
      },
    }
  } catch {
    return { ok: false }
  }
}
