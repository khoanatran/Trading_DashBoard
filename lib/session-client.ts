'use client'

export interface LiveSessionInfo {
  tradeCount: number
  updatedAt: string | null
  hasData: boolean
  liveSession: {
    sessionId: string
    startedAt: string
    label?: string
    lastImportFile?: string | null
    previousArchiveTitle?: string | null
  } | null
}

export async function fetchLiveSessionInfo(): Promise<LiveSessionInfo | null> {
  const res = await fetch('/api/dashboard-session/live')
  if (!res.ok) return null
  return res.json()
}

export async function exportLiveSession(title: string) {
  const res = await fetch('/api/dashboard-session/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? 'Export failed')
  return data
}

export async function startNewLiveSession(archiveTitle: string) {
  const res = await fetch('/api/dashboard-session/new', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ archiveTitle }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? 'Failed to start new session')
  return data
}

/** Clear browser caches after server wiped live data. */
export function clearLiveClientState(): void {
  localStorage.removeItem('trading-dashboard-trades-v1')
  localStorage.setItem('tradeNotes', '{}')
  localStorage.setItem('tradeSetupTags', '{}')
  localStorage.setItem('tradeRatings', '{}')
  localStorage.setItem('tradeRatingManual', '{}')
}

export async function updateLiveSessionImport(fileName: string): Promise<void> {
  await fetch('/api/dashboard-session/live', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lastImportFile: fileName }),
  })
}
