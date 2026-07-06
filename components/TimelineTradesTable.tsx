'use client'

import React, { useMemo } from 'react'
import { Trade, getTradeId } from '@/utils/logParser'
import JournalTable from '@/components/JournalTable'

export interface TimelineTradesTableProps {
  trades: Trade[]
  darkMode: boolean
  title?: string
  emptyMessage?: string
  /** Optional equity-curve trade # for first row (drawdown recap). */
  equityIndexStart?: number
  /** Keep trades in input order (e.g. equity sequence). Defaults to true when equityIndexStart is set. */
  preserveTradeOrder?: boolean
  /** Notify parent when user selects a trade row (daily recap equity curve). */
  onHighlightedTradeChange?: (tradeId: string | null) => void
}

export default function TimelineTradesTable({
  trades,
  darkMode,
  title,
  emptyMessage = 'No trades to show.',
  equityIndexStart,
  preserveTradeOrder,
  onHighlightedTradeChange,
}: TimelineTradesTableProps) {
  const equityIndexByTradeId = useMemo(() => {
    if (equityIndexStart == null) return undefined
    const map: Record<string, number> = {}
    trades.forEach((trade, index) => {
      map[getTradeId(trade)] = equityIndexStart + index
    })
    return map
  }, [trades, equityIndexStart])

  const keepOrder = preserveTradeOrder ?? equityIndexStart != null

  if (trades.length === 0) {
    return <p className="text-sm text-muted-foreground px-1">{emptyMessage}</p>
  }

  return (
    <JournalTable
      trades={trades}
      darkMode={darkMode}
      embedded
      embeddedTitle={title}
      includeWeekends
      preserveTradeOrder={keepOrder}
      equityIndexByTradeId={equityIndexByTradeId}
      onHighlightedTradeChange={onHighlightedTradeChange}
    />
  )
}
