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

const SESSION_REQUEST_TIMEOUT_MS = 15 * 60 * 1000

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), SESSION_REQUEST_TIMEOUT_MS)

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    let data: Record<string, unknown> = {}
    try {
      data = await res.json()
    } catch {
      if (!res.ok) {
        throw new Error(`Request failed (${res.status}). The server may still be working — check dashboard-server.log.`)
      }
    }

    if (!res.ok) {
      throw new Error(String(data.error ?? `Request failed (${res.status})`))
    }

    return data as T
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(
        'Request timed out after 15 minutes. The archive may still be running on the server — check dashboard-server.log, then refresh the page.'
      )
    }
    throw error
  } finally {
    window.clearTimeout(timer)
  }
}

export async function fetchLiveSessionInfo(): Promise<LiveSessionInfo | null> {
  const res = await fetch('/api/dashboard-session/live')
  if (!res.ok) return null
  return res.json()
}

export async function exportLiveSession(title: string) {
  return postJson<{
    manifest: { tradeCount: number; mediaFileCount: number }
    folderPath: string
    zipPath: string
    github?: { message?: string }
  }>('/api/dashboard-session/export', { title })
}

export async function startNewLiveSession(archiveTitle: string) {
  return postJson<{
    title: string
    github?: { message?: string }
  }>('/api/dashboard-session/new', { archiveTitle })
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
