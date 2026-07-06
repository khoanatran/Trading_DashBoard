import { Trade, getTradeId, getTradeDedupKey } from '@/utils/logParser'

/** Same sanitization used when saving image/video filenames. */
export function sanitizeTradeIdForFilename(tradeId: string): string {
  return tradeId.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 100)
}

function normalizeTimestampForMatch(ts: string): string {
  return ts
    .trim()
    .replace(/\u00a0/g, ' ')
    .replace('T', ' ')
    .replace(/_/g, ':')
    .replace(/[,\.]\d+.*$/, '')
    .replace(/[Zz]$/, '')
    .replace(/\s+/g, ' ')
}

function timestampFromTradeId(tradeId: string): string | null {
  const idx = tradeId.indexOf('::')
  if (idx === -1) return null
  return normalizeTimestampForMatch(tradeId.slice(idx + 2))
}

function tradeTimestampCandidates(trade: Trade): string[] {
  const raw = [trade.timestamp, trade.entryTime, trade.exitTime].filter(
    (v): v is string => Boolean(v)
  )
  return [...new Set(raw.map(normalizeTimestampForMatch))]
}

export interface TradeLookupMaps {
  byExactId: Map<string, string>
  bySanitizedId: Map<string, string>
  byDedupKey: Map<string, string>
  byTimestamp: Map<string, string[]>
}

export function buildTradeLookupMaps(trades: Trade[]): TradeLookupMaps {
  const byExactId = new Map<string, string>()
  const bySanitizedId = new Map<string, string>()
  const byDedupKey = new Map<string, string>()
  const byTimestamp = new Map<string, string[]>()

  for (const trade of trades) {
    const id = getTradeId(trade)
    byExactId.set(id, id)
    bySanitizedId.set(sanitizeTradeIdForFilename(id), id)
    byDedupKey.set(getTradeDedupKey(trade), id)

    for (const ts of tradeTimestampCandidates(trade)) {
      const list = byTimestamp.get(ts) ?? []
      if (!list.includes(id)) list.push(id)
      byTimestamp.set(ts, list)
    }
  }

  return { byExactId, bySanitizedId, byDedupKey, byTimestamp }
}

/** Resolve a legacy/orphan trade id to the current journal trade id. */
export function resolveTradeId(
  legacyTradeId: string,
  maps: TradeLookupMaps
): string | null {
  if (maps.byExactId.has(legacyTradeId)) {
    return maps.byExactId.get(legacyTradeId)!
  }

  const sanitizedLegacy = sanitizeTradeIdForFilename(legacyTradeId)
  if (maps.bySanitizedId.has(sanitizedLegacy)) {
    return maps.bySanitizedId.get(sanitizedLegacy)!
  }

  const legacyTs = timestampFromTradeId(legacyTradeId)
  if (legacyTs) {
    const matches = maps.byTimestamp.get(legacyTs)
    if (matches?.length === 1) return matches[0]
  }

  return null
}

/** Extract sanitized trade-id prefix embedded in uploaded media filenames. */
export function extractSanitizedTradeIdFromMediaFilename(filename: string): string | null {
  const base = filename.replace(/\.[^.]+$/, '')
  const match = base.match(/^(.+?)__\d{13}_[a-z0-9]+$/i)
  return match?.[1] ?? null
}

export function resolveTradeIdFromMediaFilename(
  filename: string,
  maps: TradeLookupMaps
): string | null {
  const sanitized = extractSanitizedTradeIdFromMediaFilename(filename)
  if (!sanitized) return null
  return maps.bySanitizedId.get(sanitized) ?? null
}
