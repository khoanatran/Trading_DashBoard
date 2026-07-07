export interface GitHubPullClientResult {
  ok: boolean
  pulled: boolean
  pushed: boolean
  dataChanged: boolean
  changedFiles: string[]
  tradesAdded: number
  tradeCount: number
  message: string
}

/** Full bidirectional sync with GitHub (merge pull + MT5 + push). */
export async function pullFromGitHub(): Promise<GitHubPullClientResult> {
  try {
    const res = await fetch('/api/dashboard-sync', { method: 'POST' })
    if (!res.ok) {
      return {
        ok: false,
        pulled: false,
        pushed: false,
        dataChanged: false,
        changedFiles: [],
        tradesAdded: 0,
        tradeCount: 0,
        message: 'Dashboard sync request failed',
      }
    }

    const data = await res.json()
    const result = data.result as {
      ok?: boolean
      pulled?: boolean
      pushed?: boolean
      changedFiles?: string[]
      tradesAdded?: number
      tradeCount?: number
      message?: string
    }

    const changedFiles = Array.isArray(result?.changedFiles) ? result.changedFiles : []

    return {
      ok: Boolean(result?.ok),
      pulled: Boolean(result?.pulled),
      pushed: Boolean(result?.pushed),
      dataChanged: changedFiles.length > 0,
      changedFiles,
      tradesAdded: result?.tradesAdded ?? 0,
      tradeCount: result?.tradeCount ?? 0,
      message: result?.message ?? 'Dashboard sync complete',
    }
  } catch {
    return {
      ok: false,
      pulled: false,
      pushed: false,
      dataChanged: false,
      changedFiles: [],
      tradesAdded: 0,
      tradeCount: 0,
      message: 'Dashboard sync request failed',
    }
  }
}
