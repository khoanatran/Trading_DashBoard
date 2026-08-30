import * as XLSX from 'xlsx'
import { formatInTimeZone } from 'date-fns-tz'
import { DISPLAY_TIMEZONE } from '@/lib/timezone'
import type { TradeJournalEntry } from '@/lib/trade-journal'
import {
  Trade,
  getTradeId,
  getTradeRMultiple,
  getTradeResult,
  parseLocalTimestamp,
  sortTradesForEquityCurve,
} from '@/utils/logParser'

export interface JournalExportContext {
  tradeTags?: Record<string, string[]>
  journal?: Record<string, TradeJournalEntry>
  flaggedTrades?: Record<string, boolean>
}

export interface JournalExportRow {
  'Trade #': number
  'Trade ID': string
  Symbol: string
  Direction: string
  Result: string
  'Date (ET)': string
  'Entry Time (ET)': string
  'Exit Time (ET)': string
  Quantity: number | string
  'Entry Price': number | string
  'Exit Price': number | string
  'P&L ($)': number | string
  'R Multiple': number | string
  'Trade Tags': string
  'Setup Tags': string
  Rating: number | string
  'Rating Manual': string
  Flagged: string
  Note: string
  'Journal Updated (ET)': string
  'Source File': string
}

function formatNycDate(ts: string | null | undefined): string {
  if (!ts) return ''
  try {
    const instant = parseLocalTimestamp(ts)
    return formatInTimeZone(instant, DISPLAY_TIMEZONE, 'yyyy-MM-dd')
  } catch {
    return ts
  }
}

function formatNycTime(ts: string | null | undefined): string {
  if (!ts) return ''
  try {
    const instant = parseLocalTimestamp(ts)
    return formatInTimeZone(instant, DISPLAY_TIMEZONE, 'HH:mm:ss')
  } catch {
    return ts
  }
}

function formatUtcToNyc(iso: string | null | undefined): string {
  if (!iso) return ''
  try {
    return formatInTimeZone(new Date(iso), DISPLAY_TIMEZONE, 'yyyy-MM-dd HH:mm:ss')
  } catch {
    return iso
  }
}

function buildJournalEntryFromMaps(
  tradeId: string,
  notes: Record<string, string>,
  setupTags: Record<string, string[]>,
  ratings: Record<string, number>,
  ratingManual: Record<string, boolean>
): TradeJournalEntry {
  return {
    note: notes[tradeId] ?? '',
    setupTags: setupTags[tradeId] ?? [],
    rating: ratings[tradeId] ?? 0,
    ratingManual: ratingManual[tradeId] ?? false,
  }
}

/** Build journal context from JournalTable localStorage-backed maps. */
export function journalContextFromMaps(params: {
  notes: Record<string, string>
  setupTags: Record<string, string[]>
  ratings: Record<string, number>
  ratingManual: Record<string, boolean>
  tradeTags?: Record<string, string[]>
  flaggedTrades?: Record<string, boolean>
}): JournalExportContext {
  const tradeIds = new Set<string>([
    ...Object.keys(params.notes),
    ...Object.keys(params.setupTags),
    ...Object.keys(params.ratings),
    ...Object.keys(params.ratingManual),
  ])
  const journal: Record<string, TradeJournalEntry> = {}
  for (const tradeId of tradeIds) {
    journal[tradeId] = buildJournalEntryFromMaps(
      tradeId,
      params.notes,
      params.setupTags,
      params.ratings,
      params.ratingManual
    )
  }
  return {
    journal,
    tradeTags: params.tradeTags,
    flaggedTrades: params.flaggedTrades,
  }
}

export function buildJournalExportRows(
  trades: Trade[],
  ctx: JournalExportContext = {}
): JournalExportRow[] {
  const sorted = sortTradesForEquityCurve(trades)
  return sorted.map((trade, index) => {
    const tradeId = getTradeId(trade)
    const journal = ctx.journal?.[tradeId]
    const tags = ctx.tradeTags?.[tradeId] ?? []
    const rMultiple = getTradeRMultiple(trade)
    const result = getTradeResult(trade, ctx.tradeTags)
    const rating = journal?.rating ?? 0

    const entryTs = trade.entryTime ?? trade.timestamp
    const exitTs = trade.exitTime ?? trade.timestamp

    return {
      'Trade #': index + 1,
      'Trade ID': tradeId,
      Symbol: trade.symbol ?? '',
      Direction: trade.direction ?? '',
      Result: result,
      'Date (ET)': formatNycDate(entryTs),
      'Entry Time (ET)': formatNycTime(entryTs),
      'Exit Time (ET)': formatNycTime(exitTs),
      Quantity: trade.orderQty ?? '',
      'Entry Price': trade.entryPrice ?? '',
      'Exit Price': trade.exitPrice ?? '',
      'P&L ($)': trade.pnl ?? '',
      'R Multiple': rMultiple != null ? Number(rMultiple.toFixed(2)) : '',
      'Trade Tags': tags.join(', '),
      'Setup Tags': journal?.setupTags?.length ? journal.setupTags.join(', ') : '',
      Rating: rating > 0 ? rating : '',
      'Rating Manual': journal?.ratingManual ? 'Yes' : 'No',
      Flagged: ctx.flaggedTrades?.[tradeId] ? 'Yes' : 'No',
      Note: journal?.note?.trim() ?? '',
      'Journal Updated (ET)': formatUtcToNyc(journal?.updatedAt),
      'Source File': trade.sourceFile ?? '',
    }
  })
}

/** Build an XLSX workbook with a Journal sheet from trades + journal context. */
export function buildJournalWorkbook(
  trades: Trade[],
  ctx: JournalExportContext = {}
): XLSX.WorkBook {
  const rows = buildJournalExportRows(trades, ctx)
  const sheet = XLSX.utils.json_to_sheet(rows)

  const colWidths = [
    { wch: 8 },
    { wch: 42 },
    { wch: 18 },
    { wch: 10 },
    { wch: 8 },
    { wch: 12 },
    { wch: 14 },
    { wch: 14 },
    { wch: 10 },
    { wch: 12 },
    { wch: 12 },
    { wch: 10 },
    { wch: 10 },
    { wch: 24 },
    { wch: 28 },
    { wch: 8 },
    { wch: 12 },
    { wch: 8 },
    { wch: 50 },
    { wch: 20 },
    { wch: 28 },
  ]
  sheet['!cols'] = colWidths

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, 'Journal')
  return workbook
}

export function defaultJournalExportFilename(): string {
  const datePart = formatInTimeZone(new Date(), DISPLAY_TIMEZONE, 'yyyy-MM-dd')
  return `journal-export-${datePart}-ET.xlsx`
}

/** Download all journal data as an Excel (.xlsx) file in the browser. */
export function downloadJournalExcel(
  trades: Trade[],
  ctx: JournalExportContext = {},
  filename?: string
): void {
  const workbook = buildJournalWorkbook(trades, ctx)
  XLSX.writeFile(workbook, filename ?? defaultJournalExportFilename())
}
