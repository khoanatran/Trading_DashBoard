export interface FlagsData {
  days: Record<string, boolean>
  trades: Record<string, boolean>
}

export async function fetchFlags(): Promise<FlagsData> {
  try {
    const res = await fetch('/api/flags')
    if (!res.ok) return { days: {}, trades: {} }
    const data = await res.json()
    return {
      days: data.days && typeof data.days === 'object' ? data.days : {},
      trades: data.trades && typeof data.trades === 'object' ? data.trades : {},
    }
  } catch {
    return { days: {}, trades: {} }
  }
}

export async function setTradeFlag(
  tradeId: string,
  flagged: boolean
): Promise<{ ok: boolean; data?: FlagsData }> {
  try {
    const res = await fetch('/api/flags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tradeId, flagged }),
    })
    if (!res.ok) return { ok: false }
    const data = await res.json()
    return {
      ok: true,
      data: {
        days: data.days ?? {},
        trades: data.trades ?? {},
      },
    }
  } catch {
    return { ok: false }
  }
}

export async function setDayFlag(
  dateKey: string,
  flagged: boolean
): Promise<{ ok: boolean; data?: FlagsData }> {
  try {
    const res = await fetch('/api/flags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dateKey, flagged }),
    })
    if (!res.ok) return { ok: false }
    const data = await res.json()
    return {
      ok: true,
      data: {
        days: data.days ?? {},
        trades: data.trades ?? {},
      },
    }
  } catch {
    return { ok: false }
  }
}
