export interface LiveSessionManifest {
  version: 1
  sessionId: string
  startedAt: string
  label?: string
  lastImportFile?: string | null
  previousArchiveTitle?: string | null
}

type LiveSessionResetMarker = Pick<
  LiveSessionManifest,
  'previousArchiveTitle' | 'lastImportFile'
>

/** Live session was reset via "Start new session" — old data lives in an archive. */
export function isIntentionalLiveSessionReset(
  manifest: LiveSessionResetMarker | null | undefined
): boolean {
  return Boolean(manifest?.previousArchiveTitle)
}

/** User has not imported a spreadsheet into this reset session yet. */
export function isFirstImportAfterReset(
  manifest: LiveSessionResetMarker | null | undefined
): boolean {
  return isIntentionalLiveSessionReset(manifest) && !manifest?.lastImportFile
}

/**
 * Stale trades/journal restored from GitHub or MT5 auto-import before the user
 * imported into a reset session.
 */
export function isStaleLiveDataAfterReset(
  manifest: LiveSessionResetMarker | null | undefined,
  localTradeCount: number
): boolean {
  return isFirstImportAfterReset(manifest) && localTradeCount > 0
}

/**
 * Block GitHub / MT5 from merging pre-reset data into a session that was
 * archived and cleared. Stays active for the whole reset session — not only
 * until the first spreadsheet import.
 */
export function shouldBlockRemoteLiveDataMerge(
  manifest: LiveSessionResetMarker | null | undefined
): boolean {
  return isIntentionalLiveSessionReset(manifest)
}
