export interface TradeJournalEntry {
  note: string
  setupTags: string[]
  rating: number
  ratingManual?: boolean
  updatedAt?: string
}

export async function patchTradeJournal(
  tradeId: string,
  patch: Partial<TradeJournalEntry>
): Promise<{ ok: boolean; entry?: TradeJournalEntry & { tradeId: string } }> {
  try {
    const res = await fetch('/api/trade-journal', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tradeId, ...patch }),
    })
    if (!res.ok) return { ok: false }
    const data = await res.json()
    return {
      ok: true,
      entry: {
        tradeId,
        note: data.note ?? '',
        setupTags: data.setupTags ?? [],
        rating: data.rating ?? 0,
        ratingManual: data.ratingManual ?? false,
      },
    }
  } catch {
    return { ok: false }
  }
}
