export interface DashboardArchiveSummary {
  title: string
  dateRange: { from: string; to: string }
  createdAt: string
  tradeCount: number
  mediaFileCount: number
}

export interface LoadedDashboardArchive {
  title: string
  manifest: DashboardArchiveSummary & { version: 1 }
  trades: import('@/utils/logParser').Trade[]
  tradeJournal: Record<string, {
    note?: string
    setupTags?: string[]
    rating?: number
    ratingManual?: boolean
  }>
  tradeTags: Record<string, string[]>
  flags: { days?: Record<string, boolean>; trades?: Record<string, boolean> }
}

export async function fetchDashboardArchives(): Promise<DashboardArchiveSummary[]> {
  const res = await fetch('/api/dashboard-archives')
  if (!res.ok) return []
  const data = await res.json()
  return data.archives ?? []
}

export async function loadDashboardArchiveClient(title: string): Promise<LoadedDashboardArchive | null> {
  const res = await fetch(`/api/dashboard-archives/${encodeURIComponent(title)}`)
  if (!res.ok) return null
  return res.json()
}

/** Hydrate journal localStorage from an archive bundle (notes, setup tags, ratings). */
export function hydrateJournalCacheFromArchive(
  tradeJournal: LoadedDashboardArchive['tradeJournal']
): number {
  const notes: Record<string, string> = {}
  const setupTags: Record<string, string[]> = {}
  const ratings: Record<string, number> = {}
  const ratingManual: Record<string, boolean> = {}

  for (const [tradeId, entry] of Object.entries(tradeJournal)) {
    notes[tradeId] = entry.note ?? ''
    setupTags[tradeId] = entry.setupTags ?? []
    ratingManual[tradeId] = entry.ratingManual ?? false
    ratings[tradeId] = entry.rating ?? 0
  }

  localStorage.setItem('tradeNotes', JSON.stringify(notes))
  localStorage.setItem('tradeSetupTags', JSON.stringify(setupTags))
  localStorage.setItem('tradeRatings', JSON.stringify(ratings))
  localStorage.setItem('tradeRatingManual', JSON.stringify(ratingManual))

  return Object.keys(tradeJournal).length
}
