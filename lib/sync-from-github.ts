export interface GitHubPullClientResult {
  ok: boolean
  pulled: boolean
  dataChanged: boolean
  changedFiles: string[]
  message: string
}

/** Pull latest dashboard data from GitHub (trades, media, tags, notes). */
export async function pullFromGitHub(): Promise<GitHubPullClientResult> {
  try {
    const res = await fetch('/api/github-sync', { method: 'POST' })
    if (!res.ok) {
      return {
        ok: false,
        pulled: false,
        dataChanged: false,
        changedFiles: [],
        message: 'GitHub sync request failed',
      }
    }

    const data = await res.json()
    const result = data.result as {
      ok?: boolean
      pulled?: boolean
      dataChanged?: boolean
      changedFiles?: string[]
      message?: string
    }

    return {
      ok: Boolean(result?.ok),
      pulled: Boolean(result?.pulled),
      dataChanged: Boolean(result?.dataChanged),
      changedFiles: Array.isArray(result?.changedFiles) ? result.changedFiles : [],
      message: result?.message ?? 'GitHub sync complete',
    }
  } catch {
    return {
      ok: false,
      pulled: false,
      dataChanged: false,
      changedFiles: [],
      message: 'GitHub sync request failed',
    }
  }
}
