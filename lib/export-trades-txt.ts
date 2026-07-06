import { formatInTimeZone } from 'date-fns-tz'
import { DISPLAY_TIMEZONE } from '@/lib/timezone'
import {
  Trade,
  getTradeId,
  getTradeRMultiple,
  getTradeResult,
  getTradeDollarRisk,
  parseLocalTimestamp,
  sortTradesForEquityCurve,
} from '@/utils/logParser'
import { formatUsd, formatUsdPnl } from '@/lib/format'
import type { TradeJournalEntry } from '@/lib/trade-journal'

export interface TradeExportContext {
  tradeTags?: Record<string, string[]>
  journal?: Record<string, TradeJournalEntry>
  flaggedTrades?: Record<string, boolean>
}

function formatNycDatetime(ts: string | null | undefined): string {
  if (!ts) return 'N/A'
  try {
    const instant = parseLocalTimestamp(ts)
    return `${formatInTimeZone(instant, DISPLAY_TIMEZONE, 'yyyy-MM-dd HH:mm:ss')} ET`
  } catch {
    return ts
  }
}

function formatUtcToNyc(iso: string | null | undefined): string {
  if (!iso) return 'N/A'
  try {
    return `${formatInTimeZone(new Date(iso), DISPLAY_TIMEZONE, 'yyyy-MM-dd HH:mm:ss')} ET`
  } catch {
    return iso
  }
}

function formatPrice(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'N/A'
  return value.toFixed(5)
}

function line(label: string, value: string): string {
  return `${label.padEnd(22)} ${value}`
}

function formatPartialExits(trade: Trade): string[] {
  if (!trade.partialExits?.length) return []
  return trade.partialExits.map((exit, index) => {
    const parts = [
      `    Partial Exit #${index + 1}`,
      line('      Time (ET)', formatNycDatetime(exit.timestamp)),
      line('      Contracts', String(exit.contracts)),
      line('      Exit Price', formatPrice(exit.exitPrice)),
      line('      P&L', formatUsdPnl(exit.pnl)),
      line('      R Multiple', exit.rrRatio != null ? `${exit.rrRatio.toFixed(1)}R` : 'N/A'),
      line('      Final', exit.isFinal ? 'Yes' : 'No'),
    ]
    return parts.join('\n')
  })
}

function formatTradeBlock(
  index: number,
  trade: Trade,
  ctx: TradeExportContext
): string {
  const tradeId = getTradeId(trade)
  const tags = ctx.tradeTags?.[tradeId] ?? []
  const journal = ctx.journal?.[tradeId]
  const rMultiple = getTradeRMultiple(trade)
  const result = getTradeResult(trade, ctx.tradeTags)
  const flagged = Boolean(ctx.flaggedTrades?.[tradeId])

  const lines = [
    `Trade #${index}`,
    '-'.repeat(80),
    line('Trade ID', tradeId),
    line('Source File', trade.sourceFile ?? 'N/A'),
    line('Symbol', trade.symbol ?? 'N/A'),
    line('Direction', trade.direction ?? 'N/A'),
    line('Result', result),
    line('Entry Time (ET)', formatNycDatetime(trade.entryTime ?? trade.timestamp)),
    line('Exit Time (ET)', formatNycDatetime(trade.exitTime ?? trade.timestamp)),
    line('Close Time (ET)', formatNycDatetime(trade.exitTime ?? trade.timestamp)),
    line('Quantity', trade.orderQty != null ? String(trade.orderQty) : 'N/A'),
    line('Entry Price', formatPrice(trade.entryPrice)),
    line('Exit Price', formatPrice(trade.exitPrice)),
    line('SL Points', trade.slPoints != null ? String(trade.slPoints) : 'N/A'),
    line('TP Points', trade.tpPoints != null ? String(trade.tpPoints) : 'N/A'),
    line('Est. Risk', formatUsd(getTradeDollarRisk(trade))),
    line('P&L', formatUsdPnl(trade.pnl)),
    line('R Multiple', rMultiple != null ? `${rMultiple.toFixed(1)}R` : 'N/A'),
    line('Reward', trade.reward != null ? String(trade.reward) : 'N/A'),
    line('Commission', trade.commission != null ? formatUsd(trade.commission) : 'N/A'),
    line('Closed', trade.isClosed ? 'Yes' : 'No'),
    line('Trade Tags', tags.length > 0 ? tags.join(', ') : '—'),
    line('Setup Tags', journal?.setupTags?.length ? journal.setupTags.join(', ') : '—'),
    line(
      'Rating',
      journal?.rating != null && journal.rating > 0
        ? `${journal.rating}${journal.ratingManual ? ' (manual)' : ''}`
        : '—'
    ),
    line('Flagged', flagged ? 'Yes' : 'No'),
    line('Journal Updated (ET)', formatUtcToNyc(journal?.updatedAt)),
  ]

  if (journal?.note?.trim()) {
    lines.push(line('Note', ''))
    for (const noteLine of journal.note.trim().split('\n')) {
      lines.push(`  ${noteLine}`)
    }
  } else {
    lines.push(line('Note', '—'))
  }

  const partialBlocks = formatPartialExits(trade)
  if (partialBlocks.length > 0) {
    lines.push(line('Partial Exits', ''))
    lines.push(...partialBlocks)
  }

  return lines.join('\n')
}

export function buildTradesExportTxt(trades: Trade[], ctx: TradeExportContext = {}): string {
  const sorted = sortTradesForEquityCurve(trades)
  const generatedAt = formatInTimeZone(new Date(), DISPLAY_TIMEZONE, 'yyyy-MM-dd HH:mm:ss')

  const header = [
    'TRADING DASHBOARD — TRADE EXPORT',
    '='.repeat(80),
    line('Timezone', 'America/New_York (ET)'),
    line('Generated (ET)', `${generatedAt} ET`),
    line('Total Trades', String(sorted.length)),
    '',
  ].join('\n')

  const body = sorted.map((trade, i) => formatTradeBlock(i + 1, trade, ctx)).join('\n\n')

  return `${header}${body}\n`
}

export function downloadTradesTxt(content: string, filename?: string): void {
  const datePart = formatInTimeZone(new Date(), DISPLAY_TIMEZONE, 'yyyy-MM-dd')
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename ?? `trades-export-${datePart}-ET.txt`
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}
